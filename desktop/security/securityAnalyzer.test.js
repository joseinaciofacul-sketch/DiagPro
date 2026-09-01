const test = require('node:test')
const assert = require('node:assert/strict')
const { analisarSeguranca } = require('./securityAnalyzer')

const NOW = new Date('2026-08-31T12:00:00Z')

function app({
  packageName = 'com.example.app', type = 'user', requested = [], granted = [],
  accessibility = false, overlay, packageInstall, installer = 'com.android.vending',
  hashStatus = 'not_verified', hash = null,
} = {}) {
  const specialCapabilities = {}
  if (overlay !== undefined) specialCapabilities.overlay = {
    status: 'available', effective: overlay, mode: overlay ? 'allow' : 'ignore', source: 'adb_appops',
  }
  if (packageInstall !== undefined) specialCapabilities.installUnknownApps = {
    status: 'available', effective: packageInstall, mode: packageInstall ? 'allow' : 'ignore', source: 'adb_appops',
  }
  return {
    packageName,
    type,
    securityDetails: {
      available: true,
      requestedPermissions: requested,
      grantedPermissions: granted,
      specialCapabilities,
      accessibilityServiceEnabled: accessibility,
      installerPackageName: installer,
      initiatingPackageName: installer === 'adb' ? 'com.android.shell' : null,
      integrity: {
        hash: { algorithm: 'SHA-256', status: hashStatus, hash, reason: hash ? null : 'HASH_DEFERRED' },
        signature: { status: 'not_verified', reason: 'CERTIFICATE_DIGEST_UNAVAILABLE_VIA_ADB' },
      },
    },
  }
}

function analyzeApp(input, security = {}) {
  return analisarSeguranca({ security, permissions: { items: [app(input)] } }, { now: NOW })
}

test('patch recente gera observation e nenhum finding', () => {
  const result = analisarSeguranca({ security: { securityPatch: '2026-07-01' } }, { now: NOW })
  assert.equal(result.schemaVersion, '1.0')
  assert.equal(result.observations.length, 1)
  assert.equal(result.findings.length, 0)
})

test('patch com mais de dois anos gera finding de configuração high', () => {
  const result = analisarSeguranca({ security: { securityPatch: '2023-01-01' } }, { now: NOW })
  assert.equal(result.findings[0].ruleId, 'device.security_patch_age.high')
  assert.equal(result.findings[0].severity, 'high')
  assert.equal(result.findings[0].category, 'outdated_security_patch')
  assert.deepEqual(result.confirmedThreats, [])
})

test('build depurável e test-keys são configuração, não malware', () => {
  const result = analisarSeguranca({ security: { debuggableBuild: true, buildTags: 'release-keys,test-keys' } }, { now: NOW })
  assert.deepEqual(result.findings.map((finding) => finding.ruleId).sort(), [
    'device.debuggable_build', 'device.test_keys_build',
  ])
  assert.ok(result.findings.every((finding) => finding.category === 'modified_environment'))
  assert.deepEqual(result.confirmedThreats, [])
})

test('su acessível gera finding de ambiente modificado sem ameaça confirmada', () => {
  const result = analisarSeguranca({ security: { root: { status: 'detected', evidence: { path: '/system/xbin/su' } } } }, { now: NOW })
  assert.equal(result.findings[0].ruleId, 'device.su_binary_accessible')
  assert.equal(result.findings[0].evidenceConfidence, 'medium')
  assert.deepEqual(result.confirmedThreats, [])
})

for (const [label, permission] of [
  ['CAMERA', 'android.permission.CAMERA'],
  ['RECORD_AUDIO', 'android.permission.RECORD_AUDIO'],
  ['LOCATION', 'android.permission.ACCESS_FINE_LOCATION'],
]) {
  test(`${label} isolada permanece observation`, () => {
    const result = analyzeApp({ requested: [permission], granted: [permission] })
    assert.ok(result.observations.some((observation) => observation.value?.signal === permission))
    assert.equal(result.findings.length, 0)
  })
}

