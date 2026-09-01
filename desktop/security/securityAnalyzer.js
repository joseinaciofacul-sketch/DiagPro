const { analyzeObservations } = require('./observationAnalyzer')
const { compareFindings, evaluateRules } = require('./ruleEngine')

function ordenarFindings(a, b) {
  return compareFindings(a, b)
}

function createCompatibilityProfile(context, observations, findings) {
  const appFindings = findings.filter((finding) => finding.subjectType === 'app' && finding.subjectId === context.subjectId)
  const appObservations = observations.filter((observation) => observation.subjectType === 'app' && observation.subjectId === context.subjectId)
  return {
    packageName: context.subjectId,
    identity: context.metadata.identity,
    origin: context.metadata.origin,
    integrity: context.metadata.integrity,
    capabilities: context.metadata.capabilities,
    signals: appObservations,
    findings: appFindings.map((finding) => finding.id),
    evidenceConfidence: appFindings[0]?.evidenceConfidence || 'low',
    risk: {
      status: 'pending_coverage',
      score: null,
      rawScore: null,
      level: 'not_calculated',
      confidence: null,
      reasons: [],
      reason: 'SECURITY_RISK_SCORE_REQUIRES_SCAN_COVERAGE',
    },
  }
}

function analisarSeguranca(input = {}, options = {}) {
  const analyzed = analyzeObservations(input, options)
  const findings = evaluateRules(analyzed, { now: options.now || new Date() })
  const appRiskProfiles = analyzed.appContexts
    .filter((context) => context.facts.app.type === 'user')
    .map((context) => createCompatibilityProfile(context, analyzed.observations, findings))

  return {
    schemaVersion: '1.0',
    analysisVersion: '3.0',
    observations: analyzed.observations,
    findings,
    appRiskProfiles,
    confirmedThreats: [],
    // Alias temporário para consumidores anteriores; não contém findings heurísticos.
    threats: [],
    reputation: { status: 'not_configured', verdict: 'unknown' },
  }
}

module.exports = { analisarSeguranca, createCompatibilityProfile, ordenarFindings }
