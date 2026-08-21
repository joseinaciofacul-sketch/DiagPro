const { execFile } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ADB_TIMEOUT = 6000
const EXTENDED_ADB_TIMEOUT = 20000
const MAX_BUFFER = 10 * 1024 * 1024
const removalTokens = new Map()

function criarErro(codigo, mensagem) {
  const erro = new Error(mensagem)
  erro.codigo = codigo
  return erro
}

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

function runAdb(args, { timeout = ADB_TIMEOUT, maxBuffer = MAX_BUFFER } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      localizarAdb(),
      args,
      { timeout, maxBuffer, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const erro = criarErro(
            error.code === 'ENOENT'
              ? 'ADB_NOT_FOUND'
              : error.killed
                ? 'ADB_TIMEOUT'
                : 'ADB_COMMAND_FAILED',
            String(stderr || error.message || 'Falha ao executar o ADB.').trim(),
          )
          reject(erro)
          return
        }

        resolve(String(stdout || '').trim())
      },
    )
  })
}

function serialValido(serial) {
  return typeof serial === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(serial)
}

function pacoteValido(packageName) {
  return typeof packageName === 'string'
    && /^[A-Za-z][A-Za-z0-9_.-]{1,254}$/.test(packageName)
    && packageName.includes('.')
}

function inteiro(valor) {
  const numero = Number.parseInt(valor, 10)
  return Number.isFinite(numero) ? numero : null
}

function paraGb(kilobytes) {
  return Number.isFinite(kilobytes) ? Math.round((kilobytes / 1024 / 1024) * 10) / 10 : null
}

function parseDispositivos(saida) {
  return saida
    .split(/\r?\n/)
    .slice(1)
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => {
      const partes = linha.split(/\s+/)
      return { serial: partes[0], status: partes[1] || 'unknown' }
    })
}

function parseBateria(saida) {
  const obter = (chave) => {
    const correspondencia = saida.match(new RegExp(`^\\s*${chave}:\\s*(.+)$`, 'mi'))
    return correspondencia ? correspondencia[1].trim() : null
  }
  const status = inteiro(obter('status'))
  const nivel = inteiro(obter('level'))
  const usb = obter('USB powered') === 'true'
  const ac = obter('AC powered') === 'true'
  const wireless = obter('Wireless powered') === 'true'
  const estadoPorCodigo = {
    2: 'Carregando',
    3: 'Descarregando',
    4: 'Não carregando',
    5: 'Completa',
  }

  return {
    level: nivel,
    status: status ? estadoPorCodigo[status] || 'Não disponível' : 'Não disponível',
    charging: status === 2 || status === 5 || usb || ac || wireless,
    source: usb ? 'USB' : ac ? 'Tomada' : wireless ? 'Sem fio' : null,
  }
}

function parseArmazenamento(saida) {
  const linha = saida
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.split(/\s+/))
    .find((colunas) => colunas.length >= 4 && inteiro(colunas[1]) !== null && inteiro(colunas[2]) !== null)

  if (!linha) {
    return { totalGb: null, usedGb: null, freeGb: null, usagePercent: null }
  }

  const totalKb = inteiro(linha[1])
  const usedKb = inteiro(linha[2])
  const freeKb = inteiro(linha[3])
  return {
    totalGb: paraGb(totalKb),
    usedGb: paraGb(usedKb),
    freeGb: paraGb(freeKb),
    usagePercent: totalKb && usedKb !== null ? Math.round((usedKb / totalKb) * 100) : null,
  }
}

function parseMemoria(saida) {
  const obterKb = (chave) => {
    const correspondencia = saida.match(new RegExp(`^${chave}:\\s*(\\d+)`, 'mi'))
    return correspondencia ? inteiro(correspondencia[1]) : null
  }
  const totalKb = obterKb('MemTotal')
  const disponivelKb = obterKb('MemAvailable')

  return {
    totalGb: paraGb(totalKb),
    availableGb: paraGb(disponivelKb),
    usedGb: totalKb !== null && disponivelKb !== null ? paraGb(totalKb - disponivelKb) : null,
  }
}

async function listarDispositivos() {
  return parseDispositivos(await runAdb(['devices', '-l']))
}

