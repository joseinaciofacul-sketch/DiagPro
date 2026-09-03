const { app, BrowserWindow, ipcMain, shell } = require('electron')
const crypto = require('crypto')
const path = require('path')
const { ADB_ERROR_CODES } = require('./adb/adbErrors')
const { createScanCoordinator } = require('./adb/scanCoordinator')
const { isMercadoPagoCheckoutUrl } = require('./payments/checkout')
const { rendererTarget } = require('./rendererTarget')
const {
  verificarEstado,
  cancelarRemediacao,
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
const scanCoordinator = createScanCoordinator()

function validScanId(scanId) {
  return typeof scanId === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(scanId)
}

function acquireDeviceOperation(serial, type, id) {
  return scanCoordinator.beginOperation(serial, type, id)
}

function releaseDeviceOperation(serial, id) {
  scanCoordinator.finishOperation(serial, id)
}

function deviceBusyResponse(serial) {
  const active = scanCoordinator.getOperation(serial)
  return {
    ok: false,
    code: 'DEVICE_BUSY',
    message: active?.type === 'scan'
      ? 'Já existe uma análise em andamento neste dispositivo.'
      : 'Já existe uma operação ADB em andamento neste dispositivo.',
  }
}

function abortDisconnectedOperations(deviceState) {
  scanCoordinator.abortDisconnected(deviceState)
}

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

  const target = rendererTarget({
    packaged: app.isPackaged,
    appDirectory: __dirname,
    devServerUrl: process.env.DIAGPRO_RENDERER_URL,
  })
  if (target.kind === 'file') mainWindow.loadFile(target.value)
  else mainWindow.loadURL(target.value)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}


async function monitorarDispositivo() {
  if (verificacaoAtual) return verificacaoAtual

  verificacaoAtual = verificarEstado()
    .then((estado) => {
      estadoAtual = estado
      abortDisconnectedOperations(estado)
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

ipcMain.handle('create-scan-id', () => crypto.randomUUID())

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
  const operationId = crypto.randomUUID()
  if (!acquireDeviceOperation(serial, 'scan', operationId)) return { sucesso: false, mensagem: deviceBusyResponse(serial).message }
  try {
    const dados = await coletarDiagnostico(serial)
    return { sucesso: true, dados }
  } catch (err) {
    return { sucesso: false, mensagem: 'Não foi possível coletar o diagnóstico. Verifique a conexão do dispositivo.' }
  } finally {
    releaseDeviceOperation(serial, operationId)
  }
})

ipcMain.handle('start-scan', async (_event, { serial, mode, modules, scanId: requestedScanId } = {}) => {
  const scanId = validScanId(requestedScanId) ? requestedScanId : crypto.randomUUID()
  const controller = new AbortController()
  const started = scanCoordinator.beginScan({ scanId, serial, controller })
  if (!started.ok) {
    return started.code === 'SCAN_ALREADY_EXISTS'
      ? { ok: false, scanId, code: started.code, message: 'Este identificador de análise já está em uso.' }
      : { ...deviceBusyResponse(serial), scanId }
  }
  try {
    const dados = await executarScan(serial, {
      mode,
      modules,
      scanId,
      signal: controller.signal,
      onProgress: (progresso) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scan-progress', { ...progresso, scanId })
        }
      },
    })
    return { ok: true, scanId, status: dados.status, data: dados }
  } catch (err) {
    return {
      ok: false,
      scanId,
      status: err.scanStatus || (err.codigo === ADB_ERROR_CODES.SCAN_ABORTED ? 'canceled' : 'failed'),
      code: err.codigo || err.code || 'SCAN_FAILED',
      message: err.message,
    }
  } finally {
    scanCoordinator.finishScan(scanId)
  }
})

ipcMain.handle('cancel-scan', async (_event, { scanId } = {}) => {
  const scan = scanCoordinator.getScan(scanId)
  if (!scan) return { ok: false, scanId, code: 'SCAN_NOT_FOUND', message: 'A análise não está mais em execução.' }
  scanCoordinator.cancelScan(scanId)
  return { ok: true, scanId, status: 'cancel_requested' }
})

ipcMain.handle('get-installed-apps', async (_event, { serial } = {}) => {
  const operationId = crypto.randomUUID()
  if (!acquireDeviceOperation(serial, 'apps', operationId)) return deviceBusyResponse(serial)
  try {
    return { ok: true, data: await listarAppsInstalados(serial) }
  } catch (err) {
    return { ok: false, code: err.codigo || 'APPS_UNAVAILABLE', message: err.message }
  } finally {
    releaseDeviceOperation(serial, operationId)
  }
})

ipcMain.handle('get-removal-preview', async (_event, {
  serial, packageName, finding, action, projectionId,
} = {}) => {
  const operationId = crypto.randomUUID()
  if (!acquireDeviceOperation(serial, 'removal_preview', operationId)) return deviceBusyResponse(serial)
  try {
    return {
      ok: true,
      ...await obterPreviewRemocao({ serial, packageName, finding, action, projectionId }),
    }
  } catch (err) {
    return { ok: false, code: err.codigo || 'REMOVAL_PREVIEW_FAILED', message: err.message }
  } finally {
    releaseDeviceOperation(serial, operationId)
  }
})

ipcMain.handle('uninstall-user-app', async (_event, {
  serial, packageName, androidUserId, confirmationToken, actionId, findingId, projectionId,
} = {}) => {
  if (typeof actionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(actionId)) {
    return { ok: false, code: 'INVALID_ACTION', message: 'Abra um novo preview antes de executar a correção.' }
  }
  const controller = new AbortController()
  if (!scanCoordinator.beginOperation(serial, 'remediation', actionId, { controller, packageName })) {
    return deviceBusyResponse(serial)
  }
  try {
    return await desinstalarAppUsuario({
      serial,
      packageName,
      androidUserId,
      confirmationToken,
      actionId,
      findingId,
      projectionId,
      signal: controller.signal,
      onTransition: (transition) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('remediation-progress', transition)
        }
      },
    })
  } catch (err) {
    return { ok: false, code: err.codigo || 'UNINSTALL_FAILED', message: err.message }
  } finally {
    releaseDeviceOperation(serial, actionId)
  }
})

ipcMain.handle('cancel-remediation', async (_event, { actionId, confirmationToken } = {}) => {
  if (scanCoordinator.cancelOperation(actionId)) {
    return { ok: true, actionId, status: 'cancel_requested' }
  }
  if (cancelarRemediacao(actionId, confirmationToken)) {
    return { ok: true, actionId, status: 'canceled' }
  }
  return { ok: false, actionId, code: 'REMEDIATION_NOT_FOUND', message: 'A correção não está mais pendente.' }
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
