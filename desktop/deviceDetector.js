const crypto = require('crypto')
const { createAdbClient, isValidSerial } = require('./adb/adbClient')
const { ADB_ERROR_CODES, createAdbError } = require('./adb/adbErrors')
const {
  parseAdbDevices,
  parseBattery,
  parseMemory,
  parseStorage,
} = require('./security/parsers/adbParsers')
const { createDeviceCollector } = require('./security/collectors/deviceCollector')
const { createDeviceSecurityCollector } = require('./security/collectors/deviceSecurityCollector')
const { createPackageCollector } = require('./security/collectors/packageCollector')
const { analisarSeguranca } = require('./security/securityAnalyzer')
const { applyRiskToAppProfiles, scoreSecurityRisk } = require('./security/riskScorer')
const { buildSecurityCoverage } = require('./security/securityCoverage')
const { planejarRemediacoes } = require('./remediation/remediationPlanner')
const { criarExecutorRemediacao } = require('./remediation/remediationExecutor')
const { createRemediationService } = require('./remediation/remediationService')

const ADB_TIMEOUT = 6000
const EXTENDED_ADB_TIMEOUT = 20000
const HASH_ADB_TIMEOUT = 30000
const HASH_BATCH_SIZE = 16
const HASH_BATCH_CONCURRENCY = 2
const MAX_BUFFER = 10 * 1024 * 1024
const APP_DETAILS_CONCURRENCY = 4
const adbClient = createAdbClient()
const deviceCollector = createDeviceCollector({ adb: adbClient })
const securityCollector = createDeviceSecurityCollector({ adb: adbClient, deviceCollector })
const packageCollector = createPackageCollector({
  adb: adbClient,
  deviceCollector,
  securityCollector,
  detailConcurrency: APP_DETAILS_CONCURRENCY,
  extendedTimeout: EXTENDED_ADB_TIMEOUT,
  hashBatchSize: HASH_BATCH_SIZE,
  hashBatchConcurrency: HASH_BATCH_CONCURRENCY,
  hashTimeout: HASH_ADB_TIMEOUT,
})

const TERMINAL_SCAN_CODES = new Set([
  ADB_ERROR_CODES.SCAN_ABORTED,
  ADB_ERROR_CODES.DEVICE_DISCONNECTED,
  ADB_ERROR_CODES.DEVICE_NOT_FOUND,
  ADB_ERROR_CODES.DEVICE_OFFLINE,
  ADB_ERROR_CODES.DEVICE_UNAUTHORIZED,
])

function criarErro(codigo, mensagem) {
  return createAdbError(codigo, mensagem)
}

function localizarAdb() {
  return adbClient.executable()
}

function runAdb(args, { timeout = ADB_TIMEOUT, maxBuffer = MAX_BUFFER, signal = null } = {}) {
  return adbClient.run(args, {
    timeout,
    maxBuffer,
    signal,
    deviceCommand: args[0] === '-s',
  })
}

function serialValido(serial) {
  return isValidSerial(serial)
}

function parseDispositivos(saida) {
  return parseAdbDevices(saida).map(({ serial, status }) => ({ serial, status }))
}

function parseBateria(saida) {
  return parseBattery(saida)
}

function parseArmazenamento(saida) {
  return parseStorage(saida)
}

function parseMemoria(saida) {
  return parseMemory(saida)
}

async function listarDispositivos({ signal = null } = {}) {
  return parseDispositivos(await runAdb(['devices', '-l'], { signal }))
}

async function validarDispositivoAutorizado(serial, { signal = null } = {}) {
  if (!serialValido(serial)) {
    throw criarErro('INVALID_DEVICE', 'O dispositivo informado é inválido.')
  }

  const dispositivos = await listarDispositivos({ signal })
  const dispositivo = dispositivos.find((item) => item.serial === serial)
  if (!dispositivo) {
    throw criarErro('DEVICE_NOT_FOUND', 'O dispositivo não está mais conectado.')
  }
  if (dispositivo.status === 'unauthorized') {
    throw criarErro('DEVICE_UNAUTHORIZED', 'Autorize a depuração USB no dispositivo para continuar.')
  }
  if (dispositivo.status === 'offline') {
    throw criarErro('DEVICE_OFFLINE', 'O dispositivo está offline. Reconecte o cabo USB e tente novamente.')
  }
  if (dispositivo.status !== 'device') {
    throw criarErro('DEVICE_NOT_READY', 'O dispositivo não está pronto para análise.')
  }
  return dispositivo
}

async function coletarIdentificacao(serial, options = {}) {
  return deviceCollector.collectIdentification(serial, options)
}

async function coletarBateria(serial, options = {}) {
  return deviceCollector.collectBattery(serial, options)
}

async function coletarArmazenamento(serial, options = {}) {
  return deviceCollector.collectStorage(serial, options)
}

async function coletarMemoria(serial, options = {}) {
  return deviceCollector.collectMemory(serial, options)
}

async function verificarAdb() {
  const output = await runAdb(['version'])
  const versionMatch = output.match(/Android Debug Bridge version\s+([^\r\n]+)/i)
  return {
    available: true,
    version: versionMatch ? versionMatch[1].trim() : null,
    executable: localizarAdb(),
  }
}

