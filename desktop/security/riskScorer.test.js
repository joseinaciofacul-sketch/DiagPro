const test = require('node:test')
const assert = require('node:assert/strict')
const {
  CATEGORY_CAPS,
  EVIDENCE_CONFIDENCE_MULTIPLIERS,
  SECURITY_RISK_SCORE_VERSION,
  SEVERITY_WEIGHTS,
} = require('./riskScoreConfig')
const { applyRiskToAppProfiles, scoreSecurityRisk } = require('./riskScorer')

const FULL_COVERAGE = Object.freeze({ status: 'sufficient', coveragePercent: 100, checks: {}, missingEssential: [] })
const LIMITED_COVERAGE = Object.freeze({ status: 'limited', coveragePercent: 70, checks: {}, missingEssential: ['appOps'] })
const INSUFFICIENT_COVERAGE = Object.freeze({ status: 'insufficient', coveragePercent: 35, checks: {}, missingEssential: ['packages'] })

function finding({
  id = 'finding-1', ruleId = 'app.synthetic', subjectType = 'app', subjectId = 'com.example.one',
  category = 'default', severity = 'medium', evidenceConfidence = 'high',
} = {}) {
  return { id, ruleId, subjectType, subjectId, packageName: subjectType === 'app' ? subjectId : null, category, severity, evidenceConfidence }
}

function score(findings, options = {}) {
  return scoreSecurityRisk({
    findings,
    coverage: options.coverage || FULL_COVERAGE,
    scanStatus: options.scanStatus || 'completed',
    confirmedThreats: options.confirmedThreats || [],
  })
}

test('configuração central expõe pesos e multiplicadores documentados', () => {
  assert.deepEqual(SEVERITY_WEIGHTS, { info: 2, low: 8, medium: 40, high: 55, critical: 70 })
  assert.deepEqual(EVIDENCE_CONFIDENCE_MULTIPLIERS, { low: 0.5, medium: 0.75, high: 1 })
  assert.equal(SECURITY_RISK_SCORE_VERSION, '1.0')
})

test('nenhum finding com scan completo resulta em 0 e baixo risco observado', () => {
  const result = score([])
  assert.equal(result.status, 'calculated')
  assert.equal(result.score, 0)
  assert.equal(result.level, 'low')
  assert.match(result.explanation, /não certifica ausência/i)
})

test('evidenceConfidence multiplica confiança da evidência, não probabilidade de malware', () => {
  const high = score([finding({ evidenceConfidence: 'high' })])
  const medium = score([finding({ evidenceConfidence: 'medium' })])
  const low = score([finding({ evidenceConfidence: 'low' })])
  assert.equal(high.score, 40)
  assert.equal(medium.score, 30)
  assert.equal(low.score, 20)
  assert.match(high.meaning, /não representa probabilidade de malware/i)
})

test('patch de 200 dias permanece baixo pelo peso low', () => {
  const result = score([finding({
    ruleId: 'device.security_patch_age.low', subjectType: 'device', subjectId: 'current_device',
    category: 'outdated_security_patch', severity: 'low',
  })])
  assert.equal(result.score, 8)
  assert.equal(result.level, 'low')
})

test('patch acima de 730 dias é limitado pelo category cap', () => {
  const result = score([finding({
    ruleId: 'device.security_patch_age.high', subjectType: 'device', subjectId: 'current_device',
    category: 'outdated_security_patch', severity: 'high',
  })])
  assert.equal(result.score, CATEGORY_CAPS.outdated_security_patch)
  assert.equal(result.level, 'low')
})

test('test-keys isolado possui contribuição baixa', () => {
  const result = score([finding({
    ruleId: 'device.test_keys_build', subjectType: 'device', subjectId: 'current_device',
    category: 'modified_environment', severity: 'low',
  })])
  assert.equal(result.score, 8)
})

test('su isolado é relevante sem produzir risco extremo', () => {
  const result = score([finding({
    ruleId: 'device.su_binary_accessible', subjectType: 'device', subjectId: 'current_device',
    category: 'modified_environment', severity: 'high', evidenceConfidence: 'medium',
  })])
  assert.equal(result.score, CATEGORY_CAPS.modified_environment)
  assert.equal(result.level, 'attention')
})

test('accessibility com overlay gera risco moderado', () => {
  const result = score([finding({ category: 'sensitive_capability_combination', severity: 'medium' })])
  assert.equal(result.score, 40)
  assert.equal(result.level, 'moderate')
})

test('accessibility, overlay e sideload pontuam mais que combinação base', () => {
  const base = score([finding({ category: 'sensitive_capability_combination', severity: 'medium' })])
  const contextual = score([finding({ category: 'sensitive_capability_combination', severity: 'high' })])
  assert.ok(contextual.score > base.score)
  assert.equal(contextual.score, 55)
})

