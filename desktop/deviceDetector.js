const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const ADB_TIMEOUT = 5000

function localizarAdb() {
  const candidatos = [
    process.env.ADB_PATH,
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe'),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    'adb',
  ].filter(Boolean)

  return candidatos.find((candidato) => candidato === 'adb' || fs.existsSync(candidato)) || 'adb'
}

function runAdb(args) {
  return new Promise((resolve, reject) => {
    execFile(localizarAdb(), args, { timeout: ADB_TIMEOUT, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const erro = new Error(stderr.trim() || error.message)
        erro.codigo = error.code === 'ENOENT'
          ? 'ADB_NOT_FOUND'
          : error.killed
            ? 'ADB_TIMEOUT'
            : 'ADB_COMMAND_FAILED'
        reject(erro)
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

async function listarDispositivos() {
  const saida = await runAdb(['devices', '-l'])
  const linhas = saida.split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean)

  return linhas.map((linha) => {
    const partes = linha.split(/\s+/)
    return { serial: partes[0], status: partes[1] || 'unknown' }
  })
}

async function coletarInfo(serial) {
  const [fabricante, modelo, versaoAndroid, sdk] = await Promise.all([
    runAdb(['-s', serial, 'shell', 'getprop', 'ro.product.manufacturer']),
    runAdb(['-s', serial, 'shell', 'getprop', 'ro.product.model']),
    runAdb(['-s', serial, 'shell', 'getprop', 'ro.build.version.release']),
    runAdb(['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk']),
  ])

  const bateriaRaw = await runAdb(['-s', serial, 'shell', 'dumpsys', 'battery'])
  const nivelMatch = bateriaRaw.match(/level:\s*(\d+)/)
  const bateria = nivelMatch ? parseInt(nivelMatch[1], 10) : null

  return { fabricante, modelo, versaoAndroid, sdk, bateria }
}

async function verificarEstado() {
  let dispositivos
  try {
    dispositivos = await listarDispositivos()
  } catch (err) {
    if (err.codigo === 'ADB_NOT_FOUND') {
      return {
        status: 'error',
        codigo: 'ADB_NOT_FOUND',
        mensagem: 'Não foi possível localizar o ADB. Verifique a instalação ou configuração do ambiente.',
      }
    }

    if (err.codigo === 'ADB_TIMEOUT') {
      return {
        status: 'error',
        codigo: 'ADB_TIMEOUT',
        mensagem: 'O serviço de comunicação demorou para responder. Verifique o ADB e o cabo USB.',
      }
    }

    return {
      status: 'error',
      codigo: 'ADB_UNAVAILABLE',
      mensagem: 'Não foi possível comunicar com o serviço de dispositivos. Verifique o ADB e os drivers USB.',
    }
  }

  if (dispositivos.length === 0) {
    return { status: 'waiting', dispositivos }
  }

  if (dispositivos.length > 1) {
    return { status: 'multiple', dispositivos }
  }

  const alvo = dispositivos[0]

  if (alvo.status === 'unauthorized') {
    return { status: 'unauthorized', serial: alvo.serial, dispositivos }
  }

  if (alvo.status === 'offline') {
    return { status: 'offline', serial: alvo.serial, dispositivos }
  }

  if (alvo.status === 'device') {
    try {
      const info = await coletarInfo(alvo.serial)
      return { status: 'connected', serial: alvo.serial, dispositivos, ...info }
    } catch (err) {
      return {
        status: 'error',
        codigo: err.codigo === 'ADB_TIMEOUT' ? 'ADB_TIMEOUT' : 'DEVICE_COMMUNICATION',
        serial: alvo.serial,
        mensagem: err.codigo === 'ADB_TIMEOUT'
          ? 'A leitura do dispositivo demorou para responder. Verifique o cabo USB.'
          : 'O dispositivo foi autorizado, mas não foi possível ler suas informações.',
      }
    }
  }

  return {
    status: 'error',
    codigo: 'ADB_UNKNOWN_STATUS',
    serial: alvo.serial,
    adbStatus: alvo.status,
    mensagem: 'O dispositivo retornou um estado de conexão não reconhecido.',
  }
}
async function coletarDiagnostico(serial) {
  const [armazenamentoRaw, memoriaRaw, appsRaw] = await Promise.all([
    runAdb(['-s', serial, 'shell', 'df', '/data']),
    runAdb(['-s', serial, 'shell', 'cat', '/proc/meminfo']),
    runAdb(['-s', serial, 'shell', 'pm', 'list', 'packages']),
  ])

  const linhasArmazenamento = armazenamentoRaw.split(/\r?\n/).filter(Boolean)
  const colsArmazenamento = linhasArmazenamento[1]?.trim().split(/\s+/) || []
  const totalKb = parseInt(colsArmazenamento[1], 10) || 0
  const usadoKb = parseInt(colsArmazenamento[2], 10) || 0
  const livreKb = parseInt(colsArmazenamento[3], 10) || 0

  const memTotalMatch = memoriaRaw.match(/MemTotal:\s*(\d+)/)
  const memDisponivelMatch = memoriaRaw.match(/MemAvailable:\s*(\d+)/)
  const memTotalKb = memTotalMatch ? parseInt(memTotalMatch[1], 10) : 0
  const memDisponivelKb = memDisponivelMatch ? parseInt(memDisponivelMatch[1], 10) : 0

  const totalApps = appsRaw.split(/\r?\n/).filter(Boolean).length

  return {
    armazenamento: {
      totalGb: Math.round((totalKb / 1024 / 1024) * 10) / 10,
      usadoGb: Math.round((usadoKb / 1024 / 1024) * 10) / 10,
      livreGb: Math.round((livreKb / 1024 / 1024) * 10) / 10,
    },
    memoria: {
      totalGb: Math.round((memTotalKb / 1024 / 1024) * 10) / 10,
      disponivelGb: Math.round((memDisponivelKb / 1024 / 1024) * 10) / 10,
    },
    totalApps,
  }
}
module.exports = { verificarEstado, coletarDiagnostico }