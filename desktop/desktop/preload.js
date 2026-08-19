const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('diagpro', {
  detectarDispositivo: () => ipcRenderer.invoke('detectar-dispositivo'),
})