async function lerPropriedades(serial, propriedades) {
  const valores = await Promise.all(
    propriedades.map(async (propriedade) => {
      try {
        return [propriedade, (await runAdb(['-s', serial, 'shell', 'getprop', propriedade])).trim() || null]
      } catch {
        return [propriedade, null]
      }
    }),
  )
  return Object.fromEntries(valores)
}

async function validarDispositivoAutorizado(serial) {
  if (!serialValido(serial)) {
    throw criarErro('INVALID_DEVICE', 'O dispositivo informado é inválido.')
  }

  const dispositivos = await listarDispositivos()
  const dispositivo = dispositivos.find((item) => item.serial === serial)
  if (!dispositivo) {
    throw criarErro('DEVICE_NOT_FOUND', 'O dispositivo não está mais conectado.')
  }
  if (dispositivo.status === 'unauthorized') {
    throw criarErro('DEVICE_UNAUTHORIZED', 'Autorize a depuração USB no dispositivo para continuar.')
  }
  if (dispositivo.status !== 'device') {
    throw criarErro('DEVICE_NOT_READY', 'O dispositivo não está pronto para análise.')
  }
  return dispositivo
}

async function coletarIdentificacao(serial) {
  const propriedades = await lerPropriedades(serial, [
    'ro.product.manufacturer',
    'ro.product.brand',
    'ro.product.model',
    'ro.product.marketname',
    'ro.build.version.release',
    'ro.build.version.sdk',
    'ro.build.version.security_patch',
    'ro.build.display.id',
  ])

  return {
    manufacturer: propriedades['ro.product.manufacturer'],
    brand: propriedades['ro.product.brand'],
    model: propriedades['ro.product.model'],
    commercialModel: propriedades['ro.product.marketname'],
    androidVersion: propriedades['ro.build.version.release'],
    sdk: propriedades['ro.build.version.sdk'],
    securityPatch: propriedades['ro.build.version.security_patch'],
    buildId: propriedades['ro.build.display.id'],
  }
}

async function coletarBateria(serial) {
  try {
    return parseBateria(await runAdb(['-s', serial, 'shell', 'dumpsys', 'battery']))
  } catch {
    return { level: null, status: 'Não disponível', charging: null, source: null }
  }
}

async function coletarArmazenamento(serial) {
  try {
    return parseArmazenamento(await runAdb(['-s', serial, 'shell', 'df', '/data']))
  } catch {
    return { totalGb: null, usedGb: null, freeGb: null, usagePercent: null }
  }
}

async function coletarMemoria(serial) {
  try {
    return parseMemoria(await runAdb(['-s', serial, 'shell', 'cat', '/proc/meminfo']))
  } catch {
    return { totalGb: null, availableGb: null, usedGb: null }
  }
}

async function coletarSinaisSeguranca(serial) {
  const propriedades = await lerPropriedades(serial, [
    'ro.build.version.security_patch',
    'ro.debuggable',
    'ro.secure',
  ])
  const depuravel = propriedades['ro.debuggable'] === '1'
    ? true
    : propriedades['ro.debuggable'] === '0'
      ? false
      : null

  return {
    securityPatch: propriedades['ro.build.version.security_patch'],
    debuggableBuild: depuravel,
    secureBuild: propriedades['ro.secure'] === '1' ? true : propriedades['ro.secure'] === '0' ? false : null,
    root: {
      status: 'not_verified',
      message: 'Não verificado: o DiagPro não solicita acesso root durante a coleta.',
    },
    findings: [],
  }
}

