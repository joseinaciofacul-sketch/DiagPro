const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const {
  verificarEstado,
  coletarDiagnostico,
  desinstalarAppUsuario,
  executarScan,
  listarAppsInstalados,
  obterPreviewRemocao,
} = require('./deviceDetector')

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

  mainWindow.loadURL('http://127.0.0.1:5173')

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

ipcMain.handle('get-device-status', () => monitorarDispositivo())

ipcMain.handle('run-diagnostic', async (_event, { serial } = {}) => {
  try {
    const dados = await coletarDiagnostico(serial)
    return { sucesso: true, dados }
  } catch (err) {
    return { sucesso: false, mensagem: 'Não foi possível coletar o diagnóstico. Verifique a conexão do dispositivo.' }
  }
})

ipcMain.handle('start-scan', async (_event, { serial, mode, modules } = {}) => {
  try {
    const dados = await executarScan(serial, {
      mode,
      modules,
      onProgress: (progresso) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scan-progress', progresso)
        }
      },
    })
    return { ok: true, data: dados }
  } catch (err) {
    return { ok: false, code: err.codigo || 'SCAN_FAILED', message: err.message }
  }
})

ipcMain.handle('get-installed-apps', async (_event, { serial } = {}) => {
  try {
    return { ok: true, data: await listarAppsInstalados(serial) }
  } catch (err) {
    return { ok: false, code: err.codigo || 'APPS_UNAVAILABLE', message: err.message }
  }
})

ipcMain.handle('get-removal-preview', async (_event, { serial, packageName } = {}) => {
  try {
    return { ok: true, ...await obterPreviewRemocao(serial, packageName) }
  } catch (err) {
    return { ok: false, code: err.codigo || 'REMOVAL_PREVIEW_FAILED', message: err.message }
  }
})

ipcMain.handle('uninstall-user-app', async (_event, { serial, packageName, confirmationToken } = {}) => {
  try {
    return await desinstalarAppUsuario(serial, packageName, confirmationToken)
  } catch (err) {
    return { ok: false, code: err.codigo || 'UNINSTALL_FAILED', message: err.message }
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