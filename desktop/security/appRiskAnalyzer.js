const {
  CAPABILITY_DEFINITIONS,
  derivarCapacidades,
  normalizarSinaisAplicativo,
} = require('./permissionRules')
const {
  normalizarIdentidade,
  normalizarIntegridade,
  normalizarOrigem,
} = require('./appIdentityNormalizer')

const RISK_LEVEL_THRESHOLDS = Object.freeze({ low: 8, moderate: 20, high: 40, critical: 65 })
const ORIGIN_CORRELATION_WEIGHTS = Object.freeze({ unknown: 4, adb: 6 })
const HIGH_IMPACT_CAPABILITIES = new Set(['ACCESSIBILITY', 'OVERLAY', 'PACKAGE_INSTALL', 'SMS', 'CALLS'])

const CORRELATION_RULES = Object.freeze([
  {
    id: 'accessibility_overlay',
    capabilities: ['ACCESSIBILITY', 'OVERLAY'],
    weight: 18,
    message: 'Serviço de acessibilidade ativo combinado com sobreposição de tela.',
  },
  {
    id: 'accessibility_package_install',
    capabilities: ['ACCESSIBILITY', 'PACKAGE_INSTALL'],
    weight: 18,
    message: 'Serviço de acessibilidade ativo combinado com capacidade de instalação de pacotes.',
  },
  {
    id: 'overlay_package_install',
    capabilities: ['OVERLAY', 'PACKAGE_INSTALL'],
    weight: 14,
    message: 'Sobreposição de tela combinada com capacidade de instalação de pacotes.',
  },
  {
    id: 'sms_contacts_calls',
    capabilities: ['SMS', 'CONTACTS', 'CALLS'],
    weight: 12,
    message: 'Capacidades concedidas de SMS, contatos e chamadas aparecem combinadas.',
  },
  {
    id: 'sensors_location',
    capabilities: ['MICROPHONE', 'CAMERA', 'LOCATION'],
    weight: 8,
    minimumVerifiedCapabilities: 4,
    message: 'Microfone, câmera e localização aparecem com outras capacidades sensíveis concedidas.',
  },
])

function nivelRisco(score) {
  if (score >= RISK_LEVEL_THRESHOLDS.critical) return 'critical'
  if (score >= RISK_LEVEL_THRESHOLDS.high) return 'high'
  if (score >= RISK_LEVEL_THRESHOLDS.moderate) return 'moderate'
  if (score >= RISK_LEVEL_THRESHOLDS.low) return 'low'
  return 'minimal'
}

function calcularConfianca(details, capabilities) {
  if (!details?.available) return 'low'
  const verified = capabilities.filter((capability) => ['granted', 'enabled'].includes(capability.state)).length
  if (verified >= 2) return 'high'
  if (verified === 1 || capabilities.length > 0) return 'medium'
  return 'medium'
}

function criarRazaoCapacidade(capability) {
  const definition = CAPABILITY_DEFINITIONS[capability.id]
  const verified = ['granted', 'enabled'].includes(capability.state)
  const points = verified ? definition.grantedWeight : definition.requestedWeight
  const stateLabel = capability.state === 'enabled'
    ? 'habilitada'
    : capability.state === 'granted'
      ? 'concedida'
      : 'declarada, sem confirmação de concessão'

  return {
    id: `capability.${capability.id.toLowerCase()}.${capability.state}`,
    points,
    message: `Capacidade ${definition.label} ${stateLabel}.`,
    evidence: {
      capability: capability.id,
      state: capability.state,
      signals: capability.evidence,
    },
  }
}

