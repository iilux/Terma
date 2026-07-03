'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Pont sécurisé renderer <-> main.
 * Le renderer n'a JAMAIS accès direct à node, node-pty ou au filesystem :
 * tout passe par ces fonctions explicitement exposées (contextIsolation: true).
 */

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  // renvoie une fonction de désinscription
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('terma', {
  platform: process.platform,

  pty: {
    create: (opts) => ipcRenderer.invoke('pty:create', opts),
    write: (id, data) => ipcRenderer.send('pty:write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
    kill: (id) => ipcRenderer.send('pty:kill', { id }),
    defaultShell: () => ipcRenderer.invoke('pty:defaultShell'),
    onData: (cb) => subscribe('pty:data', cb),
    onExit: (cb) => subscribe('pty:exit', cb),
    onCwd: (cb) => subscribe('pty:cwd', cb),
  },

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (cb) => subscribe('window:maximized', cb),
  },

  session: {
    load: () => ipcRenderer.invoke('session:load'),
    save: (data) => ipcRenderer.invoke('session:save', data),
    clear: () => ipcRenderer.invoke('session:clear'),
    // export/import d'un onglet en fichier .termasession (dialogues OS)
    exportTab: (payload, suggestedName) =>
      ipcRenderer.invoke('session:exportTab', { payload, suggestedName }),
    importTab: () => ipcRenderer.invoke('session:importTab'),
  },

  themes: {
    list: () => ipcRenderer.invoke('themes:list'),
    save: (fileName, data) => ipcRenderer.invoke('themes:save', { fileName, data }),
    delete: (fileName) => ipcRenderer.invoke('themes:delete', { fileName }),
    import: () => ipcRenderer.invoke('themes:import'),
    export: (fileName, data) => ipcRenderer.invoke('themes:export', { fileName, data }),
    openFolder: () => ipcRenderer.send('themes:openFolder'),
  },

  clipboard: {
    write: (text) => ipcRenderer.send('clipboard:write', text),
    read: () => ipcRenderer.invoke('clipboard:read'),
  },

  openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
});
