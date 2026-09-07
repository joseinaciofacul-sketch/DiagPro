const { app, BrowserWindow, ipcMain, shell } = require('electron')
const crypto = require('crypto')
const path = require('path')
const { ADB_ERROR_CODES } = require('./adb/adbErrors')
const { createScanCoordinator } = require('./adb/scanCoordinator')
const { isTrustedRendererUrl } = require('./electronPolicy')
const { isMercadoPagoCheckoutUrl } = require('./payments/checkout')
const { createProductionLogger } = require('./productionLogger')
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
let rendererTargetInfo = null
let productionLogger = null
const scanCoordinator = createScanCoordinator()
const forceLocalBuild = process.argv.includes('--local-build')

function logOperationalError(event, details = {}) {
  productionLogger?.error(event, details)
}

function trustedIpcHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    const senderUrl = event.senderFrame?.url || event.sender.getURL()
    const trusted = mainWindow
      && !mainWindow.isDestroyed()
      && event.sender === mainWindow.webContents
      && event.senderFrame === event.sender.mainFrame
      && isTrustedRendererUrl(senderUrl, rendererTargetInfo)
    if (!trusted) {
      logOperationalError('ipc_rejected', { code: 'UNTRUSTED_RENDERER' })
      throw new Error('Solicitação IPC não autorizada.')
    }
    return handler(event, ...args)
  })
}

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
  rendererTargetInfo = rendererTarget({
    packaged: app.isPackaged,
    forceLocalBuild,
    appDirectory: __dirname,
    devServerUrl: process.env.DIAGPRO_RENDERER_URL,
  })
  const iconDirectory = rendererTargetInfo.kind === 'file' ? 'dist' : 'public'

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    icon: path.join(__dirname, iconDirectory, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: rendererTargetInfo.kind === 'url',
    },
  })

  // Abre o DiagPro maximizado
  mainWindow.maximize()

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isTrustedRendererUrl(navigationUrl, rendererTargetInfo)) {
      event.preventDefault()
      logOperationalError('renderer_navigation_blocked', { code: 'UNTRUSTED_URL' })
    }
  })

  const permissionSession = mainWindow.webContents.session
  permissionSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  permissionSession.setPermissionCheckHandler(() => false)

  let showingLoadFailure = false
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (!isMainFrame || showingLoadFailure) return
    showingLoadFailure = true
    logOperationalError('renderer_load_failed', { code: errorCode })
    const errorPage = encodeURIComponent(`<!doctype html>
      <html lang="pt-BR"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
      <style>body{margin:0;display:grid;place-items:center;height:100vh;background:#080f1c;color:#dce9f6;font-family:Segoe UI,sans-serif}.box{max-width:520px;padding:32px;border:1px solid #29415e;border-radius:14px;background:#101c2c}h1{font-size:22px}p{color:#9db4cc;line-height:1.55}</style></head>
      <body><main class="box"><h1>O DiagPro não pôde abrir a interface</h1><p>Feche e abra o aplicativo novamente. Se o problema continuar, consulte o arquivo de log do DiagPro.</p></main></body></html>`)
    mainWindow.loadURL(`data:text/html;charset=UTF-8,${errorPage}`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logOperationalError('renderer_process_gone', { reason: details.reason, exitCode: details.exitCode })
  })
  mainWindow.webContents.on('preload-error', () => logOperationalError('preload_failed', { code: 'PRELOAD_ERROR' }))

  productionLogger?.info('renderer_loading', { targetKind: rendererTargetInfo.kind })
  const loading = rendererTargetInfo.kind === 'file'
    ? mainWindow.loadFile(rendererTargetInfo.value)
    : mainWindow.loadURL(rendererTargetInfo.value)
  loading.catch(() => logOperationalError('renderer_load_failed', { code: 'LOAD_REJECTED' }))

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

trustedIpcHandler('get-device-status', () => monitorarDispositivo())

trustedIpcHandler('create-scan-id', () => crypto.randomUUID())

trustedIpcHandler('client-event', (_event, payload = {}) => {
  if (payload?.event === 'api_unavailable') logOperationalError('api_unavailable', { code: 'NETWORK_ERROR' })
})

trustedIpcHandler('check-adb', async () => {
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

trustedIpcHandler('run-diagnostic', async (_event, { serial } = {}) => {
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

trustedIpcHandler('start-scan', async (_event, { serial, mode, modules, scanId: requestedScanId } = {}) => {
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

trustedIpcHandler('cancel-scan', async (_event, { scanId } = {}) => {
  const scan = scanCoordinator.getScan(scanId)
  if (!scan) return { ok: false, scanId, code: 'SCAN_NOT_FOUND', message: 'A análise não está mais em execução.' }
  scanCoordinator.cancelScan(scanId)
  return { ok: true, scanId, status: 'cancel_requested' }
})

trustedIpcHandler('get-installed-apps', async (_event, { serial } = {}) => {
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

trustedIpcHandler('get-removal-preview', async (_event, {
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

trustedIpcHandler('uninstall-user-app', async (_event, {
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

trustedIpcHandler('cancel-remediation', async (_event, { actionId, confirmationToken } = {}) => {
  if (scanCoordinator.cancelOperation(actionId)) {
    return { ok: true, actionId, status: 'cancel_requested' }
  }
  if (cancelarRemediacao(actionId, confirmationToken)) {
    return { ok: true, actionId, status: 'canceled' }
  }
  return { ok: false, actionId, code: 'REMEDIATION_NOT_FOUND', message: 'A correção não está mais pendente.' }
})

trustedIpcHandler('open-external-checkout', async (_event, { url } = {}) => {
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
  try {
    productionLogger = createProductionLogger({ directory: path.join(app.getPath('userData'), 'logs') })
    productionLogger.info('startup', { packaged: app.isPackaged, version: app.getVersion() })
  } catch { /* A falha de logs não impede a inicialização. */ }
  createWindow()
  const poll = () => monitorarDispositivo().catch(() => logOperationalError('adb_unavailable', { code: 'ADB_UNAVAILABLE' }))
  poll()
  setInterval(poll, 2000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
