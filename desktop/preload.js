const { contextBridge, ipcRenderer } = require('electron')

function assinar(canal, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('Um callback é obrigatório para receber eventos do DiagPro.')
  }
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(canal, listener)
  return () => ipcRenderer.removeListener(canal, listener)
}

contextBridge.exposeInMainWorld('diagpro', {
  getDeviceStatus: () => ipcRenderer.invoke('get-device-status'),
  onDeviceStatus: (callback) => assinar('device-status-changed', callback),
  runDiagnostic: (serial) => ipcRenderer.invoke('run-diagnostic', { serial }),
  startScan: ({ serial, mode, modules }) => ipcRenderer.invoke('start-scan', { serial, mode, modules }),
  onScanProgress: (callback) => assinar('scan-progress', callback),
  getInstalledApps: ({ serial }) => ipcRenderer.invoke('get-installed-apps', { serial }),
  getRemovalPreview: ({ serial, packageName }) => ipcRenderer.invoke('get-removal-preview', { serial, packageName }),
  uninstallUserApp: ({ serial, packageName, confirmationToken }) => ipcRenderer.invoke(
    'uninstall-user-app',
    { serial, packageName, confirmationToken },
  ),
})
