const { app, BrowserWindow, shell, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const {
  detectSystemGitHub,
  startDeviceFlow,
  pollDeviceFlow,
  saveEncryptedToken,
  loadEncryptedToken,
  clearEncryptedToken
} = require('./github-auth.cjs');

// 1. Single Instance Lock (Phase 1 / T1.2)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let serverInstance = null;
let serverPort = null;
const apiSecret = crypto.randomBytes(32).toString('hex'); // Phase 2 / T2.1: per-launch secret

// Set up user-writable storage directory for KiCad temp outputs (Phase 2 / T2.3)
const userDataPath = app.getPath('userData');
const desktopTempStorage = path.join(userDataPath, 'temp_storage');
const tokenFilePath = path.join(userDataPath, 'banana_github.enc');
process.env.BANANA_DATA_DIR = desktopTempStorage;

try {
  if (!fs.existsSync(desktopTempStorage)) {
    fs.mkdirSync(desktopTempStorage, { recursive: true });
  }
} catch (err) {
  console.warn('[Banana Electron] Failed to create userData temp storage:', err.message);
}

/**
 * Starts the local Express backend server bound strictly to 127.0.0.1 (T1.2, T2.2)
 */
async function startLocalBackend() {
  const staticDir = path.resolve(__dirname, '../frontend/dist');

  // Dynamically import ESM Express app
  const appModule = await import('../backend/src/app.js');
  const createApp = appModule.createApp;

  return new Promise((resolve, reject) => {
    // Port 0 picks any free operating system port automatically
    const expressApp = createApp({
      staticDir,
      apiSecret,
      // Validate Host header against 127.0.0.1:<port> or localhost:<port> to prevent DNS rebinding (T2.2)
      validateHost: (host) => {
        if (!serverPort) return true;
        return host === `127.0.0.1:${serverPort}` || host === `localhost:${serverPort}`;
      }
    });

    const server = expressApp.listen(0, '127.0.0.1', () => {
      const address = server.address();
      serverPort = address.port;
      console.log(`[Banana Desktop] Express backend running on http://127.0.0.1:${serverPort}`);
      resolve({ server, port: serverPort });
    });

    server.on('error', (err) => {
      console.error('[Banana Desktop] Server startup failed:', err);
      reject(err);
    });
  });
}

/**
 * Creates the main native application window (T1.2, T1.6)
 */
async function createMainWindow(port) {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: 'Banana 2.0 — Hardware Diff Studio',
    backgroundColor: '#0f1015',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: isDev
    },
    autoHideMenuBar: true
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Navigation lockdown (T1.6)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    const isLocal = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (!isLocal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  let targetUrl = `http://127.0.0.1:${port}`;
  if (isDev) {
    try {
      const ping = await fetch('http://localhost:5173');
      if (ping.status < 500) {
        targetUrl = 'http://localhost:5173';
      }
    } catch (_) {}
  }

  mainWindow.loadURL(targetUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Configure background auto-updater from GitHub Releases (T6.3)
 */
function setupAutoUpdater() {
  if (!app.isPackaged) {
    return; // Updates only run in packaged production builds
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('[Banana Updater] Update available:', info?.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('banana:update-available', info);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Banana Updater] Update downloaded:', info?.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('banana:update-downloaded', info);
    }
  });

  autoUpdater.on('error', (err) => {
    console.debug('[Banana Updater] Update check error:', err?.message || err);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.debug('[Banana Updater] Check for updates failed:', err?.message || err);
    });
  }, 10000);
}

// Second instance focus (T1.5)
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// App Lifecycle
app.whenReady().then(async () => {
  registerIpcHandlers();
  try {
    const { server, port } = await startLocalBackend();
    serverInstance = server;
    await createMainWindow(port);
    setupAutoUpdater();
  } catch (err) {
    dialog.showErrorBox(
      'Startup Error',
      `Failed to initialize local Banana server: ${err.message}`
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverInstance) {
    try {
      serverInstance.close();
    } catch (_) {}
  }
});

// ==========================================
// IPC Handlers: GitHub Connect & Local Tools
// ==========================================
function registerIpcHandlers() {
  // Safe External URL Opener (T1.6)
  ipcMain.handle('banana:open-external', async (_, url) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });

  // Per-launch API token (T2.1)
  ipcMain.handle('banana:get-api-token', () => apiSecret);

  // Native Folder Selector Dialog (T3.6)
  ipcMain.handle('banana:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select KiCad Git Project Folder',
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // GitHub System Detection (T3.1)
  ipcMain.handle('banana:gh-detect', async () => {
    return detectSystemGitHub();
  });

  // GitHub Device Flow Start (T3.2)
  ipcMain.handle('banana:gh-device-start', async (_, clientId) => {
    return startDeviceFlow(clientId);
  });

  // GitHub Device Flow Poll (T3.2)
  ipcMain.handle('banana:gh-device-poll', async (_, { deviceCode, clientId }) => {
    return pollDeviceFlow(deviceCode, clientId);
  });

  // Secure Token Storage via OS Keychain (T3.4)
  ipcMain.handle('banana:gh-save-token', async (_, token) => {
    return saveEncryptedToken(token, safeStorage, tokenFilePath);
  });

  ipcMain.handle('banana:gh-get-token', async () => {
    return loadEncryptedToken(safeStorage, tokenFilePath);
  });

  ipcMain.handle('banana:gh-clear-token', async () => {
    return clearEncryptedToken(tokenFilePath);
  });

  // Auto-updater manual trigger (T6.3)
  ipcMain.handle('banana:check-for-updates', async () => {
    if (app.isPackaged) {
      return autoUpdater.checkForUpdates();
    }
    return null;
  });

  ipcMain.handle('banana:quit-and-install', () => {
    if (app.isPackaged) {
      autoUpdater.quitAndInstall();
    }
  });
}
