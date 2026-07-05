'use strict';

const net = require('net');
const path = require('path');

/**
 * Intégration Discord Rich Presence.
 *
 * La Rich Presence ne passe PAS par Internet : c'est une connexion IPC locale
 * (named pipe Windows / socket Unix) vers le client Discord installé sur la
 * machine. Le protocole est assez simple pour être implémenté ici sans
 * dépendance npm : trames [op int32 LE][longueur int32 LE][JSON], handshake
 * puis commandes SET_ACTIVITY.
 *
 * Respecte le contrat d'intégration (voir ./index.js) : activate/deactivate/
 * setConfig/setPresence + propriétés id/name/enabled/status/onStatus.
 */

// ID de l'application Discord, créée sur https://discord.com/developers/applications
// (New Application → copier l'« Application ID »). Cet identifiant est PUBLIC
// par design — ce n'est pas un secret, il peut être committé sans risque.
// Tant qu'il est vide, l'intégration reste inerte et remonte « unconfigured ».
const DISCORD_APP_ID = '1523256894771433592';

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

// Discord n'accepte qu'une mise à jour de presence toutes les ~15 s : on
// throttle côté envoi (dernier état gagnant, envoyé en fin de fenêtre).
const UPDATE_MIN_INTERVAL_MS = 15000;
const RECONNECT_DELAY_MS = 30000;

/** Trame du protocole IPC Discord. */
function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const buf = Buffer.alloc(8 + json.length);
  buf.writeInt32LE(op, 0);
  buf.writeInt32LE(json.length, 4);
  json.copy(buf, 8);
  return buf;
}

/** Chemins possibles du socket IPC du client Discord (10 slots par dossier). */
function socketCandidates() {
  if (process.platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }
  const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, '/tmp'].filter(Boolean);
  const dirs = [];
  for (const base of bases) {
    // installation classique, flatpak, snap
    dirs.push(base);
    dirs.push(path.join(base, 'app', 'com.discordapp.Discord'));
    dirs.push(path.join(base, 'snap.discord'));
  }
  const out = [];
  for (const dir of dirs) {
    for (let i = 0; i < 10; i++) out.push(path.join(dir, `discord-ipc-${i}`));
  }
  return out;
}

class DiscordRpcIntegration {
  constructor() {
    this.id = 'discord-rpc';
    this.name = 'Discord Rich Presence';
    this.enabled = false;
    this.status = 'off'; // off | unconfigured | connecting | connected | unavailable
    this.onStatus = null; // posé par le manager

    this._config = { showTabName: false };
    this._title = null;
    this._startedAt = null;

    this._socket = null;
    this._connected = false;
    this._buf = Buffer.alloc(0);
    this._nonce = 0;
    this._lastSentAt = 0;
    this._throttleTimer = null;
    this._reconnectTimer = null;
  }

  activate(config) {
    if (this.enabled) return;
    this.enabled = true;
    this._config = { showTabName: !!config?.showTabName };
    this._startedAt = Date.now();
    if (!DISCORD_APP_ID) {
      this._setStatus('unconfigured');
      return;
    }
    this._connect();
  }

  /** Fermer le socket suffit : Discord efface la presence à la déconnexion. */
  deactivate() {
    this.enabled = false;
    this._clearTimers();
    this._connected = false;
    this._socket?.destroy();
    this._socket = null;
    this._setStatus('off');
  }

  setConfig(config) {
    const showTabName = !!config?.showTabName;
    if (showTabName === this._config.showTabName) return;
    this._config.showTabName = showTabName;
    this._pushActivity();
  }

  /** Reçoit le titre de l'onglet actif (renderer via presence:update). */
  setPresence({ title }) {
    const clean = typeof title === 'string' ? title.trim() : '';
    this._title = clean || null;
    this._pushActivity();
  }

  /* ------------------------------ connexion ------------------------------ */

  _connect() {
    if (!this.enabled || this._socket) return;
    this._setStatus('connecting');
    const candidates = socketCandidates();

    const tryNext = (i) => {
      if (!this.enabled) return;
      if (i >= candidates.length) {
        this._setStatus('unavailable');
        this._scheduleReconnect();
        return;
      }
      const sock = net.createConnection(candidates[i]);
      const onError = () => {
        sock.destroy();
        tryNext(i + 1);
      };
      sock.once('error', onError);
      sock.once('connect', () => {
        sock.removeListener('error', onError);
        this._attach(sock);
      });
    };
    tryNext(0);
  }

  _attach(sock) {
    this._socket = sock;
    this._buf = Buffer.alloc(0);
    sock.on('data', (chunk) => this._onData(chunk));
    sock.on('error', () => {}); // 'close' suit toujours
    sock.on('close', () => {
      if (this._socket !== sock) return;
      this._socket = null;
      this._connected = false;
      if (this.enabled) {
        this._setStatus('unavailable');
        this._scheduleReconnect();
      }
    });
    sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: DISCORD_APP_ID }));
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    while (this._buf.length >= 8) {
      const op = this._buf.readInt32LE(0);
      const len = this._buf.readInt32LE(4);
      if (this._buf.length < 8 + len) break;
      const payload = this._buf.subarray(8, 8 + len).toString('utf8');
      this._buf = this._buf.subarray(8 + len);
      let msg;
      try {
        msg = JSON.parse(payload);
      } catch (err) {
        continue;
      }
      this._onMessage(op, msg);
    }
  }

  _onMessage(op, msg) {
    if (op === OP.PING) {
      this._socket?.write(encode(OP.PONG, msg));
      return;
    }
    if (op === OP.CLOSE) {
      // ex. Application ID inconnu — le socket sera fermé par Discord
      console.warn('[discord-rpc] fermeture demandée par Discord:', msg?.message || msg);
      this._socket?.destroy();
      return;
    }
    if (op === OP.FRAME && msg?.evt === 'READY') {
      this._connected = true;
      this._setStatus('connected');
      this._pushActivity(true);
    }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer || !this.enabled) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, RECONNECT_DELAY_MS);
  }

  _clearTimers() {
    if (this._throttleTimer) clearTimeout(this._throttleTimer);
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._throttleTimer = null;
    this._reconnectTimer = null;
  }

  /* ------------------------------- presence ------------------------------ */

  _pushActivity(immediate = false) {
    if (!this._connected) return;
    const wait = immediate
      ? 0
      : this._lastSentAt + UPDATE_MIN_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      if (this._throttleTimer) {
        clearTimeout(this._throttleTimer);
        this._throttleTimer = null;
      }
      this._sendActivity();
      return;
    }
    if (this._throttleTimer) return; // un envoi est déjà planifié, il prendra le dernier état
    this._throttleTimer = setTimeout(() => {
      this._throttleTimer = null;
      this._sendActivity();
    }, wait);
  }

  _sendActivity() {
    if (!this._connected || !this._socket) return;
    this._lastSentAt = Date.now();
    // Textes en anglais : la presence est publique (profil Discord),
    // contrairement à l'UI de l'app qui reste en français.
    const activity = {
      details: 'In the terminal',
      timestamps: { start: this._startedAt },
      // « terma » = clé de l'asset uploadé dans le Developer Portal (Rich
      // Presence → Art Assets). Sans asset, Discord n'affiche pas d'image.
      assets: { large_image: 'terma', large_text: 'Terma' },
    };
    if (this._config.showTabName && this._title) {
      activity.state = `Tab: ${this._title}`;
    }
    this._socket.write(
      encode(OP.FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity },
        nonce: String(++this._nonce),
      })
    );
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }
}

module.exports = { DiscordRpcIntegration };
