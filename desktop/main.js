const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { verificarEstado } = require('./deviceDetector')

let mainWindow
let ultimoEstadoJSON = null
let estadoAtual = { status: 'waiting' }
let verificacaoAtual = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'public/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'desktop', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadURL('http://localhost:5173')
}

async function monitorarDispositivo() {
  if (verificacaoAtual) return verificacaoAtual

  verificacaoAtual = (async () => {
    const estadoDetectado = await verificarEstado()
    const estado = estadoDetectado.status === 'waiting' &&
      estadoAtual.status !== 'waiting' && estadoAtual.status !== 'disconnected' && estadoAtual.status !== 'error'
      ? { ...estadoDetectado, status: 'disconnected' }
      : estadoDetectado
    const estadoJSON = JSON.stringify(estado)

    estadoAtual = estado
    if (estadoJSON !== ultimoEstadoJSON) {
      ultimoEstadoJSON = estadoJSON
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('device-status-changed', estado)
      }
    }
    return estado
  })().finally(() => {
    verificacaoAtual = null
  })

  return verificacaoAtual
}

ipcMain.handle('get-device-status', () => monitorarDispositivo())

app.whenReady().then(() => {
  createWindow()
  monitorarDispositivo()
  setInterval(monitorarDispositivo, 2000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})