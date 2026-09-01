const SEVERITIES = Object.freeze(['info', 'low', 'medium', 'high', 'critical'])
const EVIDENCE_CONFIDENCE = Object.freeze(['low', 'medium', 'high'])

function isoDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeEvidence(evidence = []) {
  const items = Array.isArray(evidence) ? evidence : [evidence]
  return items.filter((item) => item && typeof item === 'object').map((item) => ({
    key: item.key || 'evidence',
    value: item.value ?? null,
    source: item.source || 'normalized_analysis',
    quality: EVIDENCE_CONFIDENCE.includes(item.quality) ? item.quality : 'medium',
    ...(item.observationId ? { observationId: item.observationId } : {}),
  }))
}

function createObservation({
  id,
  category,
  subjectType,
  subjectId,
  source,
  status = 'observed',
  value,
  evidence = [],
  evidenceConfidence = 'medium',
  collectedAt = new Date(),
}) {
  return {
    id,
    category,
    subject: { type: subjectType, id: subjectId },
    subjectType,
    subjectId,
    source,
    status,
    value: value ?? null,
    evidence: normalizeEvidence(evidence),
    evidenceConfidence: EVIDENCE_CONFIDENCE.includes(evidenceConfidence) ? evidenceConfidence : 'medium',
    collectedAt: isoDate(collectedAt),
  }
}

function createFinding(rule, context, evidence, createdAt = new Date()) {
  const requestedSeverity = SEVERITIES.includes(rule.severity) ? rule.severity : 'info'
  const severity = requestedSeverity === 'critical' && rule.allowCritical !== true ? 'high' : requestedSeverity
  const evidenceConfidence = EVIDENCE_CONFIDENCE.includes(rule.evidenceConfidence)
    ? rule.evidenceConfidence
    : 'medium'
  const subjectType = context.subjectType
  const subjectId = context.subjectId
  const summary = typeof rule.summary === 'function' ? rule.summary(context) : rule.summary
  const technicalExplanation = typeof rule.technicalExplanation === 'function'
    ? rule.technicalExplanation(context)
    : rule.technicalExplanation || rule.description
  const recommendation = typeof rule.recommendation === 'function'
    ? rule.recommendation(context)
    : rule.recommendation
  const remediation = typeof rule.remediation === 'function'
    ? rule.remediation(context)
    : rule.remediation

  return {
    id: `${rule.id}:${subjectId}`,
    ruleId: rule.id,
    category: rule.category,
    subjectType,
    subjectId,
    title: rule.title,
    summary,
    // Alias de leitura para relatórios antigos; a fonte semântica é summary.
    description: summary,
    technicalExplanation,
    severity,
    evidenceConfidence,
    evidence: normalizeEvidence(evidence),
    recommendation,
    remediation: remediation || { available: false, type: 'none' },
    status: 'open',
    createdAt: isoDate(createdAt),
    source: 'declarative_rule_engine',
    ...(subjectType === 'app' ? { packageName: subjectId } : { packageName: null }),
  }
}

function createConfirmedThreat({ id, title, evidence = [], sources = [], createdAt = new Date() } = {}) {
  const independentSources = [...new Set(sources.filter(Boolean))]
  if (!id || !title || independentSources.length < 2 || normalizeEvidence(evidence).length === 0) return null
  return {
    id,
    title,
    status: 'confirmed',
    evidence: normalizeEvidence(evidence),
    independentSources,
    createdAt: isoDate(createdAt),
  }
}

module.exports = {
  EVIDENCE_CONFIDENCE,
  SEVERITIES,
  createConfirmedThreat,
  createFinding,
  createObservation,
  isoDate,
  normalizeEvidence,
}