async function listarAppsInstalados(serial) {
  await validarDispositivoAutorizado(serial)
  const [usuarioRaw, sistemaRaw] = await Promise.all([
    runAdb(['-s', serial, 'shell', 'pm', 'list', 'packages', '-3'], { timeout: EXTENDED_ADB_TIMEOUT }),
    runAdb(['-s', serial, 'shell', 'pm', 'list', 'packages', '-s'], { timeout: EXTENDED_ADB_TIMEOUT }),
  ])

  const paraApps = (saida, type) => saida
    .split(/\r?\n/)
    .map((linha) => linha.trim().replace(/^package:/, ''))
    .filter(pacoteValido)
    .map((packageName) => ({
      name: null,
      packageName,
      type,
      status: 'not_analyzed',
      statusLabel: 'Não analisado',
    }))

  const userApps = paraApps(usuarioRaw, 'user')
  const systemApps = paraApps(sistemaRaw, 'system')
  const appsPorPacote = new Map()
  ;[...userApps, ...systemApps].forEach((app) => {
    if (!appsPorPacote.has(app.packageName) || app.type === 'user') {
      appsPorPacote.set(app.packageName, app)
    }
  })
  const apps = [...appsPorPacote.values()].sort((a, b) => a.packageName.localeCompare(b.packageName))

  return {
    total: apps.length,
    userTotal: apps.filter((app) => app.type === 'user').length,
    systemTotal: apps.filter((app) => app.type === 'system').length,
    items: apps,
  }
}

function calcularHealthScore(resultado) {
  const armazenamento = resultado.storage
  const bateria = resultado.battery
  const seguranca = resultado.security
  const memoria = resultado.memory
  const evidencias = [
    armazenamento?.usagePercent,
    bateria?.level,
    seguranca?.securityPatch,
    memoria?.availableGb,
  ].filter((valor) => valor !== null && valor !== undefined).length

  if (evidencias < 2) {
    return {
      available: false,
      score: null,
      label: 'Aguardando diagnóstico',
      explanation: 'Ainda não há sinais técnicos suficientes para calcular a saúde do dispositivo.',
      factors: [],
    }
  }

  let score = 100
  const factors = []
  if (armazenamento?.usagePercent !== null && armazenamento?.usagePercent !== undefined) {
    if (armazenamento.usagePercent >= 95) {
      score -= 30
      factors.push('Armazenamento acima de 95% de uso')
    } else if (armazenamento.usagePercent >= 90) {
      score -= 20
      factors.push('Armazenamento acima de 90% de uso')
    } else if (armazenamento.usagePercent >= 85) {
      score -= 10
      factors.push('Armazenamento acima de 85% de uso')
    }
  }
  if (bateria?.level !== null && bateria?.level !== undefined && bateria.level <= 10) {
    score -= 10
    factors.push('Bateria abaixo de 10% no momento da coleta')
  }
  if (seguranca?.debuggableBuild === true) {
    score -= 10
    factors.push('Build Android marcado como depurável')
  }
  if (seguranca?.securityPatch) {
    const patch = Date.parse(`${seguranca.securityPatch}T00:00:00Z`)
    if (Number.isFinite(patch)) {
      const idadeDias = Math.floor((Date.now() - patch) / 86400000)
      if (idadeDias > 365) {
        score -= 15
        factors.push('Patch de segurança com mais de 12 meses')
      } else if (idadeDias > 180) {
        score -= 7
        factors.push('Patch de segurança com mais de 6 meses')
      }
    }
  }

  score = Math.max(0, Math.min(100, score))
  const label = score >= 85 ? 'Boa' : score >= 65 ? 'Atenção' : 'Crítica'
  return {
    available: true,
    score,
    label,
    explanation: 'Pontuação calculada apenas com os sinais técnicos coletados neste scan; não representa uma certificação de ausência de malware.',
    factors,
  }
}

function normalizarModo(modo, modulos) {
  const permitidos = ['system', 'apps', 'security', 'permissions', 'battery', 'storage', 'performance']
  const customizados = Array.isArray(modulos) ? modulos.filter((modulo) => permitidos.includes(modulo)) : []
  if (modo === 'complete') return permitidos
  if (modo === 'custom') return customizados
  return ['apps', 'security', 'battery', 'storage']
}