function criarPerfilRiscoAplicativo(app) {
  const details = app?.securityDetails
  if (app?.type !== 'user') return null
  const identity = normalizarIdentidade(app)
  const origin = normalizarOrigem(details)
  const integrity = normalizarIntegridade(details)

  if (!details?.available) {
    return {
      packageName: app.packageName,
      identity,
      origin,
      integrity,
      signals: [],
      capabilities: [],
      findings: [],
      risk: {
        score: 0,
        rawScore: 0,
        level: 'minimal',
        confidence: 'low',
        evidenceCoverage: {
          packageDetails: 'not_verified',
          origin: origin.status,
          hash: integrity.hash.status,
          signature: integrity.signature.status,
        },
        reasons: [{
          id: 'collection.package_details_unavailable',
          points: 0,
          message: 'Detalhes técnicos do pacote não estavam disponíveis para avaliação.',
          evidence: { available: false },
        }],
      },
    }
  }

  const signals = normalizarSinaisAplicativo(app)
  const capabilities = derivarCapacidades(signals)
  const reasons = capabilities.map(criarRazaoCapacidade).filter((reason) => reason.points > 0)
  const verifiedCapabilities = new Set(
    capabilities.filter((capability) => ['granted', 'enabled'].includes(capability.state)).map((capability) => capability.id),
  )

  CORRELATION_RULES.forEach((rule) => {
    const matches = rule.capabilities.every((capability) => verifiedCapabilities.has(capability))
    const meetsMinimum = !rule.minimumVerifiedCapabilities
      || verifiedCapabilities.size >= rule.minimumVerifiedCapabilities
    if (!matches || !meetsMinimum) return
    reasons.push({
      id: `correlation.${rule.id}`,
      points: rule.weight,
      message: rule.message,
      evidence: { capabilities: rule.capabilities },
    })
  })

  const strongCapabilityContext = verifiedCapabilities.size >= 2
    && [...verifiedCapabilities].some((capability) => HIGH_IMPACT_CAPABILITIES.has(capability))
  if (strongCapabilityContext && ['unknown', 'adb'].includes(origin.type)) {
    const points = ORIGIN_CORRELATION_WEIGHTS[origin.type]
    reasons.push({
      id: `correlation.origin_${origin.type}_strong_capabilities`,
      points,
      message: origin.type === 'adb'
        ? 'Instalação via ADB combinada com múltiplas capacidades sensíveis efetivas.'
        : 'Origem de instalação desconhecida combinada com múltiplas capacidades sensíveis efetivas.',
      evidence: {
        originType: origin.type,
        installerPackageName: origin.installerPackageName,
        capabilities: [...verifiedCapabilities].sort(),
      },
    })
  }

  if (verifiedCapabilities.size >= 5) {
    reasons.push({
      id: 'correlation.multiple_verified_capabilities',
      points: 8,
      message: 'Cinco ou mais capacidades sensíveis foram verificadas como concedidas ou habilitadas.',
      evidence: { capabilities: [...verifiedCapabilities].sort(), count: verifiedCapabilities.size },
    })
  }

  const rawScore = reasons.reduce((total, reason) => total + reason.points, 0)
  const score = Math.min(100, rawScore)
  const risk = {
    score,
    rawScore,
    level: nivelRisco(score),
    confidence: calcularConfianca(details, capabilities),
    reasons,
    evidenceCoverage: {
      packageDetails: details.available ? 'available' : 'not_verified',
      origin: origin.status,
      hash: integrity.hash.status,
      signature: integrity.signature.status,
    },
  }
  const profile = {
    packageName: app.packageName,
    identity,
    origin,
    integrity,
    signals,
    capabilities,
    findings: [],
    risk,
  }
  const finding = criarFindingAplicativo(profile)
  if (finding) profile.findings.push(finding.id)
  return profile
}

function criarFindingAplicativo(profile) {
  if (!profile || profile.capabilities.length === 0) return null
  const severityByRisk = {
    minimal: 'info',
    low: 'low',
    moderate: 'medium',
    high: 'high',
    critical: 'critical',
  }
  const verifiedCount = profile.capabilities.filter((capability) => ['granted', 'enabled'].includes(capability.state)).length
  const hasCorrelation = profile.risk.reasons.some((reason) => reason.id.startsWith('correlation.'))

  return {
    id: `app.sensitive_capabilities.${profile.packageName}`,
    category: 'permissions',
    severity: severityByRisk[profile.risk.level],
    confidence: profile.risk.confidence,
    title: hasCorrelation ? 'Combinação de capacidades sensíveis' : 'Aplicativo com capacidade sensível',
    description: hasCorrelation
      ? 'O aplicativo reúne capacidades efetivas de alto impacto que merecem análise adicional. A combinação não comprova comportamento malicioso.'
      : verifiedCount > 0
        ? 'O Android confirmou uma ou mais capacidades sensíveis para o aplicativo. Isoladamente, isso não indica ameaça.'
        : 'O aplicativo declarou capacidades sensíveis, mas a concessão efetiva não foi confirmada. Esse sinal tem peso técnico reduzido.',
    evidence: {
      packageName: profile.packageName,
      verifiedCapabilities: profile.capabilities.filter((capability) => ['granted', 'enabled'].includes(capability.state)).map((capability) => capability.id),
      requestedOnlyCapabilities: profile.capabilities.filter((capability) => capability.state === 'requested').map((capability) => capability.id),
    },
    recommendation: hasCorrelation
      ? 'Revise a finalidade do aplicativo e confirme se todas as capacidades são necessárias. Se a origem ou a finalidade forem desconhecidas, priorize análise adicional antes de qualquer ação.'
      : 'Confirme se as capacidades são necessárias para a função esperada do aplicativo e revogue concessões desnecessárias nas configurações do Android.',
    packageName: profile.packageName,
    source: 'permission_analysis',
    identity: profile.identity,
    origin: profile.origin,
    integrity: profile.integrity,
    capabilities: profile.capabilities,
    risk: profile.risk,
  }
}

module.exports = {
  RISK_LEVEL_THRESHOLDS,
  ORIGIN_CORRELATION_WEIGHTS,
  CORRELATION_RULES,
  nivelRisco,
  calcularConfianca,
  criarPerfilRiscoAplicativo,
  criarFindingAplicativo,
}