async function coletarSinaisSeguranca(serial, options = {}) {
  return securityCollector.collectSecurity(serial, options)
}

async function listarAppsInstalados(serial, options = {}) {
  if (!options.skipValidation) {
    await validarDispositivoAutorizado(serial, { signal: options.signal || null })
  }
  return packageCollector.listInstalledApps(serial, options)
}

async function coletarAnalisePermissoes(serial, appsExistentes = null, options = {}) {
  const apps = Array.isArray(appsExistentes?.items)
    ? appsExistentes
    : await listarAppsInstalados(serial, { ...options, includeSecurityDetails: true })
  const itensUsuario = apps.items.filter((app) => app.type === 'user')
  const analisados = itensUsuario.filter((app) => app.securityDetails?.available)
  const indisponiveis = itensUsuario.length - analisados.length

  return {
    available: analisados.length > 0 || itensUsuario.length === 0,
    source: 'adb_dumpsys_package',
    analyzedApps: analisados.length,
    unavailableApps: indisponiveis,
    currentUserId: apps.currentUserId ?? null,
    items: itensUsuario,
    message: indisponiveis > 0
      ? `Não foi possível consultar detalhes de permissões de ${indisponiveis} aplicativo(s) de usuário.`
      : null,
  }
}

function calcularHealthScore(resultado) {
  // Compatibilidade: o Health Score legado ainda considera patch/build. A ETAPA 4
  // não reutiliza esta fórmula; securityRisk é calculado separadamente apenas a
  // partir de findings. A retirada dos sinais de segurança do Health Score exige
  // migração controlada para não alterar históricos já persistidos.
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
      metricType: 'operational_health_legacy',
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
    metricType: 'operational_health_legacy',
    compatibilityNotice: 'Security Risk Score é uma métrica independente e não reutiliza esta fórmula.',
  }
}

function normalizarModo(modo, modulos) {
  const permitidos = ['system', 'apps', 'security', 'permissions', 'battery', 'storage', 'performance']
  const customizados = Array.isArray(modulos) ? modulos.filter((modulo) => permitidos.includes(modulo)) : []
  if (modo === 'complete') return permitidos
  if (modo === 'custom') return customizados
  return ['apps', 'security', 'battery', 'storage']
}

function scanStatusForError(error) {
  const code = error?.code || error?.codigo
  if (code === ADB_ERROR_CODES.SCAN_ABORTED) return 'canceled'
  if ([ADB_ERROR_CODES.DEVICE_DISCONNECTED, ADB_ERROR_CODES.DEVICE_NOT_FOUND, ADB_ERROR_CODES.DEVICE_OFFLINE].includes(code)) {
    return 'device_disconnected'
  }
  return 'failed'
}

function assertScanActive(signal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw createAdbError(ADB_ERROR_CODES.SCAN_ABORTED)
}

