const {
  analisarBuild,
  analisarConfiguracoes,
  analisarRoot,
  analisarSecurityPatch,
} = require('./securityRules')
const { criarFindingAplicativo, criarPerfilRiscoAplicativo } = require('./appRiskAnalyzer')

const SEVERITY_PRIORITY = Object.freeze({ info: 0, low: 1, medium: 2, high: 3, critical: 4 })
const CONFIDENCE_PRIORITY = Object.freeze({ low: 0, medium: 1, high: 2 })

function ordenarFindings(a, b) {
  const severityDifference = (SEVERITY_PRIORITY[b.severity] || 0) - (SEVERITY_PRIORITY[a.severity] || 0)
  if (severityDifference !== 0) return severityDifference
  const riskDifference = (b.risk?.score || 0) - (a.risk?.score || 0)
  if (riskDifference !== 0) return riskDifference
  return (CONFIDENCE_PRIORITY[b.confidence] || 0) - (CONFIDENCE_PRIORITY[a.confidence] || 0)
}

function analisarSeguranca({ security = null, apps = null, permissions = null } = {}, options = {}) {
  const findings = []

  if (security) {
    findings.push(...analisarSecurityPatch(security.securityPatch, options))
    findings.push(...analisarBuild(security))
    findings.push(...analisarConfiguracoes(security))
    findings.push(...analisarRoot(security.root))
  }

  const itens = Array.isArray(permissions?.items)
    ? permissions.items
    : Array.isArray(apps?.items)
      ? apps.items
      : []
  const appRiskProfiles = itens
    .filter((app) => app?.type === 'user')
    .map(criarPerfilRiscoAplicativo)
    .filter(Boolean)
  appRiskProfiles.forEach((profile) => {
    const finding = criarFindingAplicativo(profile)
    if (finding) findings.push(finding)
  })

  return {
    findings: findings.sort(ordenarFindings),
    appRiskProfiles,
    // Score técnico prioriza investigação; sem evidência comportamental, não classifica ameaças.
    threats: [],
  }
}

module.exports = { analisarSeguranca, ordenarFindings }
