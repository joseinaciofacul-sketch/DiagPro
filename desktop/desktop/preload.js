const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('diagpro', {
  getDeviceStatus: () => ipcRenderer.invoke('get-device-status'),
  onDeviceStatus: (callback) => {
    const listener = (_event, estado) => callback(estado)
    ipcRenderer.on('device-status-changed', listener)
    return () => ipcRenderer.removeListener('device-status-changed', listener)
  },
})