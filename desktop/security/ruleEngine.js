const { createFinding } = require('./analysisModels')
const { DECLARATIVE_RULES } = require('./declarativeRules')

const SEVERITY_PRIORITY = Object.freeze({ info: 0, low: 1, medium: 2, high: 3, critical: 4 })
const EVIDENCE_PRIORITY = Object.freeze({ low: 0, medium: 1, high: 2 })

function getFact(facts, path) {
  return String(path).split('.').reduce((value, key) => value?.[key], facts)
}

function evaluateCondition(condition, facts) {
  const actual = getFact(facts, condition.fact)
  if (condition.operator === 'equals') return actual === condition.value
  if (condition.operator === 'not_equals') return actual !== condition.value
  if (condition.operator === 'in') return Array.isArray(condition.value) && condition.value.includes(actual)
  if (condition.operator === 'gt') return Number.isFinite(actual) && actual > condition.value
  if (condition.operator === 'gte') return Number.isFinite(actual) && actual >= condition.value
  if (condition.operator === 'lt') return Number.isFinite(actual) && actual < condition.value
  if (condition.operator === 'lte') return Number.isFinite(actual) && actual <= condition.value
  if (condition.operator === 'exists') return condition.value ? actual !== null && actual !== undefined : actual === null || actual === undefined
  return false
}

function ruleMatches(rule, context) {
  return Array.isArray(rule.conditions)
    && rule.conditions.length > 0
    && rule.conditions.every((condition) => evaluateCondition(condition, context.facts))
}

function collectRuleEvidence(rule, context) {
  const facts = Array.isArray(rule.evidenceFacts) ? rule.evidenceFacts : rule.conditions.map((condition) => condition.fact)
  const uniqueFacts = [...new Set(facts)]
  return uniqueFacts.map((fact) => context.evidenceByFact[fact] || {
    key: fact,
    value: getFact(context.facts, fact) ?? null,
    source: 'normalized_analysis',
    quality: rule.evidenceConfidence || 'medium',
  })
}

function compareFindings(a, b) {
  const severity = (SEVERITY_PRIORITY[b.severity] || 0) - (SEVERITY_PRIORITY[a.severity] || 0)
  if (severity !== 0) return severity
  const confidence = (EVIDENCE_PRIORITY[b.evidenceConfidence] || 0) - (EVIDENCE_PRIORITY[a.evidenceConfidence] || 0)
  if (confidence !== 0) return confidence
  return a.ruleId.localeCompare(b.ruleId)
}

function deduplicateFindings(candidates = []) {
  const byId = new Map()
  candidates.forEach(({ finding, rule }) => {
    const dedupeKey = `${finding.subjectType}:${finding.subjectId}:${rule.dedupeGroup || rule.id}`
    const current = byId.get(dedupeKey)
    if (!current || compareFindings(finding, current.finding) < 0) byId.set(dedupeKey, { finding, rule })
  })
  return [...byId.values()].map(({ finding }) => finding).sort(compareFindings)
}

function evaluateRules({ deviceContext = null, appContexts = [] } = {}, {
  rules = DECLARATIVE_RULES,
  now = new Date(),
} = {}) {
  const candidates = []
  const contexts = [deviceContext, ...appContexts].filter(Boolean)
  contexts.forEach((context) => {
    rules.filter((rule) => rule.id.startsWith(`${context.subjectType}.`)).forEach((rule) => {
      if (!ruleMatches(rule, context)) return
      const finding = createFinding(rule, context, collectRuleEvidence(rule, context), now)
      if (context.subjectType === 'app') {
        finding.identity = context.metadata.identity
        finding.origin = context.metadata.origin
        finding.integrity = context.metadata.integrity
        finding.capabilities = context.metadata.capabilities
      }
      candidates.push({ finding, rule })
    })
  })
  return deduplicateFindings(candidates)
}

module.exports = {
  EVIDENCE_PRIORITY,
  SEVERITY_PRIORITY,
  collectRuleEvidence,
  compareFindings,
  deduplicateFindings,
  evaluateCondition,
  evaluateRules,
  getFact,
  ruleMatches,
}
