/**
 * main.js — Electron overlay (launched via Native Messaging)
 * Fixes: no taskbar icon, proper hover, better drag, clean background.
 */
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const WS_PORT = 18520;
const SETTINGS_PATH = path.join(__dirname, 'settings.json');

// Redirect console to stderr so stdout stays clean for Native Messaging
const _log = (...a) => process.stderr.write('[Overlay] ' + a.join(' ') + '\n');

let mainWindow = null;
let wss = null;
let fixedW = 0;
let fixedH = 0;

// ─── Settings ─────────────────────────────────────────────────────
const defaults = { fontSize: 32, fontColor: '#ffffff', x: null, y: null, w: null, h: null };
let settings = { ...defaults };

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH))
      settings = { ...defaults, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) };
  } catch (_) {}
}

function saveSettings() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const b = mainWindow.getBounds();
      Object.assign(settings, { x: b.x, y: b.y, w: fixedW, h: fixedH });
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (_) {}
}

// ─── Window ───────────────────────────────────────────────────────
function createOverlayWindow() {
  loadSettings();
  const { width: sW, height: sH } = screen.getPrimaryDisplay().workAreaSize;
  const w = settings.w || Math.round(sW * 0.85); // 85% width to avoid needing resize
  const h = settings.h || 180; // 180px height to safely hold 2 lines of large text
  
  fixedW = w;
  fixedH = h;

  const x = settings.x ?? Math.round((sW - w) / 2);
  const y = settings.y ?? (sH - h - 60);

  mainWindow = new BrowserWindow({
    width: w, height: h, x, y,
    title: '',              // no title text
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,       // hide from taskbar
    resizable: false,        // 禁用调整大小！防止误触边缘导致高度变大、字幕偏离菜单栏
    hasShadow: false,
    focusable: false,        // never steal focus
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    thickFrame: false,       // prevents taskbar flash on Windows
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.setSkipTaskbar(true);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('settings-loaded', {
      fontSize: settings.fontSize, fontColor: settings.fontColor
    });
  });

  mainWindow.on('moved', saveSettings);
  mainWindow.on('resized', saveSettings);

  // Periodically ensure skipTaskbar stays true (Windows workaround)
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setSkipTaskbar(true);
    }
  }, 2000);
}

// ─── IPC: hover-based mouse toggle ───────────────────────────────
ipcMain.on('set-ignore-mouse', (_e, ignore) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (ignore) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
  // Always force these after any mouse state change
  mainWindow.setSkipTaskbar(true);
});

ipcMain.on('save-settings', (_e, s) => {
  if (s.fontSize !== undefined) settings.fontSize = s.fontSize;
  if (s.fontColor !== undefined) settings.fontColor = s.fontColor;
  saveSettings();
});

ipcMain.on('move-window', (_e, dx, dy) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition();
    // Force the exact same width and height so Windows DPI scaling doesn't subtly stretch the window!
    mainWindow.setBounds({
      x: Math.round(x + dx),
      y: Math.round(y + dy),
      width: fixedW,
      height: fixedH
    });
  }
});

// ─── WebSocket ────────────────────────────────────────────────────
function startWebSocketServer() {
  wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });
  wss.on('listening', () => _log('WebSocket listening on port ' + WS_PORT));

  wss.on('connection', (ws) => {
    _log('Extension connected');
    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === 'subtitle-text') {
          mainWindow?.webContents.send('subtitle-update', { text: data.text });
        }
      } catch (_) {}
    });
    ws.on('close', () => _log('Extension disconnected'));
  });

  wss.on('error', (err) => _log('WebSocket error: ' + err.message));
}

// ─── Lifecycle ────────────────────────────────────────────────────
app.whenReady().then(() => {
  createOverlayWindow();
  startWebSocketServer();
  mainWindow.showInactive(); // show without taking focus
  mainWindow.setSkipTaskbar(true);
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => { saveSettings(); wss?.close(); });
