'use strict';

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, clipboard, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { PtyManager } = require('./pty-manager');
const { IntegrationManager } = require('./integrations');

const isDev = !app.isPackaged;

let mainWindow = null;
let ptyManager = null;
let integrations = null;

/* --------------------------- mode arrière-plan --------------------------- */
// Fermer la fenêtre n'arrête pas Terma : l'app se replie dans la barre système
// et les shells (donc builds, serveurs, ssh…) continuent de tourner. Rouvrir
// la fenêtre remet l'état vivant, à l'octet près. Piloté par le réglage
// `keepInBackground` du renderer (défaut : activé).
let tray = null;
let isQuitting = false;
let backgroundMode = true; // doit refléter DEFAULT_SETTINGS.keepInBackground (App.jsx)
let trayBalloonShown = false;

// Une seule instance : relancer Terma rouvre la fenêtre existante (sinon les
// shells vivraient dans une instance et la fenêtre dans une autre).
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const userData = () => app.getPath('userData');
const sessionFile = () => path.join(userData(), 'session.json');
const themesDir = () => path.join(userData(), 'themes');

/**
 * Nom de fichier de thème sûr : pas de chemin, charset restreint, extension
 * imposée (.termatheme ou .json). Renvoie null si irrécupérable.
 */
function safeThemeFileName(name) {
  const base = path.basename(String(name || ''));
  if (!/^[a-z0-9._-]+$/i.test(base)) return null;
  if (base.endsWith('.termatheme') || base.endsWith('.json')) return base;
  return base + '.termatheme';
}

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

/** Nom du fichier d'icône de fenêtre : .ico sur Windows, .png ailleurs. */
function windowIconName() {
  return process.platform === 'win32' ? 'icon.ico' : 'icon.png';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 640,
    minHeight: 380,
    frame: false, // pas de titlebar OS — on la dessine nous-mêmes
    backgroundColor: '#0d0d0d',
    // En prod l'icône vient de l'exe ; en dev build/ n'est pas packagé,
    // on la fournit pour la taskbar (le .ico sur Windows pour un rendu net).
    ...(isDev ? { icon: path.join(__dirname, '..', 'build', windowIconName()) } : {}),
    show: false,
    title: 'Terma',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // fenêtre cachée dans le tray : xterm doit continuer à consommer le flux
      // des shells (ses timers seraient sinon ralentis à ~1 Hz)
      backgroundThrottling: false,
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

  // Mode arrière-plan : le X ne ferme pas, il replie dans la barre système
  // (fenêtre cachée, renderer et ptys intacts). Vraie fermeture uniquement via
  // « Quitter » du tray, un quit système, ou si le réglage est désactivé.
  mainWindow.on('close', (e) => {
    if (backgroundMode && !isQuitting) {
      e.preventDefault();
      // dernier instantané de session avant de disparaître de la taskbar
      mainWindow.webContents.send('session:requestSave');
      mainWindow.hide();
      ensureTray();
      return;
    }
    // Vraie fermeture : on tue les shells, sinon les process PowerShell
    // enfants (spawnés par node-pty) deviennent orphelins et survivent.
    ptyManager?.killAll();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Charge l'icône destinée à la barre système. Sur Windows la zone de
 * notification affiche des icônes 16/32 px : lui passer le PNG 512 px la fait
 * tomber sur l'icône générique de Windows. On préfère donc le `.ico`
 * multi-résolutions (Windows y choisit la bonne taille) et on réduit en
 * dernier recours.
 */
async function loadTrayImage() {
  const buildDir = path.join(__dirname, '..', 'build');
  const isWin = process.platform === 'win32';
  // En dev l'icône vient de build/ ; en prod build/ n'est pas packagé, on
  // récupère l'icône de l'exe lui-même.
  const candidates = isWin
    ? [path.join(buildDir, 'icon.ico'), path.join(buildDir, 'icon.png')]
    : [path.join(buildDir, 'icon.png')];
  let image = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (img && !img.isEmpty()) {
        image = img;
        break;
      }
    }
  }
  if (!image || image.isEmpty()) {
    try {
      image = await app.getFileIcon(process.execPath);
    } catch (err) {
      image = nativeImage.createEmpty();
    }
  }
  // Garde-fou : une image trop grande (PNG 512, icône d'exe) s'affiche mal ou
  // pas du tout dans le tray Windows — on la ramène à une taille standard.
  if (isWin && !image.isEmpty()) {
    const { width } = image.getSize();
    if (width > 32) image = image.resize({ width: 32, height: 32 });
  }
  return image;
}

/** Crée l'icône de la barre système (une seule fois). */
async function ensureTray() {
  if (tray) return;
  const image = await loadTrayImage();
  if (tray) return; // deux appels concurrents (close rapide ×2)
  tray = new Tray(image);
  tray.setToolTip('Terma — sessions actives en arrière-plan');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir Terma', click: showMainWindow },
      { type: 'separator' },
      {
        label: 'Quitter',
        click: () => {
          isQuitting = true;
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
          else app.quit();
        },
      },
    ])
  );
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);

  // Premier repli : petite notification pour que l'utilisateur sache que
  // Terma tourne encore (sinon « l'app ne se ferme pas » ressemble à un bug).
  if (!trayBalloonShown && process.platform === 'win32') {
    trayBalloonShown = true;
    try {
      tray.displayBalloon({
        title: 'Terma continue en arrière-plan',
        content:
          'Vos shells restent actifs. Cliquez sur l’icône pour reprendre, clic droit → Quitter pour fermer.',
        iconType: 'info',
      });
    } catch (err) {
      /* balloon non critique */
    }
  }
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

