const { contextBridge, ipcRenderer } = require('electron')
const installedAppsRequests = new Map()

function assinar(canal, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('Um callback é obrigatório para receber eventos do DiagPro.')
  }
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(canal, listener)
  return () => ipcRenderer.removeListener(canal, listener)
}

function getInstalledApps({ serial } = {}) {
  const key = String(serial || '')
  const pending = installedAppsRequests.get(key)
  if (pending) return pending

  const request = ipcRenderer.invoke('get-installed-apps', { serial })
  installedAppsRequests.set(key, request)
  const release = () => {
    if (installedAppsRequests.get(key) === request) installedAppsRequests.delete(key)
  }
  request.then(release, release)
  return request
}

contextBridge.exposeInMainWorld('diagpro', {
  reportClientEvent: (payload) => ipcRenderer.invoke('client-event', { event: payload?.event }),
  startGoogleAuth: ({ apiBaseUrl }) => ipcRenderer.invoke('google-auth-start', { apiBaseUrl }),
  cancelGoogleAuth: () => ipcRenderer.invoke('google-auth-cancel'),
  getDeviceStatus: () => ipcRenderer.invoke('get-device-status'),
  checkAdb: () => ipcRenderer.invoke('check-adb'),
  onDeviceStatus: (callback) => assinar('device-status-changed', callback),
  runDiagnostic: (serial) => ipcRenderer.invoke('run-diagnostic', { serial }),
  createScanId: () => ipcRenderer.invoke('create-scan-id'),
  startScan: ({ serial, mode, modules, scanId }) => ipcRenderer.invoke('start-scan', { serial, mode, modules, scanId }),
  cancelScan: (scanId) => ipcRenderer.invoke('cancel-scan', { scanId }),
  onScanProgress: (callback) => assinar('scan-progress', callback),
  onRemediationProgress: (callback) => assinar('remediation-progress', callback),
  getInstalledApps,
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
