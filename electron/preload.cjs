const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('banana', {
  isElectron: true,
  platform: process.platform,

  // Open external links safely via OS default browser (shell.openExternal)
  openExternal: (url) => ipcRenderer.invoke('banana:open-external', url),

  // Native folder selection dialog
  selectFolder: () => ipcRenderer.invoke('banana:select-folder'),

  // Per-launch local API authorization token (Phase 2 hardening)
  getApiToken: () => ipcRenderer.invoke('banana:get-api-token'),

  // GitHub Desktop Integration APIs
  github: {
    // Detect system credentials (gh auth token or git credential)
    detectSystemAuth: () => ipcRenderer.invoke('banana:gh-detect'),
    // Start OAuth Device Flow
    startDeviceFlow: (clientId) => ipcRenderer.invoke('banana:gh-device-start', clientId),
    // Poll OAuth Device Flow
    pollDeviceFlow: (deviceCode, clientId) => ipcRenderer.invoke('banana:gh-device-poll', { deviceCode, clientId }),
    // Secure token storage via OS keychain (safeStorage)
    saveToken: (token) => ipcRenderer.invoke('banana:gh-save-token', token),
    getSavedToken: () => ipcRenderer.invoke('banana:gh-get-token'),
    clearSavedToken: () => ipcRenderer.invoke('banana:gh-clear-token'),
  },

  // Auto-updater APIs (Phase 6 / T6.3)
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('banana:check-for-updates'),
    quitAndInstall: () => ipcRenderer.invoke('banana:quit-and-install'),
    onUpdateAvailable: (callback) => {
      const listener = (_, info) => callback(info);
      ipcRenderer.on('banana:update-available', listener);
      return () => ipcRenderer.removeListener('banana:update-available', listener);
    },
    onUpdateDownloaded: (callback) => {
      const listener = (_, info) => callback(info);
      ipcRenderer.on('banana:update-downloaded', listener);
      return () => ipcRenderer.removeListener('banana:update-downloaded', listener);
    }
  }
});
