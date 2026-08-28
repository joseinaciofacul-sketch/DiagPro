const { execFile } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { analisarSeguranca } = require('./security/securityAnalyzer')
const { planejarRemediacoes } = require('./remediation/remediationPlanner')
const { criarExecutorRemediacao } = require('./remediation/remediationExecutor')

const ADB_TIMEOUT = 6000
const EXTENDED_ADB_TIMEOUT = 20000
const HASH_ADB_TIMEOUT = 30000
const HASH_BATCH_SIZE = 16
const HASH_BATCH_CONCURRENCY = 2
const MAX_BUFFER = 10 * 1024 * 1024
const APP_DETAILS_CONCURRENCY = 4
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

function booleanoAndroid(valor) {
  if (valor === '1' || valor === 'true') return true
  if (valor === '0' || valor === 'false') return false
  return null
}

async function lerConfiguracaoAndroid(serial, namespace, chave) {
  try {
    const valor = (await runAdb(['-s', serial, 'shell', 'settings', 'get', namespace, chave])).trim()
    return !valor || valor === 'null' ? null : valor
  } catch {
    return null
  }
}

function parseServicosAcessibilidade(valor) {
  if (!valor) return []
  return valor.split(':').map((servico) => servico.trim()).filter(Boolean)
}

async function coletarServicosAcessibilidade(serial) {
  return parseServicosAcessibilidade(
    await lerConfiguracaoAndroid(serial, 'secure', 'enabled_accessibility_services'),
  )
}

async function coletarEstadoRoot(serial) {
  try {
    const caminho = (await runAdb([
      '-s', serial, 'shell', 'sh', '-c', '(command -v su 2>/dev/null || which su 2>/dev/null); exit 0',
    ])).split(/\r?\n/).map((linha) => linha.trim()).find(Boolean)
    if (caminho) {
      return {
        status: 'detected',
        message: 'O shell ADB localizou um executável su acessível.',
        evidence: { path: caminho },
      }
    }
    return {
      status: 'not_detected',
      message: 'Nenhum executável su acessível foi localizado pelo shell ADB nesta verificação.',
      evidence: { commandCompleted: true },
    }
  } catch {
    return {
      status: 'not_verified',
      message: 'Não foi possível verificar a presença de um executável su acessível ao shell ADB.',
    }
  }
}

