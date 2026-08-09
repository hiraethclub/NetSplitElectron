'use strict';

const { app, BrowserWindow, ipcMain, Menu, shell, nativeTheme } = require('electron');
const path = require('path');
const { IRCConnection } = require('./ircConnection');

/** @type {Map<string, IRCConnection>} */
const connections = new Map();

/** @type {BrowserWindow | null} */
let mainWindow = null;

function emitToRenderer(id, event, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('irc:event', { id, event, payload });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#1e1e1e',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: 'Netsplit',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Open external links (http/https) in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Headless smoke test: capture renderer errors, screenshot, then quit.
  if (process.env.NETSPLIT_SMOKE) {
    const errors = [];
    mainWindow.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) errors.push(message); // 2 = warning, 3 = error
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) =>
      errors.push('render-process-gone: ' + JSON.stringify(details)));
    mainWindow.webContents.on('did-finish-load', async () => {
      if (process.env.NETSPLIT_SMOKE_DEMO) {
        try { await mainWindow.webContents.executeJavaScript('window.netsplitSeedDemo && window.netsplitSeedDemo()'); } catch (_) {}
      }
      setTimeout(async () => {
        try {
          const img = await mainWindow.webContents.capturePage();
          require('fs').writeFileSync(process.env.NETSPLIT_SMOKE, img.toPNG());
        } catch (e) {
          errors.push('screenshot failed: ' + e.message);
        }
        if (errors.length) {
          console.log('SMOKE_ERRORS:\n' + errors.join('\n'));
          app.exit(1);
        } else {
          console.log('SMOKE_OK');
          app.exit(0);
        }
      }, 1500);
    });
  }
}

// ---------------------------------------------------------------------------
// IPC: connection management
// ---------------------------------------------------------------------------

ipcMain.handle('irc:connect', (_event, { id, options }) => {
  // Replace any existing connection for this profile.
  const existing = connections.get(id);
  if (existing) existing.disconnect();

  const conn = new IRCConnection(id, options, emitToRenderer);
  connections.set(id, conn);
  conn.connect();
  return { ok: true };
});

ipcMain.handle('irc:send', (_event, { id, command }) => {
  const conn = connections.get(id);
  if (!conn) return { ok: false, error: 'no-connection' };
  const sent = conn.send(command);
  return { ok: sent };
});

ipcMain.handle('irc:disconnect', (_event, { id }) => {
  const conn = connections.get(id);
  if (conn) conn.disconnect();
  return { ok: true };
});

ipcMain.handle('irc:openExternal', (_event, { url }) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
  return { ok: true };
});

ipcMain.handle('theme:systemIsDark', () => {
  return nativeTheme.shouldUseDarkColors;
});

ipcMain.handle('window:focus', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  return { ok: true };
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  buildApplicationMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const conn of connections.values()) conn.disconnect();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const conn of connections.values()) conn.disconnect();
});

function buildApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Connection…',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow && mainWindow.webContents.send('menu:addConnection'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette…',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow && mainWindow.webContents.send('menu:commandPalette'),
        },
        {
          label: 'Load Demo Server',
          click: () => mainWindow && mainWindow.webContents.send('menu:demo'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
