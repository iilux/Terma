'use strict';

/**
 * Lanceur de dev pour Electron.
 *
 * 1) Certains hôtes (VSCode, terminaux intégrés, Claude Code…) positionnent
 *    `ELECTRON_RUN_AS_NODE=1` dans l'environnement. Cette variable force Electron
 *    à démarrer comme un simple Node.js : `require('electron')` renvoie alors un
 *    chemin au lieu de l'API, et `app` devient `undefined` → crash au démarrage.
 *    On la retire de l'environnement transmis à Electron.
 *
 * 2) Sur Windows, un Ctrl+C dans le terminal peut tuer Electron sans qu'il
 *    nettoie ses shells (PowerShell spawné par node-pty → process orphelins).
 *    On intercepte donc les signaux et on tue tout l'arbre de process Electron.
 */

const { spawn, execSync } = require('child_process');
const electronPath = require('electron'); // sous Node, renvoie le chemin du binaire

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });

let killing = false;
function killTree() {
  if (killing) return;
  killing = true;
  try {
    if (process.platform === 'win32') {
      // /T = arbre complet (Electron + ConPTY + PowerShell), /F = forcé
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch (err) {
    /* le process est peut-être déjà mort */
  }
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => {
    killTree();
    process.exit(0);
  });
}

child.on('close', (code) => process.exit(code == null ? 0 : code));
child.on('error', (err) => {
  console.error("[launch-dev] échec du lancement d'Electron:", err);
  process.exit(1);
});
