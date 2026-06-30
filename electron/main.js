'use strict';

const { app, BrowserWindow, ipcMain, Menu, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { PtyManager } = require('./pty-manager');

const isDev = !app.isPackaged;

let mainWindow = null;
let ptyManager = null;

const userData = () => app.getPath('userData');
const sessionFile = () => path.join(userData(), 'session.json');

/** Crée les dossiers attendus au premier lancement (themes/extensions — Phases 4 & 5). */
function ensureUserDirs() {
  for (const name of ['themes', 'extensions']) {
    try {
      fs.mkdirSync(path.join(userData(), name), { recursive: true });
    } catch (err) {
      /* ignore */
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 640,
    minHeight: 380,
    frame: false, // pas de titlebar OS — on la dessine nous-mêmes
    backgroundColor: '#0d0d0d',
    show: false,
    title: 'Terma',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
    // DevTools ne s'ouvre PLUS automatiquement — bascule manuelle via F12 / Ctrl+Shift+I
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Raccourci pour ouvrir/fermer les DevTools à la demande (dev comme prod)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = (input.key || '').toLowerCase();
    if (key === 'f12' || (input.control && input.shift && key === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  const sendMaxState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', sendMaxState);
  mainWindow.on('unmaximize', sendMaxState);

  // On tue les shells dès la fermeture de la fenêtre : sinon les process
  // PowerShell enfants (spawnés par node-pty) deviennent orphelins et survivent.
  mainWindow.on('close', () => {
    ptyManager?.killAll();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ----------------------------- IPC : fenêtre ----------------------------- */
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => !!mainWindow?.isMaximized());

/* ------------------------------- IPC : pty ------------------------------- */
ipcMain.handle('pty:create', (_e, opts) => ptyManager.create(opts));
ipcMain.on('pty:write', (_e, { id, data }) => ptyManager.write(id, data));
ipcMain.on('pty:resize', (_e, { id, cols, rows }) => ptyManager.resize(id, cols, rows));
ipcMain.on('pty:kill', (_e, { id }) => ptyManager.kill(id));
ipcMain.handle('pty:defaultShell', () => ptyManager.defaultShellInfo());

/* ----------------------------- IPC : session ----------------------------- */
ipcMain.handle('session:load', () => {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
  } catch (err) {
    return null; // pas de session précédente
  }
});
ipcMain.handle('session:save', (_e, data) => {
  try {
    fs.writeFileSync(sessionFile(), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[session] échec sauvegarde:', err);
    return false;
  }
});
ipcMain.handle('session:clear', () => {
  try {
    fs.unlinkSync(sessionFile());
  } catch (err) {
    /* déjà absent */
  }
  return true;
});

/* ---------------------------- IPC : presse-papier ------------------------ */
ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(text == null ? '' : String(text)));
ipcMain.handle('clipboard:read', () => clipboard.readText());

/* ------------------------------- IPC : shell ----------------------------- */
ipcMain.on('shell:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

/* ------------------------------ App lifecycle ---------------------------- */
app.whenReady().then(() => {
  // Aucun menu OS natif (contrainte : zéro élément natif visible)
  Menu.setApplicationMenu(null);

  ensureUserDirs();
  ptyManager = new PtyManager(
    () => mainWindow,
    path.join(userData(), 'shell-integration')
  );

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  ptyManager?.killAll();
});