async function executarScan(serial, { mode = 'quick', modules = [], onProgress = () => {} } = {}) {
  await validarDispositivoAutorizado(serial)
  const modulos = normalizarModo(mode, modules)
  const etapas = [
    { id: 'identification', label: 'Identificando dispositivo', module: null },
    { id: 'system', label: 'Analisando sistema', module: 'system' },
    { id: 'apps', label: 'Analisando aplicativos', module: 'apps' },
    { id: 'permissions', label: 'Analisando permissões acessíveis', module: 'permissions' },
    { id: 'security', label: 'Verificando segurança', module: 'security' },
    { id: 'battery', label: 'Verificando bateria', module: 'battery' },
    { id: 'storage', label: 'Verificando armazenamento', module: 'storage' },
    { id: 'performance', label: 'Verificando desempenho', module: 'performance' },
  ].filter((etapa) => etapa.module === null || modulos.includes(etapa.module))
  etapas.push({ id: 'consolidation', label: 'Consolidando resultados', module: null })

  const resultado = {
    mode,
    modules: modulos,
    startedAt: new Date().toISOString(),
    device: null,
    system: null,
    apps: null,
    security: null,
    battery: null,
    storage: null,
    memory: null,
    permissions: null,
    health: null,
    threats: [],
    warnings: [],
    stages: {},
  }

  for (let indice = 0; indice < etapas.length; indice += 1) {
    const etapa = etapas[indice]
    resultado.stages[etapa.id] = { status: 'running', startedAt: new Date().toISOString() }
    onProgress({
      stage: etapa.id,
      label: etapa.label,
      status: 'running',
      index: indice,
      total: etapas.length,
      progress: Math.round((indice / etapas.length) * 100),
    })

    try {
      if (etapa.id === 'identification') {
        resultado.device = await coletarIdentificacao(serial)
      } else if (etapa.id === 'system') {
        resultado.system = await coletarIdentificacao(serial)
      } else if (etapa.id === 'apps') {
        resultado.apps = await listarAppsInstalados(serial)
      } else if (etapa.id === 'permissions') {
        resultado.permissions = {
          available: false,
          message: 'Esta versão do Android não expõe, de forma consistente via ADB, as permissões concedidas por aplicativo. Nenhuma inferência foi feita.',
        }
      } else if (etapa.id === 'security') {
        resultado.security = await coletarSinaisSeguranca(serial)
      } else if (etapa.id === 'battery') {
        resultado.battery = await coletarBateria(serial)
      } else if (etapa.id === 'storage') {
        resultado.storage = await coletarArmazenamento(serial)
      } else if (etapa.id === 'performance') {
        resultado.memory = await coletarMemoria(serial)
      } else if (etapa.id === 'consolidation') {
        resultado.health = calcularHealthScore(resultado)
      }
      resultado.stages[etapa.id] = { ...resultado.stages[etapa.id], status: 'completed', finishedAt: new Date().toISOString() }
      onProgress({
        stage: etapa.id,
        label: etapa.label,
        status: 'completed',
        index: indice + 1,
        total: etapas.length,
        progress: Math.round(((indice + 1) / etapas.length) * 100),
      })
    } catch (erro) {
      resultado.stages[etapa.id] = { ...resultado.stages[etapa.id], status: 'unavailable', finishedAt: new Date().toISOString() }
      resultado.warnings.push({ stage: etapa.id, code: erro.codigo || 'COLLECTION_UNAVAILABLE', message: erro.message })
      onProgress({
        stage: etapa.id,
        label: etapa.label,
        status: 'unavailable',
        index: indice + 1,
        total: etapas.length,
        progress: Math.round(((indice + 1) / etapas.length) * 100),
        message: erro.message,
      })
    }
  }

  resultado.finishedAt = new Date().toISOString()
  return resultado
}

async function coletarDiagnostico(serial) {
  const resultado = await executarScan(serial, { mode: 'quick' })
  return {
    ...resultado,
    armazenamento: resultado.storage || { totalGb: null, usedGb: null, freeGb: null },
    memoria: resultado.memory || { totalGb: null, availableGb: null, usedGb: null },
    totalApps: resultado.apps?.total ?? null,
  }
}

