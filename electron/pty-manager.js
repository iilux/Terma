'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const pty = require('node-pty');

const isWindows = process.platform === 'win32';

const ESC = String.fromCharCode(27); // ESC \x1b
const BEL = String.fromCharCode(7);  // BEL \x07

/**
 * Intégration shell PowerShell : on injecte une fonction `prompt` qui émet une
 * séquence OSC 7 (file://<cwd>) à chaque affichage du prompt. C'est ainsi que
 * l'on connaît le répertoire courant pour la persistance (Phase 3), sans modifier
 * l'apparence du prompt de l'utilisateur (on préserve son prompt d'origine).
 */
const POWERSHELL_INTEGRATION = [
  'if (-not $global:__termaIntegrated) {',
  '  $global:__termaIntegrated = $true',
  '  $global:__termaOrigPrompt = $function:prompt',
  '  function global:prompt {',
  '    $loc = (Get-Location).ProviderPath',
  '    if ($loc) {',
  '      $uri = ($loc -replace "\\\\", "/")',
  '      [Console]::Write("$([char]27)]7;file:///$uri$([char]27)\\")',
  '    }',
  '    if ($global:__termaOrigPrompt) { & $global:__termaOrigPrompt } else { "PS $((Get-Location).Path)> " }',
  '  }',
  '}',
].join('\n');

/** Détecte le shell par défaut de l'OS (PowerShell sur Windows, fallback cmd). */
function detectDefaultShell() {
  if (isWindows) {
    const pwsh = process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe')
      : null;
    const winPwsh = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    if (pwsh && fs.existsSync(pwsh)) return pwsh;
    if (fs.existsSync(winPwsh)) return winPwsh;
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

/** Construit les arguments de lancement selon le shell. */
function buildArgs(shellPath, integrationScriptPath) {
  const base = path.basename(shellPath).toLowerCase();
  if (base === 'powershell.exe' || base === 'pwsh.exe') {
    const args = ['-NoLogo'];
    if (integrationScriptPath) {
      // -NoExit garde la session interactive après l'exécution du script d'intégration
      args.push('-NoExit', '-File', integrationScriptPath);
    }
    return args;
  }
  return [];
}

class PtyManager {
  /**
   * @param {() => Electron.BrowserWindow | null} getWindow accès paresseux à la fenêtre
   * @param {string} integrationDir dossier où écrire le script d'intégration shell
   */
  constructor(getWindow, integrationDir) {
    this.getWindow = getWindow;
    this.ptys = new Map(); // id -> { pty, cwd, carry }
    this.integrationScriptPath = null;
    this._writeIntegrationScript(integrationDir);
  }

  _writeIntegrationScript(dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, 'powershell-integration.ps1');
      fs.writeFileSync(p, POWERSHELL_INTEGRATION, 'utf8');
      this.integrationScriptPath = p;
    } catch (err) {
      console.error("[pty] impossible d'écrire le script d'intégration:", err);
      this.integrationScriptPath = null;
    }
  }

  defaultShellInfo() {
    const shellPath = detectDefaultShell();
    return { path: shellPath, name: path.basename(shellPath) };
  }

  /**
   * Crée une session pty.
   * `inheritCursor` : ConPTY démarre à la position actuelle du curseur au lieu
   * de repeindre l'écran depuis le haut — indispensable quand le renderer vient
   * de réinjecter un scrollback restauré (sinon le clear initial l'efface).
   * @param {{id:string, cwd?:string, shell?:string, cols?:number, rows?:number, inheritCursor?:boolean}} opts
   */
  create(opts = {}) {
    const id = opts.id;
    if (!id) throw new Error('pty.create: id requis');
    if (this.ptys.has(id)) return { id }; // déjà créé

    const shellPath = opts.shell || detectDefaultShell();
    const base = path.basename(shellPath).toLowerCase();
    const usesIntegration = base === 'powershell.exe' || base === 'pwsh.exe';
    const args = buildArgs(shellPath, usesIntegration ? this.integrationScriptPath : null);

    const cwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : os.homedir();

    const child = pty.spawn(shellPath, args, {
      name: 'xterm-256color',
      cols: opts.cols || 80,
      rows: opts.rows || 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      useConpty: isWindows, // ConPTY = rendu ANSI correct sur Windows 10+
      conptyInheritCursor: isWindows && !!opts.inheritCursor,
    });

    const entry = { pty: child, cwd, carry: '' };
    this.ptys.set(id, entry);

    child.onData((data) => {
      this._scanCwd(id, data);
      const win = this.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:data', { id, data });
      }
    });

    child.onExit(({ exitCode, signal }) => {
      this.ptys.delete(id);
      const win = this.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:exit', { id, exitCode, signal });
      }
    });

    return { id, shell: shellPath, cwd };
  }

  write(id, data) {
    const entry = this.ptys.get(id);
    if (entry) entry.pty.write(data);
  }

  resize(id, cols, rows) {
    const entry = this.ptys.get(id);
    if (entry && cols > 0 && rows > 0) {
      try {
        entry.pty.resize(cols, rows);
      } catch (err) {
        // resize peut échouer si le process vient de mourir — ignorable
      }
    }
  }

  kill(id) {
    const entry = this.ptys.get(id);
    if (entry) {
      try {
        entry.pty.kill();
      } catch (err) {
        /* ignore */
      }
      this.ptys.delete(id);
    }
  }

  killAll() {
    for (const id of Array.from(this.ptys.keys())) this.kill(id);
  }

  /**
   * Cherche une séquence OSC 7 (file://...) dans le flux pour mettre à jour le cwd.
   * On garde un petit reliquat (`carry`) au cas où la séquence est coupée entre 2 chunks.
   */
  _scanCwd(id, data) {
    const entry = this.ptys.get(id);
    if (!entry) return;

    const buf = entry.carry + data;
    // OSC 7 : ESC ] 7 ; file://<host>/<path> ST   (ST = BEL ou ESC \)
    const re = new RegExp(
      ESC + '\\]7;file://([^' + ESC + BEL + ']*)(?:' + BEL + '|' + ESC + '\\\\)',
      'g'
    );
    let match;
    let lastCwd = null;
    while ((match = re.exec(buf)) !== null) {
      lastCwd = this._parseFileUri(match[1]);
    }
    // conserver la fin du buffer (séquence potentiellement incomplète)
    entry.carry = buf.length > 256 ? buf.slice(-256) : buf;

    if (lastCwd && lastCwd !== entry.cwd) {
      entry.cwd = lastCwd;
      const win = this.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:cwd', { id, cwd: lastCwd });
      }
    }
  }

  _parseFileUri(raw) {
    try {
      // raw = "<host>/C:/Users/..." (host vide pour file:///)
      let p = raw.replace(/^[^/]*/, ''); // retire l'éventuel host
      p = decodeURIComponent(p);
      if (isWindows) {
        p = p.replace(/^\//, '').replace(/\//g, '\\'); // /C:/x -> C:\x
      }
      return p || null;
    } catch (err) {
      return null;
    }
  }
}

module.exports = { PtyManager, detectDefaultShell };