// Le renderer pousse le réglage « continuer en arrière-plan » (persisté chez lui)
ipcMain.on('app:setBackgroundMode', (_e, enabled) => {
  backgroundMode = !!enabled;
  // réglage désactivé pendant que la fenêtre est visible : le tray n'a plus lieu d'être
  if (!backgroundMode && tray && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    tray.destroy();
    tray = null;
  }
});

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

/* ------------------- IPC : export/import d'onglet (.termasession) -------- */
ipcMain.handle('session:exportTab', async (_e, { payload, suggestedName }) => {
  if (!mainWindow) return false;
  const base = path
    .basename(String(suggestedName || 'session.termasession'))
    .replace(/[^a-z0-9 ._()-]/gi, '_');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter la session',
    defaultPath: base,
    filters: [{ name: 'Session Terma', extensions: ['termasession'] }],
  });
  if (canceled || !filePath) return false;
  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[session] export impossible:', err);
    return false;
  }
});

ipcMain.handle('session:importTab', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Importer une session',
    properties: ['openFile'],
    filters: [
      { name: 'Session Terma', extensions: ['termasession', 'json'] },
      { name: 'Tous les fichiers', extensions: ['*'] },
    ],
  });
  if (canceled || filePaths.length === 0) return { canceled: true };
  try {
    return { data: JSON.parse(fs.readFileSync(filePaths[0], 'utf8')) };
  } catch (err) {
    return { error: 'Fichier illisible ou JSON invalide' };
  }
});

/* ------------------------------ IPC : thèmes ----------------------------- */
// Les thèmes sont des DONNÉES (JSON), jamais du code : le main se contente de
// lire/écrire le dossier userData/themes ; la validation fine (whitelist des
// clés/valeurs) est faite côté renderer (src/themes/themeHost.js).
ipcMain.handle('themes:list', () => {
  try {
    return fs
      .readdirSync(themesDir())
      .filter((f) => f.endsWith('.termatheme') || f.endsWith('.json'))
      .map((fileName) => {
        try {
          const data = JSON.parse(
            fs.readFileSync(path.join(themesDir(), fileName), 'utf8')
          );
          return { fileName, data };
        } catch (err) {
          return null; // fichier corrompu : ignoré
        }
      })
      .filter(Boolean);
  } catch (err) {
    return [];
  }
});

ipcMain.handle('themes:save', (_e, { fileName, data }) => {
  const safe = safeThemeFileName(fileName);
  if (!safe || !data || typeof data !== 'object') return false;
  try {
    fs.writeFileSync(
      path.join(themesDir(), safe),
      JSON.stringify(data, null, 2),
      'utf8'
    );
    return true;
  } catch (err) {
    console.error('[themes] écriture impossible:', err);
    return false;
  }
});

ipcMain.handle('themes:delete', (_e, { fileName }) => {
  const safe = safeThemeFileName(fileName);
  if (!safe) return false;
  try {
    fs.unlinkSync(path.join(themesDir(), safe));
    return true;
  } catch (err) {
    return false;
  }
});

