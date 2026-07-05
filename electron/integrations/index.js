'use strict';

const { DiscordRpcIntegration } = require('./discord-rpc');

/**
 * Registre des intégrations optionnelles (Discord Rich Presence, …).
 *
 * Principe : chaque intégration est un module isolé de ce dossier, jamais
 * chargé « à chaud » depuis l'extérieur — c'est l'architecture d'un système
 * d'extensions sans le mécanisme d'installation. Le renderer est la source de
 * vérité de l'état activé/config (persisté dans session.json) et le pousse ici
 * via IPC ; le main ne stocke rien.
 *
 * Contrat d'un module :
 *   id, name          — identité (l'id est la clé côté réglages)
 *   enabled, status   — état courant, lisible à tout moment
 *   activate(config)  — démarre l'intégration (désactivée par défaut)
 *   deactivate()      — arrête tout et libère les ressources
 *   setConfig(config) — met à jour la config sans redémarrer
 *   setPresence(p)    — optionnel : reçoit l'état « présence » (onglet actif…)
 *   onStatus          — callback posé par le manager pour remonter le statut
 */
class IntegrationManager {
  /** @param {(id: string, status: string) => void} onStatus */
  constructor(onStatus) {
    this._modules = new Map();
    this._onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.register(new DiscordRpcIntegration());
  }

  register(mod) {
    mod.onStatus = (status) => this._onStatus(mod.id, status);
    this._modules.set(mod.id, mod);
  }

  setState(id, enabled, config) {
    const mod = this._modules.get(id);
    if (!mod) return;
    if (!enabled) {
      if (mod.enabled) mod.deactivate();
    } else if (mod.enabled) {
      mod.setConfig(config);
    } else {
      mod.activate(config);
    }
  }

  /** Diffuse l'état de présence aux modules actifs qui s'y intéressent. */
  setPresence(payload) {
    for (const mod of this._modules.values()) {
      if (mod.enabled && typeof mod.setPresence === 'function') {
        mod.setPresence(payload);
      }
    }
  }

  disposeAll() {
    for (const mod of this._modules.values()) {
      if (mod.enabled) mod.deactivate();
    }
  }
}

module.exports = { IntegrationManager };