async function verificarEstado() {
  let dispositivos
  try {
    dispositivos = await listarDispositivos()
  } catch (erro) {
    if (erro.codigo === 'ADB_NOT_FOUND') {
      return {
        status: 'error',
        code: 'ADB_NOT_FOUND',
        message: 'Não foi possível localizar o ADB. Verifique a instalação ou a configuração do ambiente.',
      }
    }
    if (erro.codigo === 'ADB_TIMEOUT') {
      return {
        status: 'error',
        code: 'ADB_TIMEOUT',
        message: 'O serviço de dispositivos demorou para responder. Verifique o ADB e o cabo USB.',
      }
    }
    return {
      status: 'error',
      code: 'ADB_UNAVAILABLE',
      message: 'Não foi possível comunicar com o ADB. Verifique a instalação, os drivers USB e o cabo.',
    }
  }

  if (dispositivos.length === 0) return { status: 'waiting', devices: [] }
  if (dispositivos.length > 1) return { status: 'multiple', devices: dispositivos }

  const alvo = dispositivos[0]
  if (alvo.status === 'unauthorized') return { status: 'unauthorized', serial: alvo.serial, devices: dispositivos }
  if (alvo.status === 'offline') return { status: 'offline', serial: alvo.serial, devices: dispositivos }
  if (alvo.status !== 'device') {
    return {
      status: 'error',
      code: 'ADB_UNKNOWN_STATUS',
      serial: alvo.serial,
      adbStatus: alvo.status,
      message: 'O dispositivo retornou um estado de conexão não reconhecido.',
    }
  }

  try {
    const [device, battery, storage, memory] = await Promise.all([
      coletarIdentificacao(alvo.serial),
      coletarBateria(alvo.serial),
      coletarArmazenamento(alvo.serial),
      coletarMemoria(alvo.serial),
    ])
    return {
      status: 'connected',
      serial: alvo.serial,
      devices: dispositivos,
      ...device,
      battery,
      storage,
      memory,
    }
  } catch (erro) {
    return {
      status: 'error',
      code: erro.codigo || 'DEVICE_COMMUNICATION',
      serial: alvo.serial,
      message: 'O dispositivo foi autorizado, mas não foi possível ler suas informações.',
    }
  }
}

async function obterPreviewRemocao(serial, packageName) {
  if (!pacoteValido(packageName)) {
    throw criarErro('INVALID_PACKAGE', 'O pacote informado é inválido.')
  }
  const apps = await listarAppsInstalados(serial)
  const app = apps.items.find((item) => item.packageName === packageName)
  if (!app || app.type !== 'user') {
    throw criarErro('APP_NOT_REMOVABLE', 'Apenas aplicativos de usuário identificados pelo ADB podem ser removidos.')
  }

  const confirmationToken = crypto.randomUUID()
  removalTokens.set(confirmationToken, { serial, packageName, expiresAt: Date.now() + 2 * 60 * 1000 })
  return {
    removable: true,
    confirmationToken,
    app,
    impact: 'O Android desinstalará este aplicativo de usuário. Componentes de sistema não serão alterados.',
  }
}

async function desinstalarAppUsuario(serial, packageName, confirmationToken) {
  const preview = removalTokens.get(confirmationToken)
  removalTokens.delete(confirmationToken)
  if (!preview || preview.expiresAt < Date.now() || preview.serial !== serial || preview.packageName !== packageName) {
    throw criarErro('CONFIRMATION_REQUIRED', 'Confirmação expirada ou inválida. Revise a remoção antes de continuar.')
  }
  if (!pacoteValido(packageName)) {
    throw criarErro('INVALID_PACKAGE', 'O pacote informado é inválido.')
  }

  const apps = await listarAppsInstalados(serial)
  const app = apps.items.find((item) => item.packageName === packageName)
  if (!app || app.type !== 'user') {
    throw criarErro('APP_NOT_REMOVABLE', 'O aplicativo não é removível pelo DiagPro.')
  }

  const saida = await runAdb(['-s', serial, 'uninstall', packageName], { timeout: EXTENDED_ADB_TIMEOUT })
  if (!/^success$/im.test(saida)) {
    throw criarErro('UNINSTALL_FAILED', saida || 'O Android não confirmou a desinstalação do aplicativo.')
  }
  return { ok: true, packageName, message: 'Aplicativo removido com sucesso.' }
}

module.exports = {
  coletarDiagnostico,
  desinstalarAppUsuario,
  executarScan,
  listarAppsInstalados,
  obterPreviewRemocao,
  verificarEstado,
}