test('dois apps relevantes pontuam mais que um com diminishing returns', () => {
  const one = score([finding({ category: 'sensitive_capability_combination' })])
  const two = score([
    finding({ id: 'one', subjectId: 'com.example.one', category: 'sensitive_capability_combination' }),
    finding({ id: 'two', subjectId: 'com.example.two', category: 'sensitive_capability_combination' }),
  ])
  assert.ok(two.score > one.score)
  assert.equal(two.score, 64)
  assert.equal(two.factors[1].categoryDiminishingMultiplier, 0.6)
})

test('dez findings iguais em apps diferentes respeitam cap e não chegam a 100', () => {
  const findings = Array.from({ length: 10 }, (_, index) => finding({
    id: `finding-${index}`, subjectId: `com.example.app${index}`,
    category: 'sensitive_capability_combination', severity: 'high',
  }))
  const result = score(findings)
  assert.equal(result.score, CATEGORY_CAPS.sensitive_capability_combination)
  assert.ok(result.score < 100)
})

test('finding duplicado para a mesma regra e sujeito pontua uma vez', () => {
  const original = finding({ category: 'sensitive_capability_combination' })
  assert.equal(score([original, { ...original, id: 'duplicate' }]).score, score([original]).score)
})

test('múltiplas categorias independentes podem elevar significativamente o risco', () => {
  const result = score([
    finding({ id: 'app', category: 'sensitive_capability_combination', severity: 'high' }),
    finding({ id: 'root', ruleId: 'device.su_binary_accessible', subjectType: 'device', subjectId: 'current_device', category: 'modified_environment', severity: 'high', evidenceConfidence: 'medium' }),
    finding({ id: 'settings', ruleId: 'device.package_verifier_disabled', subjectType: 'device', subjectId: 'current_device', category: 'security_configuration', severity: 'medium' }),
  ])
  assert.ok(result.score >= 80)
  assert.ok(result.breakdown.deviceRisk > 0)
  assert.ok(result.breakdown.appRisk > 0)
})

test('scan parcial com cobertura suficiente retorna score parcial', () => {
  const result = score([finding()], { coverage: LIMITED_COVERAGE, scanStatus: 'partial' })
  assert.equal(result.status, 'partial')
  assert.equal(result.score, 40)
})

test('cobertura insuficiente não apresenta precisão numérica falsa', () => {
  const result = score([finding()], { coverage: INSUFFICIENT_COVERAGE })
  assert.equal(result.status, 'insufficient_data')
  assert.equal(result.score, null)
  assert.equal(result.breakdown.total, null)
})

for (const scanStatus of ['canceled', 'device_disconnected', 'failed']) {
  test(`${scanStatus} nunca retorna score numérico`, () => {
    const result = score([finding()], { scanStatus })
    assert.equal(result.status, 'not_calculated')
    assert.equal(result.score, null)
  })
}

test('mesmo input é determinístico independentemente da ordem dos findings', () => {
  const findings = [
    finding({ id: 'b', ruleId: 'rule-b', subjectId: 'com.example.b', category: 'sensitive_capability_combination', severity: 'high' }),
    finding({ id: 'a', ruleId: 'rule-a', subjectType: 'device', subjectId: 'current_device', category: 'modified_environment', severity: 'medium' }),
  ]
  const first = score(findings)
  const second = score([...findings].reverse())
  assert.deepEqual(first, second)
})

test('critical futuro tem peso forte, mas isolado não chega a 100', () => {
  const result = score([finding({ severity: 'critical', category: 'default' })])
  assert.equal(result.score, CATEGORY_CAPS.default)
  assert.ok(result.score < 100)
})

test('confirmed threat futuro adiciona fator forte sem criar ameaça artificial', () => {
  const withoutThreat = score([])
  const withThreat = score([], { confirmedThreats: [{ id: 'future-confirmed', status: 'confirmed' }] })
  assert.equal(withoutThreat.score, 0)
  assert.equal(withThreat.score, 70)
  assert.equal(withThreat.breakdown.confirmedThreatRisk, 70)
  assert.equal(withThreat.factors[0].sourceKind, 'confirmed_threat')
})

test('confirmedThreats vazio não adiciona bônus', () => {
  assert.equal(score([finding()], { confirmedThreats: [] }).score, score([finding()]).score)
})

test('appRiskProfiles recebe contribuição real derivada somente de findings', () => {
  const result = score([finding({ category: 'sensitive_capability_combination' })])
  const [profile] = applyRiskToAppProfiles([{
    packageName: 'com.example.one', evidenceConfidence: 'high', risk: { status: 'pending_coverage' },
  }], result)
  assert.equal(profile.risk.status, 'calculated')
  assert.equal(profile.risk.score, 40)
  assert.equal(profile.risk.version, SECURITY_RISK_SCORE_VERSION)
  assert.equal(profile.risk.factors.length, 1)
})
