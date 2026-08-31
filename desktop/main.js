const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const { isMercadoPagoCheckoutUrl } = require('./payments/checkout')
const {
  verificarEstado,
  coletarDiagnostico,
  desinstalarAppUsuario,
  executarScan,
  listarAppsInstalados,
  obterPreviewRemocao,
  verificarAdb,
} = require('./deviceDetector')

let mainWindow
let estadoAtual = { status: 'waiting' }
let ultimoEstadoJSON = null
let verificacaoAtual = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'public/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Abre o DiagPro maximizado
  mainWindow.maximize()

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

ipcMain.handle('check-adb', async () => {
  try {
    const [adb, device] = await Promise.all([verificarAdb(), monitorarDispositivo()])
    return { ok: true, data: { adb, device } }
  } catch (err) {
    const messages = {
      ADB_NOT_FOUND: 'O ADB não foi localizado neste computador.',
      ADB_TIMEOUT: 'O ADB demorou para responder.',
    }
    return {
      ok: false,
      code: err.codigo || 'ADB_UNAVAILABLE',
      message: messages[err.codigo] || 'Não foi possível executar o ADB neste computador.',
    }
  }
})

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

ipcMain.handle('uninstall-user-app', async (_event, { serial, packageName, confirmationToken, findingId } = {}) => {
  try {
    return await desinstalarAppUsuario(serial, packageName, confirmationToken, findingId)
  } catch (err) {
    return { ok: false, code: err.codigo || 'UNINSTALL_FAILED', message: err.message }
  }
})

ipcMain.handle('open-external-checkout', async (_event, { url } = {}) => {
  if (!isMercadoPagoCheckoutUrl(url)) {
    return { ok: false, code: 'INVALID_CHECKOUT_URL', message: 'O endereço de checkout não é permitido.' }
  }
  try {
    await shell.openExternal(url)
    return { ok: true }
  } catch {
    return { ok: false, code: 'CHECKOUT_OPEN_FAILED', message: 'Não foi possível abrir o checkout externo.' }
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