async function coletarSinaisSeguranca(serial) {
  const [propriedades, packageVerifier, verifyAdbInstalls, accessibilityEnabled, enabledServices, root] = await Promise.all([
    lerPropriedades(serial, [
      'ro.build.version.security_patch',
      'ro.debuggable',
      'ro.secure',
      'ro.build.tags',
    ]),
    lerConfiguracaoAndroid(serial, 'global', 'package_verifier_enable'),
    lerConfiguracaoAndroid(serial, 'global', 'verifier_verify_adb_installs'),
    lerConfiguracaoAndroid(serial, 'secure', 'accessibility_enabled'),
    coletarServicosAcessibilidade(serial),
    coletarEstadoRoot(serial),
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
    buildTags: propriedades['ro.build.tags'],
    packageVerifierEnabled: booleanoAndroid(packageVerifier),
    verifyAdbInstalls: booleanoAndroid(verifyAdbInstalls),
    accessibility: {
      enabled: booleanoAndroid(accessibilityEnabled),
      enabledServices,
    },
    root,
    findings: [],
  }
}

function caminhoApkValido(apkPath) {
  return typeof apkPath === 'string'
    && /^\/[A-Za-z0-9_./=+~:-]+\.apk$/.test(apkPath)
}

function valorCampo(saida, campo) {
  const match = saida.match(new RegExp(`(?:^|[\\s{])${campo}=([^\\s}\\r\\n]+)`, 'mi'))
  if (!match) return null
  const valor = match[1].trim()
  return !valor || valor === 'null' ? null : valor
}

function parseDetalhesPacote(saida, packageName, enabledAccessibilityServices = [], listedApkPath = null) {
  const requestedPermissions = []
  const grantedPermissions = []
  const flags = new Set()
  let lendoSolicitadas = false
  let installed = null
  let enabled = null
  let firstInstallTime = null
  let lastUpdateTime = null
  let versionName = null
  let versionCode = null
  let uid = null
  let codePath = null
  let resourcePath = null

  saida.split(/\r?\n/).forEach((linha) => {
    const texto = linha.trim()
    if (texto === 'requested permissions:') {
      lendoSolicitadas = true
      return
    }
    if (lendoSolicitadas) {
      if (/^android\.permission\.[A-Za-z0-9_]+$/.test(texto)) {
        requestedPermissions.push(texto)
      } else if (texto && /:$/.test(texto)) {
        lendoSolicitadas = false
      }
    }

    const permissaoConcedida = texto.match(/^(android\.permission\.[A-Za-z0-9_]+):\s+granted=true\b/)
    if (permissaoConcedida) grantedPermissions.push(permissaoConcedida[1])

    const flagsMatch = texto.match(/^(?:pkgFlags|flags)=\[([^\]]*)\]/)
    if (flagsMatch) flagsMatch[1].split(/\s+/).filter(Boolean).forEach((flag) => flags.add(flag))

    const firstInstallMatch = texto.match(/^firstInstallTime=(.+)$/)
    if (firstInstallMatch) firstInstallTime = firstInstallMatch[1].trim()
    const lastUpdateMatch = texto.match(/^lastUpdateTime=(.+)$/)
    if (lastUpdateMatch) lastUpdateTime = lastUpdateMatch[1].trim()
    const versionNameMatch = texto.match(/^versionName=(.*)$/)
    if (versionNameMatch) versionName = versionNameMatch[1].trim() || null
    const versionCodeMatch = texto.match(/^versionCode=(\d+)\b/)
    if (versionCodeMatch) versionCode = versionCodeMatch[1]
    const uidMatch = texto.match(/^(?:userId|appId)=(\d+)\b/)
    if (uidMatch && uid === null) uid = inteiro(uidMatch[1])
    const codePathMatch = texto.match(/^codePath=(.+)$/)
    if (codePathMatch) codePath = codePathMatch[1].trim()
    const resourcePathMatch = texto.match(/^resourcePath=(.+)$/)
    if (resourcePathMatch) resourcePath = resourcePathMatch[1].trim()

    const userState = texto.match(/^User\s+0:.*\binstalled=(true|false)\b/)
    if (userState) installed = userState[1] === 'true'
    const enabledState = texto.match(/^User\s+0:.*\benabled=(\d+)\b/)
    if (enabledState) enabled = !['2', '3', '4'].includes(enabledState[1])
  })

  const installerPackageName = valorCampo(saida, 'installerPackageName')
  const initiatingPackageName = valorCampo(saida, 'initiatingPackageName')
  const originatingPackageName = valorCampo(saida, 'originatingPackageName')
  const signatureVersionMatch = saida.match(/signatures=PackageSignatures\{[^\r\n}]*version:(\d+)/i)
  const apkPath = [listedApkPath, resourcePath, codePath].find(caminhoApkValido) || null

  return {
    available: true,
    requestedPermissions: [...new Set(requestedPermissions)].sort(),
    grantedPermissions: [...new Set(grantedPermissions)].sort(),
    flags: [...flags].sort(),
    installed,
    enabled,
    firstInstallTime,
    lastUpdateTime,
    versionName,
    versionCode,
    uid,
    apkPath,
    installerPackageName,
    initiatingPackageName,
    originatingPackageName,
    integrity: {
      hash: { algorithm: 'SHA-256', hash: null, status: 'not_verified', reason: 'HASH_NOT_COLLECTED' },
      signature: {
        status: 'not_verified',
        certificateDigest: null,
        digestAlgorithm: null,
        schemeVersion: signatureVersionMatch ? inteiro(signatureVersionMatch[1]) : null,
        reason: 'CERTIFICATE_DIGEST_UNAVAILABLE_VIA_ADB',
      },
    },
    accessibilityServiceEnabled: enabledAccessibilityServices.some((service) => service.startsWith(`${packageName}/`)),
  }
}

