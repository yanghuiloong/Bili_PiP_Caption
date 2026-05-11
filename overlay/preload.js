/**
 * preload.js — Electron preload script
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onSubtitleUpdate: (cb) => ipcRenderer.on('subtitle-update', (_e, d) => cb(d)),
  onSettingsLoaded: (cb) => ipcRenderer.on('settings-loaded', (_e, d) => cb(d)),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  saveSettings: (s) => ipcRenderer.send('save-settings', s),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', dx, dy),
});
