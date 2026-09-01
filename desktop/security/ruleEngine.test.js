const test = require('node:test')
const assert = require('node:assert/strict')
const { createFinding } = require('./analysisModels')
const { createReputationProvider } = require('./reputationProvider')
const { analisarSeguranca } = require('./securityAnalyzer')
const { planejarRemediacaoFinding } = require('../remediation/remediationPlanner')

const NOW = new Date('2026-08-31T12:00:00Z')

function contextualApp({
  packageName = 'com.example.contextual', installer = 'com.android.vending',
  permissions = [], accessibility = false, overlay = false, packageInstall = false,
} = {}) {
  return {
    packageName,
    type: 'user',
    securityDetails: {
      available: true,
      currentUserId: 10,
      requestedPermissions: permissions,
      grantedPermissions: permissions.filter((permission) => ![
        'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.REQUEST_INSTALL_PACKAGES',
      ].includes(permission)),
      accessibilityServiceEnabled: accessibility,
      installerPackageName: installer === 'adb' ? null : installer,
      initiatingPackageName: installer === 'adb' ? 'com.android.shell' : null,
      specialCapabilities: {
        overlay: { status: 'available', effective: overlay, mode: overlay ? 'allow' : 'ignore', source: 'adb_appops' },
        installUnknownApps: { status: 'available', effective: packageInstall, mode: packageInstall ? 'allow' : 'ignore', source: 'adb_appops' },
      },
      integrity: { hash: { status: 'not_verified' }, signature: { status: 'not_verified' } },
    },
  }
}

function analyzeApp(app, security = {}) {
  return analisarSeguranca({ security, permissions: { items: [app] } }, { now: NOW })
}

test('REQUEST_INSTALL_PACKAGES efetivo com origem ADB gera finding contextual', () => {
  const result = analyzeApp(contextualApp({
    installer: 'adb', packageInstall: true,
    permissions: ['android.permission.REQUEST_INSTALL_PACKAGES'],
  }))
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].ruleId, 'app.package_install.adb_origin')
  assert.equal(result.findings[0].severity, 'medium')
})

test('SMS, contatos e boot concedidos geram finding contextual médio', () => {
  const result = analyzeApp(contextualApp({ permissions: [
    'android.permission.READ_SMS',
    'android.permission.READ_CONTACTS',
    'android.permission.RECEIVE_BOOT_COMPLETED',
  ] }))
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].ruleId, 'app.sms_contacts_boot')
  assert.equal(result.findings[0].evidenceConfidence, 'medium')
})

test('Device Admin isolado permanece observation', () => {
  const app = contextualApp()
  const security = {
    deviceAdmins: { status: 'available', value: [{ userId: 10, packageName: app.packageName, componentName: `${app.packageName}/.Admin` }] },
  }
  const result = analyzeApp(app, security)
  assert.ok(result.observations.some((observation) => observation.category === 'device_administrator'))
  assert.equal(result.findings.length, 0)
})

test('Device Admin continua observation quando detalhes do pacote não estão disponíveis', () => {
  const result = analisarSeguranca({
    security: {
      deviceAdmins: { status: 'available', value: [{ userId: 0, packageName: 'com.example.unlinked', componentName: 'com.example.unlinked/.Admin' }] },
    },
  }, { now: NOW })
  assert.ok(result.observations.some((observation) => observation.subjectId === 'com.example.unlinked'))
  assert.equal(result.findings.length, 0)
})

test('Device Admin com contexto adicional gera finding e apenas orientação manual', () => {
  const app = contextualApp({
    installer: 'adb', accessibility: true,
  })
  const security = {
    deviceAdmins: { status: 'available', value: [{ userId: 10, packageName: app.packageName, componentName: `${app.packageName}/.Admin` }] },
  }
  const result = analyzeApp(app, security)
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].ruleId, 'app.device_admin.untrusted_context')
  assert.deepEqual(result.findings[0].remediation, { available: false, type: 'manual_guidance' })
  assert.equal(planejarRemediacaoFinding(result.findings[0], [app]).type, 'manual_device_admin_review')
})

test('deduplicação mantém somente a regra mais específica para overlay e accessibility', () => {
  const result = analyzeApp(contextualApp({
    installer: 'adb', accessibility: true, overlay: true,
    permissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
  }))
  const correlated = result.findings.filter((finding) => finding.ruleId.includes('accessibility_overlay'))
  assert.equal(correlated.length, 1)
  assert.equal(correlated[0].ruleId, 'app.accessibility_overlay.adb_origin')
  assert.equal(planejarRemediacaoFinding(correlated[0], [contextualApp({ packageName: correlated[0].packageName })]).type, 'manual_accessibility_review')
})

test('evidence registra exatamente fatos, fonte e observation de origem', () => {
  const result = analyzeApp(contextualApp({
    accessibility: true, overlay: true,
    permissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
  }))
  const finding = result.findings[0]
  assert.ok(finding.evidence.some((item) => item.key === 'special_capability' && item.source === 'adb_appops'))
  assert.ok(finding.evidence.some((item) => item.observationId?.includes('accessibility')))
  assert.ok(finding.evidence.every((item) => Object.hasOwn(item, 'value')))
})

test('factory limita critical heurístico a high', () => {
  const finding = createFinding({
    id: 'app.synthetic', category: 'test', title: 'Synthetic', summary: 'Synthetic',
    severity: 'critical', evidenceConfidence: 'high', conditions: [],
  }, { subjectType: 'app', subjectId: 'com.example.synthetic' }, [], NOW)
  assert.equal(finding.severity, 'high')
})

test('reputation provider não configurado não consulta rede nem gera veredito', async () => {
  const provider = createReputationProvider()
  assert.deepEqual(await provider.lookupHash('a'.repeat(64)), {
    status: 'not_configured', verdict: 'unknown', evidence: [],
  })
})

test('confirmedThreats permanece vazio usando somente heurísticas locais', () => {
  const result = analyzeApp(contextualApp({
    installer: 'adb', accessibility: true, overlay: true, packageInstall: true,
    permissions: ['android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.REQUEST_INSTALL_PACKAGES'],
  }))
  assert.ok(result.findings.length > 0)
  assert.deepEqual(result.confirmedThreats, [])
  assert.deepEqual(result.threats, [])
})