async function coletarHashesApks(serial, detalhesPorPacote) {
  const candidatos = [...detalhesPorPacote.values()].filter((details) => details?.available && caminhoApkValido(details.apkPath))
  const lotes = []
  for (let indice = 0; indice < candidatos.length; indice += HASH_BATCH_SIZE) {
    lotes.push(candidatos.slice(indice, indice + HASH_BATCH_SIZE))
  }

  await mapComConcorrencia(lotes, HASH_BATCH_CONCURRENCY, async (lote) => {
    lote.forEach((details) => {
      details.integrity.hash = {
        algorithm: 'SHA-256', hash: null, status: 'not_verified', reason: 'HASH_COMMAND_UNAVAILABLE',
      }
    })
    try {
      const saida = await runAdb(
        ['-s', serial, 'shell', 'sha256sum', ...lote.map((details) => details.apkPath)],
        { timeout: HASH_ADB_TIMEOUT },
      )
      const hashesPorCaminho = new Map()
      saida.split(/\r?\n/).forEach((linha) => {
        const match = linha.trim().match(/^([a-fA-F0-9]{64})\s+(.+)$/)
        if (match && caminhoApkValido(match[2])) hashesPorCaminho.set(match[2], match[1].toLowerCase())
      })
      lote.forEach((details) => {
        const hash = hashesPorCaminho.get(details.apkPath)
        details.integrity.hash = hash
          ? { algorithm: 'SHA-256', hash, status: 'available', reason: null }
          : { algorithm: 'SHA-256', hash: null, status: 'not_verified', reason: 'INVALID_HASH_OUTPUT' }
      })
    } catch {
      // A indisponibilidade permanece registrada individualmente, sem virar finding.
    }
  })

  detalhesPorPacote.forEach((details) => {
    if (!details?.available) return
    if (!caminhoApkValido(details.apkPath)) {
      details.integrity.hash = {
        algorithm: 'SHA-256', hash: null, status: 'not_verified', reason: 'APK_PATH_UNAVAILABLE',
      }
    }
  })
}

