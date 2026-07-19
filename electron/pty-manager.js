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

/**
 * Intégration shell POSIX (macOS/Linux) : même principe que PowerShell — un
 * hook de prompt émet OSC 7 à chaque affichage du prompt. AUCUN fichier de
 * l'utilisateur n'est modifié : tout vit dans userData/shell-integration.
 *
 * zsh : on ne peut pas passer un rc en argument, mais zsh lit ses fichiers de
 * démarrage dans $ZDOTDIR. On pointe donc ZDOTDIR vers un dossier de « shims »
 * (.zshenv/.zprofile/.zshrc) qui sourcent chacun le fichier homonyme de
 * l'utilisateur (via _TERMA_USER_ZDOTDIR) puis, dans .zshrc, ajoutent le hook
 * precmd et RESTAURENT le ZDOTDIR d'origine — .zlogin et tout shell zsh
 * imbriqué relisent ensuite la config utilisateur normale. C'est l'approche
 * de VS Code et kitty.
 */
const ZSH_SHIM_SOURCE_USER = (file) =>
  [
    '# Généré par Terma (intégration shell) — ne pas éditer.',
    '_terma_zdotdir="$ZDOTDIR"',
    `if [[ -f "$_TERMA_USER_ZDOTDIR/${file}" ]]; then`,
    '  ZDOTDIR="$_TERMA_USER_ZDOTDIR"',
    `  . "$_TERMA_USER_ZDOTDIR/${file}"`,
    // l'utilisateur peut déplacer sa config en changeant ZDOTDIR (ex: .zshenv)
    '  _TERMA_USER_ZDOTDIR="$ZDOTDIR"',
    '  ZDOTDIR="$_terma_zdotdir"',
    'fi',
  ].join('\n') + '\n';

const ZSH_SHIM_ZSHRC_HOOK = [
  '',
  '# Hook de prompt : signale le répertoire courant à Terma via OSC 7.',
  'autoload -Uz add-zsh-hook',
  '__terma_report_cwd() { printf \'\\033]7;file://%s%s\\033\\\\\' "${HOST:-}" "$PWD" }',
  'add-zsh-hook precmd __terma_report_cwd',
  '__terma_report_cwd',
  '',
  '# /etc/zshrc (macOS) fixe HISTFILE d’après ZDOTDIR avant nos shims : si',
  '# l’utilisateur ne l’a pas redéfini, on le ramène vers SON historique.',
  'if [[ "$HISTFILE" == "$_terma_zdotdir/.zsh_history" ]]; then',
  '  HISTFILE="${_TERMA_USER_ZDOTDIR:-$HOME}/.zsh_history"',
  'fi',
  '',
  '# Fin du démarrage piloté par Terma : on rend son ZDOTDIR à l’utilisateur.',
  'if [[ -n "$_TERMA_USER_ZDOTDIR" && "$_TERMA_USER_ZDOTDIR" != "$HOME" ]]; then',
  '  ZDOTDIR="$_TERMA_USER_ZDOTDIR"',
  'else',
  '  unset ZDOTDIR',
  'fi',
  'unset _terma_zdotdir _TERMA_USER_ZDOTDIR',
  '',
].join('\n');

// bash : --rcfile remplace ~/.bashrc, donc notre fichier rejoue d'abord la
// chaîne de démarrage login classique (profile) puis ajoute le hook de prompt.
const BASH_INTEGRATION = [
  '# Généré par Terma (intégration shell) — ne pas éditer.',
  '[ -f /etc/profile ] && . /etc/profile',
  'for _terma_f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do',
  '  if [ -f "$_terma_f" ]; then . "$_terma_f"; break; fi',
  'done',
  'unset _terma_f',
  '',
  '# Hook de prompt : signale le répertoire courant à Terma via OSC 7.',
  '__terma_report_cwd() { printf \'\\033]7;file://%s%s\\033\\\\\' "${HOSTNAME:-}" "$PWD"; }',
  'PROMPT_COMMAND="__terma_report_cwd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"',
  '__terma_report_cwd',
  '',
].join('\n');

/** Détecte le shell par défaut de l'OS (PowerShell sur Windows, sinon $SHELL). */
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
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

/**
 * Construit les arguments de lancement selon le shell.
 * @param {string} shellPath
 * @param {{ powershell: string|null, bashRc: string|null }} integration
 */
