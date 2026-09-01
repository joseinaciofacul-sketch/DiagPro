const test = require('node:test')
const assert = require('node:assert/strict')
const { analisarSeguranca } = require('./securityAnalyzer')
const { scoreSecurityRisk } = require('./riskScorer')

const FULL_COVERAGE = { status: 'sufficient', coveragePercent: 100, checks: {}, missingEssential: [] }

function legitimateApp({ packageName, permissions = [], accessibility = false, overlay, packageInstall } = {}) {
  const specialCapabilities = {}
  if (overlay !== undefined) specialCapabilities.overlay = {
    status: 'available', effective: overlay, mode: overlay ? 'allow' : 'ignore', source: 'adb_appops',
  }
  if (packageInstall !== undefined) specialCapabilities.installUnknownApps = {
    status: 'available', effective: packageInstall, mode: packageInstall ? 'allow' : 'ignore', source: 'adb_appops',
  }
  return {
    packageName,
    type: 'user',
    securityDetails: {
      available: true,
      currentUserId: 0,
      requestedPermissions: permissions,
      grantedPermissions: permissions.filter((permission) => ![
        'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.REQUEST_INSTALL_PACKAGES',
      ].includes(permission)),
      accessibilityServiceEnabled: accessibility,
      installerPackageName: 'com.android.vending',
      specialCapabilities,
      integrity: { hash: { status: 'not_verified' }, signature: { status: 'not_verified' } },
    },
  }
}

const legitimateCases = [
  ['mensageiro', legitimateApp({
    packageName: 'com.example.messenger',
    permissions: [
      'android.permission.CAMERA', 'android.permission.RECORD_AUDIO',
      'android.permission.READ_CONTACTS', 'android.permission.POST_NOTIFICATIONS',
    ],
  }), {}],
  ['mapas', legitimateApp({
    packageName: 'com.example.maps',
    permissions: ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.INTERNET'],
  }), {}],
  ['acessibilidade legítima', legitimateApp({
    packageName: 'com.example.accessibility', accessibility: true,
  }), {}],
  ['app corporativo com Device Admin', legitimateApp({
    packageName: 'com.example.enterprise',
  }), {
    deviceAdmins: { status: 'available', value: [{ userId: 0, packageName: 'com.example.enterprise', componentName: 'com.example.enterprise/.Admin' }] },
  }],
  ['launcher com overlay', legitimateApp({
    packageName: 'com.example.launcher', overlay: true,
    permissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
  }), {}],
  ['loja alternativa com instalação de pacotes', legitimateApp({
    packageName: 'com.example.store', packageInstall: true,
    permissions: ['android.permission.REQUEST_INSTALL_PACKAGES'],
  }), {}],
]

for (const [label, app, security] of legitimateCases) {
  test(`falso positivo: ${label} não é classificado como malware`, () => {
    const result = analisarSeguranca({ security, permissions: { items: [app] } })
    assert.equal(result.findings.length, 0)
    assert.deepEqual(result.confirmedThreats, [])
    assert.ok(result.observations.some((observation) => observation.subjectId === app.packageName))
    const securityRisk = scoreSecurityRisk({
      findings: result.findings,
      coverage: FULL_COVERAGE,
      scanStatus: 'completed',
      confirmedThreats: result.confirmedThreats,
    })
    assert.equal(securityRisk.score, 0)
    assert.equal(securityRisk.level, 'low')
  })
}
