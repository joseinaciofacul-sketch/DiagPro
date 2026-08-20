const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { verificarEstado, coletarDiagnostico } = require('./deviceDetector')

let mainWindow
let estadoAtual = { status: 'waiting' }
let ultimoEstadoJSON = null
let verificacaoAtual = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'public/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadURL('http://localhost:5173')

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function monitorarDispositivo() {
  if (verificacaoAtual) return verificacaoAtual

  verificacaoAtual = verificarEstado()
    .then((estado) => {
      estadoAtual = estado
      const estadoJSON = JSON.stringify(estado)

      if (estadoJSON !== ultimoEstadoJSON) {
        ultimoEstadoJSON = estadoJSON
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('device-status-changed', estado)
        }
      }

      return estado
    })
    .finally(() => {
      verificacaoAtual = null
    })

  return verificacaoAtual
}

ipcMain.handle('get-device-status', async () => estadoAtual)

ipcMain.handle('run-diagnostic', async (event, serial) => {
  try {
    const dados = await coletarDiagnostico(serial)
    return { sucesso: true, dados }
  } catch (err) {
    return { sucesso: false, mensagem: 'Não foi possível coletar o diagnóstico. Verifique a conexão do dispositivo.' }
  }
})

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