async function mapComConcorrencia(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

async function listarAppsInstalados(serial, { includeSecurityDetails = false } = {}) {
  await validarDispositivoAutorizado(serial)
  const [usuarioRaw, sistemaRaw] = await Promise.all([
    runAdb(['-s', serial, 'shell', 'pm', 'list', 'packages', '-3', '-f'], { timeout: EXTENDED_ADB_TIMEOUT }),
    runAdb(['-s', serial, 'shell', 'pm', 'list', 'packages', '-s'], { timeout: EXTENDED_ADB_TIMEOUT }),
  ])

  const paraApps = (saida, type) => saida
    .split(/\r?\n/)
    .map((linha) => linha.trim().replace(/^package:/, ''))
    .map((linha) => {
      if (type !== 'user' || !linha.includes('=')) return { packageName: linha, apkPath: null }
      const separator = linha.lastIndexOf('=')
      return { packageName: linha.slice(separator + 1), apkPath: linha.slice(0, separator) }
    })
    .filter((app) => pacoteValido(app.packageName))
    .map(({ packageName, apkPath }) => ({
      name: null,
      packageName,
      ...(caminhoApkValido(apkPath) ? { apkPath } : {}),
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
  let apps = [...appsPorPacote.values()].sort((a, b) => a.packageName.localeCompare(b.packageName))
  let detailsCollectionDurationMs = null

  if (includeSecurityDetails && userApps.length > 0) {
    const enabledAccessibilityServices = await coletarServicosAcessibilidade(serial)
    const detailsStartedAt = Date.now()
    const userDetails = await mapComConcorrencia(userApps, APP_DETAILS_CONCURRENCY, async (app) => {
      try {
        const saida = await runAdb(
          ['-s', serial, 'shell', 'dumpsys', 'package', app.packageName],
          { timeout: EXTENDED_ADB_TIMEOUT },
        )
        return [app.packageName, parseDetalhesPacote(saida, app.packageName, enabledAccessibilityServices, app.apkPath)]
      } catch {
        return [app.packageName, { available: false, reason: 'PACKAGE_DETAILS_UNAVAILABLE' }]
      }
    })
    const detalhesPorPacote = new Map(userDetails)
    await coletarHashesApks(serial, detalhesPorPacote)
    apps = apps.map((app) => app.type === 'user'
      ? { ...app, securityDetails: detalhesPorPacote.get(app.packageName) }
      : app)
    detailsCollectionDurationMs = Date.now() - detailsStartedAt
  }

  return {
    total: apps.length,
    userTotal: apps.filter((app) => app.type === 'user').length,
    systemTotal: apps.filter((app) => app.type === 'system').length,
    items: apps,
    detailsCollectionDurationMs,
  }
}

async function coletarAnalisePermissoes(serial, appsExistentes = null) {
  const apps = Array.isArray(appsExistentes?.items)
    ? appsExistentes
    : await listarAppsInstalados(serial, { includeSecurityDetails: true })
  const itensUsuario = apps.items.filter((app) => app.type === 'user')
  const analisados = itensUsuario.filter((app) => app.securityDetails?.available)
  const indisponiveis = itensUsuario.length - analisados.length

  return {
    available: analisados.length > 0 || itensUsuario.length === 0,
    source: 'adb_dumpsys_package',
    analyzedApps: analisados.length,
    unavailableApps: indisponiveis,
    items: itensUsuario,
    message: indisponiveis > 0
      ? `Não foi possível consultar detalhes de permissões de ${indisponiveis} aplicativo(s) de usuário.`
      : null,
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
    remediations: [],
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
        resultado.apps = await listarAppsInstalados(serial, { includeSecurityDetails: true })
      } else if (etapa.id === 'permissions') {
        resultado.permissions = await coletarAnalisePermissoes(serial, resultado.apps)
        if (resultado.permissions.unavailableApps > 0) {
          resultado.warnings.push({
            stage: 'permissions',
            code: 'PARTIAL_PERMISSION_COLLECTION',
            message: resultado.permissions.message,
          })
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
        const analiseSeguranca = analisarSeguranca(resultado)
        const remediationActions = planejarRemediacoes(
          analiseSeguranca.findings,
          resultado.apps?.items || resultado.permissions?.items || [],
        )
        if (resultado.security || analiseSeguranca.findings.length > 0 || analiseSeguranca.appRiskProfiles.length > 0) {
          resultado.security = {
            ...(resultado.security || { collectionAvailable: false }),
            findings: analiseSeguranca.findings,
            appRiskProfiles: analiseSeguranca.appRiskProfiles,
            remediationActions,
          }
        }
        resultado.threats = analiseSeguranca.threats
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
    impact: 'O Android desinstalará este aplicativo de usuário. Dados e configurações locais do aplicativo podem ser perdidos; componentes de sistema não serão alterados.',
  }
}

async function executarDesinstalacaoComToken({ serial, packageName, confirmationToken }) {
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
  return { ok: true, packageName, output: 'Success' }
}

async function verificarAusenciaPacoteUsuario({ serial, packageName }) {
  if (!serialValido(serial) || !pacoteValido(packageName)) {
    return { status: 'not_verified', installed: null, source: 'package_manager' }
  }
  try {
    await validarDispositivoAutorizado(serial)
    const saida = await runAdb(
      ['-s', serial, 'shell', 'pm', 'list', 'packages', '--user', '0', packageName],
      { timeout: EXTENDED_ADB_TIMEOUT },
    )
    const installed = saida.split(/\r?\n/)
      .map((linha) => linha.trim().replace(/^package:/, ''))
      .some((pacote) => pacote === packageName)
    return { status: 'verified', installed, source: 'package_manager', user: 0 }
  } catch {
    return { status: 'not_verified', installed: null, source: 'package_manager', user: 0 }
  }
}

const remediationExecutor = criarExecutorRemediacao({
  uninstall: executarDesinstalacaoComToken,
  verify: verificarAusenciaPacoteUsuario,
})

async function desinstalarAppUsuario(serial, packageName, confirmationToken, findingId = null) {
  return remediationExecutor.execute({ serial, packageName, confirmationToken, findingId })
}

module.exports = {
  coletarDiagnostico,
  desinstalarAppUsuario,
  executarScan,
  listarAppsInstalados,
  obterPreviewRemocao,
  verificarEstado,
}