ipcMain.handle('themes:import', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Importer un thème',
    properties: ['openFile'],
    filters: [
      { name: 'Thème Terma', extensions: ['termatheme', 'json'] },
      { name: 'Tous les fichiers', extensions: ['*'] },
    ],
  });
  if (canceled || filePaths.length === 0) return { canceled: true };
  try {
    return {
      fileName: path.basename(filePaths[0]),
      data: JSON.parse(fs.readFileSync(filePaths[0], 'utf8')),
    };
  } catch (err) {
    return { error: 'Fichier illisible ou JSON invalide' };
  }
});

ipcMain.handle('themes:export', async (_e, { fileName, data }) => {
  if (!mainWindow || !data || typeof data !== 'object') return false;
  const base = path
    .basename(String(fileName || 'theme.termatheme'))
    .replace(/[^a-z0-9 ._()-]/gi, '_');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter le thème',
    defaultPath: base,
    filters: [{ name: 'Thème Terma', extensions: ['termatheme'] }],
  });
  if (canceled || !filePath) return false;
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[themes] export impossible:', err);
    return false;
  }
});

ipcMain.on('themes:openFolder', () => {
  shell.openPath(themesDir());
});

/* --------------------------- IPC : fond d'écran -------------------------- */
// L'image choisie reste chez l'utilisateur : on stocke son CHEMIN dans les
// réglages et on la relit à chaque lancement, convertie en data URL (le
// renderer n'a pas accès au filesystem). Extension whitelistée + taille bornée.
const BG_IMAGE_MIMES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};
const BG_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

function readImageAsDataUrl(filePath) {
  const mime = BG_IMAGE_MIMES[path.extname(String(filePath)).toLowerCase()];
  if (!mime) return null;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > BG_IMAGE_MAX_BYTES) return null;
    return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch (err) {
    return null;
  }
}

ipcMain.handle('background:pick', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Choisir une image d'arrière-plan",
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] },
    ],
  });
  if (canceled || filePaths.length === 0) return { canceled: true };
  const dataUrl = readImageAsDataUrl(filePaths[0]);
  if (!dataUrl) return { error: 'Image illisible ou trop lourde (25 Mo max)' };
  return { path: filePaths[0], dataUrl };
});

ipcMain.handle('background:load', (_e, filePath) =>
  typeof filePath === 'string' ? readImageAsDataUrl(filePath) : null
);

/* ---------------------------- IPC : presse-papier ------------------------ */
ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(text == null ? '' : String(text)));
ipcMain.handle('clipboard:read', () => clipboard.readText());

/* --------------------------- IPC : intégrations -------------------------- */
// L'état activé/config vient du renderer (persisté dans ses réglages) ; le
// main se contente d'appliquer. Payloads validés : ils pilotent des modules.
ipcMain.on('integrations:setState', (_e, payload) => {
  if (!payload || typeof payload.id !== 'string') return;
  const config =
    payload.config && typeof payload.config === 'object' ? payload.config : {};
  integrations?.setState(payload.id, !!payload.enabled, config);
});

ipcMain.on('presence:update', (_e, payload) => {
  integrations?.setPresence({
    title: typeof payload?.title === 'string' ? payload.title : null,
  });
});

/* ------------------------------- IPC : shell ----------------------------- */
ipcMain.on('shell:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

/* ------------------------------ App lifecycle ---------------------------- */
app.whenReady().then(() => {
  // Windows associe l'icône de la barre des tâches / du tray à l'AppUserModelID.
  // Sans lui, Windows retombe sur l'icône générique. Doit valoir l'appId
  // d'electron-builder (electron-builder.yml → appId).
  if (process.platform === 'win32') app.setAppUserModelId('com.terma.app');

  // Aucun menu OS natif (contrainte : zéro élément natif visible)
  Menu.setApplicationMenu(null);

  ensureUserDirs();
  ptyManager = new PtyManager(
    () => mainWindow,
    path.join(userData(), 'shell-integration')
  );
  integrations = new IntegrationManager((id, status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('integrations:status', { id, status });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Deuxième lancement de l'exe pendant que Terma tourne (souvent caché dans
  // le tray) : on rouvre la fenêtre existante au lieu de créer une instance.
  app.on('second-instance', () => showMainWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // quit système (arrêt de session, installeur…) : ne pas intercepter le close
  isQuitting = true;
  ptyManager?.killAll();
  integrations?.disposeAll();
  tray?.destroy();
  tray = null;
});
