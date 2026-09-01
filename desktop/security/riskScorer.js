const {
  CATEGORY_CAPS,
  CATEGORY_DIMINISHING_RETURNS,
  CATEGORY_REMAINDER_MULTIPLIER,
  CONFIRMED_THREAT_DIMINISHING_RETURNS,
  CONFIRMED_THREAT_REMAINDER_MULTIPLIER,
  CONFIRMED_THREAT_WEIGHT,
  EVIDENCE_CONFIDENCE_MULTIPLIERS,
  GLOBAL_CATEGORY_DIMINISHING_RETURNS,
  GLOBAL_CATEGORY_REMAINDER_MULTIPLIER,
  MINIMUM_NUMERIC_COVERAGE_PERCENT,
  SECURITY_RISK_SCORE_VERSION,
  SECURITY_RISK_THRESHOLDS,
  SEVERITY_WEIGHTS,
} = require('./riskScoreConfig')

const TERMINAL_SCAN_STATUSES = new Set(['canceled', 'device_disconnected', 'failed', 'running'])

function round(value, precision = 2) {
  const factor = 10 ** precision
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function multiplierAt(sequence, index, remainder) {
  return sequence[index] ?? remainder
}

function deriveRiskLevel(score) {
  if (!Number.isFinite(score)) return { level: null, label: 'Não calculado' }
  const threshold = SECURITY_RISK_THRESHOLDS.find((item) => score >= item.min)
  return { level: threshold.level, label: threshold.label }
}

function findingStrength(finding) {
  const severity = SEVERITY_WEIGHTS[finding.severity] ?? 0
  const confidence = EVIDENCE_CONFIDENCE_MULTIPLIERS[finding.evidenceConfidence] ?? 0.5
  return severity * confidence
}

function normalizeFinding(finding, index) {
  if (!finding || typeof finding !== 'object') return null
  const subjectType = finding.subjectType || (finding.packageName ? 'app' : 'device')
  const subjectId = finding.subjectId || finding.packageName || 'current_device'
  const ruleId = finding.ruleId || finding.id || `legacy.finding.${index}`
  const evidenceConfidence = finding.evidenceConfidence || finding.confidence || finding.risk?.confidence || 'low'
  const severity = Object.hasOwn(SEVERITY_WEIGHTS, finding.severity) ? finding.severity : 'info'
  return {
    findingId: finding.id || `${ruleId}:${subjectId}`,
    ruleId,
    subjectType,
    subjectId,
    category: finding.category || 'default',
    severity,
    evidenceConfidence: Object.hasOwn(EVIDENCE_CONFIDENCE_MULTIPLIERS, evidenceConfidence)
      ? evidenceConfidence
      : 'low',
    sourceKind: 'finding',
  }
}

function normalizeConfirmedThreat(threat, index) {
  if (!threat || typeof threat !== 'object') return null
  const id = threat.id || `confirmed-threat-${index}`
  return {
    findingId: id,
    ruleId: threat.ruleId || `confirmed_threat.${id}`,
    subjectType: threat.subjectType || 'device',
    subjectId: threat.subjectId || 'current_device',
    category: 'confirmed_threat',
    severity: 'critical',
    evidenceConfidence: 'high',
    sourceKind: 'confirmed_threat',
  }
}

function deduplicateScoreInputs(findings = []) {
  const unique = new Map()
  findings.forEach((finding) => {
    const key = `${finding.ruleId}|${finding.subjectType}|${finding.subjectId}`
    const current = unique.get(key)
    if (!current || findingStrength(finding) > findingStrength(current)
      || (findingStrength(finding) === findingStrength(current) && finding.findingId < current.findingId)) {
      unique.set(key, finding)
    }
  })
  return [...unique.values()].sort((a, b) => {
    const strength = findingStrength(b) - findingStrength(a)
    if (strength !== 0) return strength
    return `${a.category}|${a.ruleId}|${a.subjectId}`.localeCompare(`${b.category}|${b.ruleId}|${b.subjectId}`)
  })
}

function buildCategoryContributions(inputs) {
  const groups = new Map()
  inputs.forEach((input) => {
    if (!groups.has(input.category)) groups.set(input.category, [])
    groups.get(input.category).push(input)
  })

  const categories = [...groups.entries()].map(([category, items]) => {
    const sorted = [...items].sort((a, b) => {
      const strength = findingStrength(b) - findingStrength(a)
      if (strength !== 0) return strength
      return `${a.ruleId}|${a.subjectId}`.localeCompare(`${b.ruleId}|${b.subjectId}`)
    })
    const preliminaryFactors = sorted.map((item, index) => {
      const baseWeight = item.sourceKind === 'confirmed_threat'
        ? CONFIRMED_THREAT_WEIGHT
        : SEVERITY_WEIGHTS[item.severity]
      const confidenceMultiplier = EVIDENCE_CONFIDENCE_MULTIPLIERS[item.evidenceConfidence]
      const diminishingMultiplier = item.sourceKind === 'confirmed_threat'
        ? multiplierAt(CONFIRMED_THREAT_DIMINISHING_RETURNS, index, CONFIRMED_THREAT_REMAINDER_MULTIPLIER)
        : multiplierAt(CATEGORY_DIMINISHING_RETURNS, index, CATEGORY_REMAINDER_MULTIPLIER)
      return {
        ...item,
        baseWeight,
        confidenceMultiplier,
        categoryDiminishingMultiplier: diminishingMultiplier,
        preCapContribution: baseWeight * confidenceMultiplier * diminishingMultiplier,
      }
    })
    const rawTotal = preliminaryFactors.reduce((total, factor) => total + factor.preCapContribution, 0)
    const categoryCap = CATEGORY_CAPS[category] ?? CATEGORY_CAPS.default
    const categoryCapScale = rawTotal > categoryCap ? categoryCap / rawTotal : 1
    return {
      category,
      categoryCap,
      rawTotal,
      cappedTotal: Math.min(rawTotal, categoryCap),
      factors: preliminaryFactors.map((factor) => ({ ...factor, categoryCapScale })),
    }
  }).sort((a, b) => {
    const total = b.cappedTotal - a.cappedTotal
    return total !== 0 ? total : a.category.localeCompare(b.category)
  })

  return categories.map((category, index) => ({
    ...category,
    globalCategoryMultiplier: multiplierAt(
      GLOBAL_CATEGORY_DIMINISHING_RETURNS,
      index,
      GLOBAL_CATEGORY_REMAINDER_MULTIPLIER,
    ),
  }))
}

function calculateContributions(findings = [], confirmedThreats = []) {
  const normalizedFindings = findings.map(normalizeFinding).filter(Boolean)
  const normalizedThreats = confirmedThreats.map(normalizeConfirmedThreat).filter(Boolean)
  const inputs = deduplicateScoreInputs([...normalizedFindings, ...normalizedThreats])
  const categories = buildCategoryContributions(inputs)
  const factors = categories.flatMap((category) => category.factors.map((factor) => ({
    findingId: factor.findingId,
    ruleId: factor.ruleId,
    subjectType: factor.subjectType,
    subjectId: factor.subjectId,
    category: factor.category,
    severity: factor.severity,
    evidenceConfidence: factor.evidenceConfidence,
    sourceKind: factor.sourceKind,
    baseWeight: factor.baseWeight,
    confidenceMultiplier: factor.confidenceMultiplier,
    categoryDiminishingMultiplier: factor.categoryDiminishingMultiplier,
    categoryCap: category.categoryCap,
    categoryCapScale: round(factor.categoryCapScale, 4),
    globalCategoryMultiplier: category.globalCategoryMultiplier,
    contribution: round(
      factor.preCapContribution * factor.categoryCapScale * category.globalCategoryMultiplier,
      2,
    ),
  }))).sort((a, b) => {
    const contribution = b.contribution - a.contribution
    if (contribution !== 0) return contribution
    return `${a.ruleId}|${a.subjectId}`.localeCompare(`${b.ruleId}|${b.subjectId}`)
  })

  const categoryBreakdown = categories.map((category) => ({
    category: category.category,
    rawContribution: round(category.rawTotal, 2),
    cappedContribution: round(category.cappedTotal, 2),
    cap: category.categoryCap,
    globalDiminishingMultiplier: category.globalCategoryMultiplier,
    finalContribution: round(category.factors.reduce((total, factor) => (
      total + factor.preCapContribution * factor.categoryCapScale * category.globalCategoryMultiplier
    ), 0), 2),
  }))
  const observedTotal = round(factors.reduce((total, factor) => total + factor.contribution, 0), 2)
  return { categoryBreakdown, factors, observedTotal }
}

function calculationStatus(scanStatus, coverage) {
  if (TERMINAL_SCAN_STATUSES.has(scanStatus)) return 'not_calculated'
  if (!coverage || coverage.coveragePercent < MINIMUM_NUMERIC_COVERAGE_PERCENT || coverage.status === 'insufficient') {
    return 'insufficient_data'
  }
  if (scanStatus === 'partial' || scanStatus === 'inconclusive' || coverage.status === 'limited') return 'partial'
  return scanStatus === 'completed' && coverage.status === 'sufficient' ? 'calculated' : 'not_calculated'
}

function statusExplanation(status, score, findingsCount) {
  if (status === 'not_calculated') return 'O scan não foi concluído em condição adequada para calcular o risco de segurança.'
  if (status === 'insufficient_data') return 'As fontes essenciais disponíveis são insuficientes para apresentar um score numérico confiável.'
  if (status === 'partial') return 'Score parcial baseado somente nos findings válidos coletados; há limitações de cobertura registradas.'
  if (findingsCount === 0 && score === 0) {
    return 'Nenhum risco relevante foi identificado pelas verificações realizadas. Isso não certifica ausência de ameaças.'
  }
  return 'Nível de risco técnico observado com base nos findings e evidências válidas das verificações executadas.'
}

function scoreSecurityRisk({
  findings = [],
  coverage = null,
  scanStatus = 'completed',
  confirmedThreats = [],
} = {}) {
  const contributions = calculateContributions(findings, confirmedThreats)
  const status = calculationStatus(scanStatus, coverage)
  const numeric = ['calculated', 'partial'].includes(status)
  const score = numeric ? Math.min(100, Math.max(0, Math.round(contributions.observedTotal))) : null
  const riskLevel = deriveRiskLevel(score)
  const deviceContribution = round(contributions.factors
    .filter((factor) => factor.subjectType !== 'app' && factor.sourceKind !== 'confirmed_threat')
    .reduce((total, factor) => total + factor.contribution, 0), 2)
  const appContribution = round(contributions.factors
    .filter((factor) => factor.subjectType === 'app' && factor.sourceKind !== 'confirmed_threat')
    .reduce((total, factor) => total + factor.contribution, 0), 2)
  const confirmedThreatContribution = round(contributions.factors
    .filter((factor) => factor.sourceKind === 'confirmed_threat')
    .reduce((total, factor) => total + factor.contribution, 0), 2)

  return {
    status,
    score,
    level: riskLevel.level,
    label: riskLevel.label,
    version: SECURITY_RISK_SCORE_VERSION,
    explanation: statusExplanation(status, score, findings.length),
    meaning: 'Nível de risco técnico observado; não representa probabilidade de malware, infecção ou certificação de segurança.',
    coverage,
    breakdown: {
      deviceRisk: deviceContribution,
      appRisk: appContribution,
      confirmedThreatRisk: confirmedThreatContribution,
      observedContribution: contributions.observedTotal,
      total: score,
      categories: contributions.categoryBreakdown,
    },
    factors: contributions.factors,
  }
}

function applyRiskToAppProfiles(profiles = [], securityRisk = {}) {
  return profiles.map((profile) => {
    const factors = (securityRisk.factors || []).filter((factor) => (
      factor.subjectType === 'app' && factor.subjectId === profile.packageName
    ))
    const numeric = Number.isFinite(securityRisk.score)
    const score = numeric ? Math.min(100, Math.round(factors.reduce((total, factor) => total + factor.contribution, 0))) : null
    const level = deriveRiskLevel(score)
    return {
      ...profile,
      risk: {
        status: numeric ? securityRisk.status : securityRisk.status === 'insufficient_data' ? 'insufficient_data' : 'not_calculated',
        score,
        rawScore: numeric ? round(factors.reduce((total, factor) => total + factor.contribution, 0), 2) : null,
        level: level.level,
        label: level.label,
        confidence: profile.evidenceConfidence,
        evidenceConfidence: profile.evidenceConfidence,
        factors,
        reasons: factors.map((factor) => ({
          id: factor.ruleId,
          points: factor.contribution,
          message: `Contribuição do finding ${factor.ruleId}.`,
          evidence: { findingId: factor.findingId, category: factor.category },
        })),
        version: SECURITY_RISK_SCORE_VERSION,
        explanation: 'Contribuição técnica deste aplicativo ao Security Risk Score do diagnóstico; não é probabilidade de malware.',
      },
    }
  })
}

module.exports = {
  TERMINAL_SCAN_STATUSES,
  applyRiskToAppProfiles,
  buildCategoryContributions,
  calculateContributions,
  calculationStatus,
  deduplicateScoreInputs,
  deriveRiskLevel,
  findingStrength,
  normalizeConfirmedThreat,
  normalizeFinding,
  scoreSecurityRisk,
}