function buildArgs(shellPath, integration) {
  const base = path.basename(shellPath).toLowerCase();
  if (base === 'powershell.exe' || base === 'pwsh.exe' || base === 'pwsh') {
    const args = ['-NoLogo'];
    if (integration.powershell) {
      // -NoExit garde la session interactive après l'exécution du script d'intégration
      args.push('-NoExit', '-File', integration.powershell);
    }
    return args;
  }
  if (isWindows) return []; // cmd.exe et autres shells Windows
  if (base === 'bash' && integration.bashRc) {
    // pas de -l : le rcfile rejoue lui-même la chaîne login (voir BASH_INTEGRATION)
    return ['--rcfile', integration.bashRc];
  }
  // Shell login : une app GUI (macOS surtout) hérite d'un PATH minimal — le
  // login shell recharge le vrai environnement (Homebrew, nvm…). zsh reçoit
  // son intégration via ZDOTDIR (env), posé dans create().
  return ['-l'];
}

class PtyManager {
  /**
   * @param {() => Electron.BrowserWindow | null} getWindow accès paresseux à la fenêtre
   * @param {string} integrationDir dossier où écrire le script d'intégration shell
   */
  constructor(getWindow, integrationDir) {
    this.getWindow = getWindow;
    this.ptys = new Map(); // id -> { pty, cwd, carry }
    this.integrationScriptPath = null; // PowerShell (.ps1)
    this.bashRcPath = null; // bash (--rcfile)
    this.zshDotDir = null; // zsh (ZDOTDIR de shims)
    this._writeIntegrationScripts(integrationDir);
  }

  _writeIntegrationScripts(dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, 'powershell-integration.ps1');
      fs.writeFileSync(p, POWERSHELL_INTEGRATION, 'utf8');
      this.integrationScriptPath = p;
    } catch (err) {
      console.error("[pty] impossible d'écrire le script d'intégration:", err);
      this.integrationScriptPath = null;
    }

    if (isWindows) return;

    // Shims POSIX — uniquement dans userData, jamais dans le HOME de l'utilisateur.
    try {
      const bashRc = path.join(dir, 'bash-integration.bash');
      fs.writeFileSync(bashRc, BASH_INTEGRATION, 'utf8');
      this.bashRcPath = bashRc;
    } catch (err) {
      console.error("[pty] intégration bash impossible:", err);
      this.bashRcPath = null;
    }
    try {
      const zshDir = path.join(dir, 'zsh');
      fs.mkdirSync(zshDir, { recursive: true });
      fs.writeFileSync(path.join(zshDir, '.zshenv'), ZSH_SHIM_SOURCE_USER('.zshenv'), 'utf8');
      fs.writeFileSync(path.join(zshDir, '.zprofile'), ZSH_SHIM_SOURCE_USER('.zprofile'), 'utf8');
      fs.writeFileSync(
        path.join(zshDir, '.zshrc'),
        ZSH_SHIM_SOURCE_USER('.zshrc') + ZSH_SHIM_ZSHRC_HOOK,
        'utf8'
      );
      this.zshDotDir = zshDir;
    } catch (err) {
      console.error("[pty] intégration zsh impossible:", err);
      this.zshDotDir = null;
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
    const args = buildArgs(shellPath, {
      powershell: this.integrationScriptPath,
      bashRc: this.bashRcPath,
    });

    const cwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : os.homedir();

    const env = { ...process.env, TERM: 'xterm-256color' };
    if (!isWindows) {
      // Une app GUI n'hérite pas toujours d'une locale : sans LANG, vim/less &
      // co retombent en ASCII. On ne touche pas à une valeur existante.
      if (!env.LANG) env.LANG = 'en_US.UTF-8';
      // Intégration zsh : les shims (voir plus haut) sourcent la config de
      // l'utilisateur depuis _TERMA_USER_ZDOTDIR puis restaurent son ZDOTDIR.
      if (base === 'zsh' && this.zshDotDir) {
        env._TERMA_USER_ZDOTDIR = process.env.ZDOTDIR || os.homedir();
        env.ZDOTDIR = this.zshDotDir;
      }
    }

    const child = pty.spawn(shellPath, args, {
      name: 'xterm-256color',
      cols: opts.cols || 80,
      rows: opts.rows || 24,
      cwd,
      env,
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
