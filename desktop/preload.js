const { contextBridge, ipcRenderer } = require('electron')
const crypto = require('crypto')

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
  checkAdb: () => ipcRenderer.invoke('check-adb'),
  onDeviceStatus: (callback) => assinar('device-status-changed', callback),
  runDiagnostic: (serial) => ipcRenderer.invoke('run-diagnostic', { serial }),
  createScanId: () => crypto.randomUUID(),
  startScan: ({ serial, mode, modules, scanId }) => ipcRenderer.invoke('start-scan', { serial, mode, modules, scanId }),
  cancelScan: (scanId) => ipcRenderer.invoke('cancel-scan', { scanId }),
  onScanProgress: (callback) => assinar('scan-progress', callback),
  onRemediationProgress: (callback) => assinar('remediation-progress', callback),
  getInstalledApps: ({ serial }) => ipcRenderer.invoke('get-installed-apps', { serial }),
  getRemovalPreview: ({ serial, packageName, finding, action, projectionId }) => ipcRenderer.invoke(
    'get-removal-preview',
    { serial, packageName, finding, action, projectionId },
  ),
  uninstallUserApp: ({ serial, packageName, androidUserId, confirmationToken, actionId, findingId, projectionId }) => ipcRenderer.invoke(
    'uninstall-user-app',
    { serial, packageName, androidUserId, confirmationToken, actionId, findingId, projectionId },
  ),
  cancelRemediation: ({ actionId, confirmationToken }) => ipcRenderer.invoke(
    'cancel-remediation',
    { actionId, confirmationToken },
  ),
  openExternalCheckout: (url) => ipcRenderer.invoke('open-external-checkout', { url }),
})
