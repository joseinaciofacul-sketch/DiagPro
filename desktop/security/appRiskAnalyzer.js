const RISK_LEVEL_THRESHOLDS = Object.freeze({ status: 'reserved_for_stage_4' })
const ORIGIN_CORRELATION_WEIGHTS = Object.freeze({ status: 'retired_in_stage_3' })
const CORRELATION_RULES = Object.freeze([])

function nivelRisco() {
  return 'not_calculated'
}

function calcularConfianca(details, capabilities = []) {
  if (!details?.available) return 'low'
  return capabilities.some((capability) => ['effective', 'enabled'].includes(capability.state)) ? 'high' : 'medium'
}

function criarPerfilRiscoAplicativo(app) {
  if (app?.type !== 'user') return null
  const result = require('./securityAnalyzer').analisarSeguranca({ permissions: { items: [app] } })
  const profile = result.appRiskProfiles[0] || null
  return profile ? { ...profile, finding: result.findings[0] || null } : null
}

function criarFindingAplicativo(profile) {
  return profile?.finding || null
}

module.exports = {
  CORRELATION_RULES,
  ORIGIN_CORRELATION_WEIGHTS,
  RISK_LEVEL_THRESHOLDS,
  calcularConfianca,
  criarFindingAplicativo,
  criarPerfilRiscoAplicativo,
  nivelRisco,
}
