'use strict';

/**
 * Lanceur de développement de Terma.
 *
 * Remplace concurrently + wait-on + cross-env par un seul script qui maîtrise
 * le cycle de vie des deux process (Vite + Electron). Objectif : quand tu fermes
 * la fenêtre Electron (ou fais Ctrl+C), TOUT est arrêté proprement — plus de
 * Vite fantôme qui garde le port 5173, plus de shell PowerShell orphelin.
 *
 * Détails Windows importants :
 *  - `ELECTRON_RUN_AS_NODE` (souvent positionné par VSCode/hôtes) est retiré de
 *    l'environnement d'Electron, sinon Electron démarre comme un simple Node.
 *  - On tue les process avec `taskkill /T` (arbre complet : Electron + ConPTY +
 *    PowerShell), car un simple kill laisse les enfants orphelins.
 */

const { spawn, execSync } = require('child_process');
const net = require('net');
const path = require('path');

const VITE_HOST = '127.0.0.1';
const VITE_PORT = 5173;
const isWin = process.platform === 'win32';
const root = path.join(__dirname, '..');

function killTree(pid) {
  if (!pid) return;
  try {
    if (isWin) {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch (err) {
    /* déjà mort */
  }
}

let shuttingDown = false;
let electron = null;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  killTree(electron && electron.pid);
  killTree(vite.pid);
  process.exit(code == null ? 0 : code);
}

/* ------------------------------- 1) Vite -------------------------------- */
// Vite 8 n'expose pas ./bin/vite.js via "exports" → on résout le dossier du
// package (package.json est exporté) puis on pointe le binaire directement.
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
vite.on('close', (code) => shutdown(code)); // si Vite meurt, on arrête tout

/* ------------------- 2) attendre le serveur puis Electron --------------- */
function waitForPort(attempt = 0) {
  if (shuttingDown) return;
  if (attempt > 100) {
    console.error('[dev] Vite ne répond pas sur le port', VITE_PORT);
    return shutdown(1);
  }
  const socket = net.connect(VITE_PORT, VITE_HOST);
  socket.once('connect', () => {
    socket.destroy();
    startElectron();
  });
  socket.once('error', () => {
    socket.destroy();
    setTimeout(() => waitForPort(attempt + 1), 300);
  });
}

function startElectron() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronPath = require('electron'); // sous Node : chemin du binaire
  electron = spawn(electronPath, ['.'], { cwd: root, stdio: 'inherit', env });

  // fermer la fenêtre Electron => Electron s'arrête => on coupe Vite et on sort
  electron.on('close', (code) => shutdown(code));
  electron.on('error', (err) => {
    console.error("[dev] échec du lancement d'Electron:", err);
    shutdown(1);
  });
}

waitForPort();

/* ------------------------- 3) signaux terminal -------------------------- */
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => shutdown(0));
}