test('origem desconhecida isolada permanece observation', () => {
  const result = analyzeApp({ installer: null })
  assert.equal(result.appRiskProfiles[0].origin.type, 'unknown')
  assert.equal(result.findings.length, 0)
})

test('sideload via ADB isolado permanece observation', () => {
  const result = analyzeApp({ installer: 'adb' })
  assert.equal(result.appRiskProfiles[0].origin.type, 'adb')
  assert.equal(result.findings.length, 0)
})

test('packageName isolado nunca gera finding', () => {
  const result = analyzeApp({ packageName: 'com.spy.hack.update' })
  assert.equal(result.findings.length, 0)
  assert.deepEqual(result.confirmedThreats, [])
})

test('overlay solicitado sem AppOps permitido não é efetivo', () => {
  const permission = 'android.permission.SYSTEM_ALERT_WINDOW'
  const result = analyzeApp({ requested: [permission], granted: [permission], overlay: false })
  const observation = result.observations.find((item) => item.value?.capability === 'OVERLAY')
  assert.equal(observation.status, 'requested')
  assert.equal(result.findings.length, 0)
})

test('overlay efetivo isolado permanece observation', () => {
  const result = analyzeApp({ requested: ['android.permission.SYSTEM_ALERT_WINDOW'], overlay: true })
  assert.ok(result.observations.some((item) => item.value?.capability === 'OVERLAY' && item.status === 'effective'))
  assert.equal(result.findings.length, 0)
})

test('accessibility isolada permanece observation', () => {
  const result = analyzeApp({ accessibility: true })
  assert.ok(result.observations.some((item) => item.value?.capability === 'ACCESSIBILITY'))
  assert.equal(result.findings.length, 0)
})

test('overlay efetivo com accessibility gera finding contextual', () => {
  const result = analyzeApp({
    accessibility: true, overlay: true,
    requested: ['android.permission.SYSTEM_ALERT_WINDOW'],
  })
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].ruleId, 'app.accessibility_overlay')
  assert.equal(result.findings[0].severity, 'medium')
  assert.equal(result.findings[0].evidenceConfidence, 'high')
})

test('overlay, accessibility e sideload elevam finding sem confirmar ameaça', () => {
  const result = analyzeApp({
    accessibility: true, overlay: true, installer: 'adb',
    requested: ['android.permission.SYSTEM_ALERT_WINDOW'],
  })
  assert.equal(result.findings.filter((finding) => finding.ruleId.includes('accessibility_overlay')).length, 1)
  assert.equal(result.findings[0].ruleId, 'app.accessibility_overlay.adb_origin')
  assert.equal(result.findings[0].severity, 'high')
  assert.notEqual(result.findings[0].severity, 'critical')
  assert.deepEqual(result.confirmedThreats, [])
})

test('app de sistema com múltiplas permissões não recebe finding agressivo', () => {
  const result = analyzeApp({
    type: 'system', accessibility: true, overlay: true, packageInstall: true,
    requested: ['android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.REQUEST_INSTALL_PACKAGES'],
  })
  assert.equal(result.findings.length, 0)
  assert.ok(result.observations.length > 0)
})

test('hash desconhecido não gera finding', () => {
  const result = analyzeApp({ hashStatus: 'not_verified' })
  assert.equal(result.findings.length, 0)
  assert.ok(result.observations.some((observation) => observation.category === 'app_integrity'))
})

test('dados insuficientes não inventam finding', () => {
  const result = analisarSeguranca({}, { now: NOW })
  assert.deepEqual(result.findings, [])
  assert.deepEqual(result.confirmedThreats, [])
  assert.equal(result.reputation.status, 'not_configured')
})

test('perfil compatível aguarda coverage antes do cálculo da ETAPA 4', () => {
  const result = analyzeApp({ requested: ['android.permission.CAMERA'], granted: ['android.permission.CAMERA'] })
  assert.equal(result.appRiskProfiles[0].risk.status, 'pending_coverage')
  assert.equal(result.appRiskProfiles[0].risk.score, null)
  assert.equal(result.appRiskProfiles[0].risk.reason, 'SECURITY_RISK_SCORE_REQUIRES_SCAN_COVERAGE')
})