async function executarScan(serial, {
  mode = 'quick',
  modules = [],
  onProgress = () => {},
  signal = null,
  scanId = crypto.randomUUID(),
} = {}) {
  assertScanActive(signal)
  try {
    await validarDispositivoAutorizado(serial, { signal })
  } catch (error) {
    error.scanId = scanId
    error.scanStatus = scanStatusForError(error)
    throw error
  }
  const modulos = normalizarModo(mode, modules)
  const cache = new Map()
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
    scanId,
    status: 'running',
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
    securityRisk: null,
    threats: [],
    remediations: [],
    warnings: [],
    stages: {},
  }

  for (let indice = 0; indice < etapas.length; indice += 1) {
    assertScanActive(signal)
    const etapa = etapas[indice]
    resultado.stages[etapa.id] = { status: 'running', startedAt: new Date().toISOString() }
    onProgress({
      stage: etapa.id,
      label: etapa.label,
      status: 'running',
      index: indice,
      total: etapas.length,
      progress: Math.round((indice / etapas.length) * 100),
      scanId,
    })

    try {
      if (etapa.id === 'identification') {
        resultado.device = await coletarIdentificacao(serial, { signal, cache })
      } else if (etapa.id === 'system') {
        // A identificação já coletou o snapshot global de propriedades; não repete getprop.
        resultado.system = resultado.device ? { ...resultado.device } : await coletarIdentificacao(serial, { signal, cache })
      } else if (etapa.id === 'apps') {
        resultado.apps = await listarAppsInstalados(serial, {
          skipValidation: true,
          includeSecurityDetails: true,
          includeHashes: false,
          currentUserId: resultado.device?.androidUsers?.currentUserId ?? undefined,
          signal,
          cache,
        })
      } else if (etapa.id === 'permissions') {
        resultado.permissions = await coletarAnalisePermissoes(serial, resultado.apps, { signal, cache })
        if (resultado.permissions.unavailableApps > 0) {
          resultado.warnings.push({
            stage: 'permissions',
            code: 'PARTIAL_PERMISSION_COLLECTION',
            message: resultado.permissions.message,
          })
        }
      } else if (etapa.id === 'security') {
        resultado.security = await coletarSinaisSeguranca(serial, { signal, cache })
      } else if (etapa.id === 'battery') {
        resultado.battery = await coletarBateria(serial, { signal })
      } else if (etapa.id === 'storage') {
        resultado.storage = await coletarArmazenamento(serial, { signal })
      } else if (etapa.id === 'performance') {
        resultado.memory = await coletarMemoria(serial, { signal })
      } else if (etapa.id === 'consolidation') {
        assertScanActive(signal)
        const analiseSeguranca = analisarSeguranca(resultado)
        const remediationActions = planejarRemediacoes(
          analiseSeguranca.findings,
          resultado.apps?.items || resultado.permissions?.items || [],
        )
        if (resultado.security || analiseSeguranca.observations.length > 0 || analiseSeguranca.findings.length > 0) {
          resultado.security = {
            ...(resultado.security || { collectionAvailable: false }),
            schemaVersion: analiseSeguranca.schemaVersion,
            analysisVersion: analiseSeguranca.analysisVersion,
            observations: analiseSeguranca.observations,
            findings: analiseSeguranca.findings,
            appRiskProfiles: analiseSeguranca.appRiskProfiles,
            confirmedThreats: analiseSeguranca.confirmedThreats,
            reputation: analiseSeguranca.reputation,
            remediationActions,
          }
        }
        resultado.confirmedThreats = analiseSeguranca.confirmedThreats
        resultado.threats = analiseSeguranca.confirmedThreats
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
        scanId,
      })
    } catch (erro) {
      const code = erro.code || erro.codigo
      if (TERMINAL_SCAN_CODES.has(code) || signal?.aborted) {
        const finalStatus = scanStatusForError(erro)
        resultado.status = finalStatus
        resultado.stages[etapa.id] = {
          ...resultado.stages[etapa.id],
          status: finalStatus,
          finishedAt: new Date().toISOString(),
        }
        onProgress({
          stage: etapa.id,
          label: etapa.label,
          status: finalStatus,
          index: indice,
          total: etapas.length,
          progress: Math.round((indice / etapas.length) * 100),
          message: erro.message,
          scanId,
        })
        erro.scanId = scanId
        erro.scanStatus = finalStatus
        throw erro
      }
      resultado.stages[etapa.id] = { ...resultado.stages[etapa.id], status: 'unavailable', finishedAt: new Date().toISOString() }
      resultado.warnings.push({ stage: etapa.id, code: code || 'COLLECTION_UNAVAILABLE', message: erro.message })
      onProgress({
        stage: etapa.id,
        label: etapa.label,
        status: 'unavailable',
        index: indice + 1,
        total: etapas.length,
        progress: Math.round(((indice + 1) / etapas.length) * 100),
        message: erro.message,
        scanId,
      })
    }
  }

  assertScanActive(signal)
  resultado.status = resultado.warnings.length > 0 ? 'partial' : 'completed'
  const securityCoverage = buildSecurityCoverage(resultado)
  resultado.securityRisk = scoreSecurityRisk({
    findings: resultado.security?.findings || [],
    coverage: securityCoverage,
    scanStatus: resultado.status,
    confirmedThreats: resultado.confirmedThreats || [],
  })
  if (resultado.security) {
    resultado.security = {
      ...resultado.security,
      securityRisk: resultado.securityRisk,
      appRiskProfiles: applyRiskToAppProfiles(resultado.security.appRiskProfiles || [], resultado.securityRisk),
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

const remediationService = createRemediationService({
  listInstalledApps: listarAppsInstalados,
  validateDevice: validarDispositivoAutorizado,
  runAdb,
  collectDeviceAdmins: (serial, options) => securityCollector.collectDeviceAdmins(serial, options),
  getDeviceInfo: coletarIdentificacao,
})

async function obterPreviewRemocao(serialOrOptions, packageName) {
  const options = typeof serialOrOptions === 'object' && serialOrOptions !== null
    ? serialOrOptions
    : { serial: serialOrOptions, packageName }
  return remediationService.createRemovalPreview(options)
}

async function executarDesinstalacaoComToken(options) {
  return remediationService.executeUninstall(options)
}

async function verificarAusenciaPacoteUsuario(options) {
  return remediationService.verifyPackageAbsent(options)
}

const remediationExecutor = criarExecutorRemediacao({
  uninstall: executarDesinstalacaoComToken,
  verify: verificarAusenciaPacoteUsuario,
})

async function desinstalarAppUsuario(serialOrOptions, packageName, confirmationToken, findingId = null) {
  const options = typeof serialOrOptions === 'object' && serialOrOptions !== null
    ? serialOrOptions
    : { serial: serialOrOptions, packageName, confirmationToken, findingId }
  return remediationExecutor.execute(options)
}

function cancelarRemediacao(actionId, confirmationToken) {
  return remediationService.cancelPreview({ actionId, confirmationToken })
}

module.exports = {
  coletarDiagnostico,
  cancelarRemediacao,
  desinstalarAppUsuario,
  executarScan,
  listarAppsInstalados,
  obterPreviewRemocao,
  verificarAdb,
  verificarEstado,
}
