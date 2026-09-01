const test = require('node:test')
const assert = require('node:assert/strict')
const { buildSecurityCoverage, combinedStatus } = require('./securityCoverage')

function completeResult() {
  return {
    device: { collection: { properties: { status: 'available' } } },
    apps: {
      userTotal: 2,
      collection: {
        status: 'available',
        details: { status: 'available' },
        appOps: {
          operations: {
            SYSTEM_ALERT_WINDOW: { status: 'available' },
            REQUEST_INSTALL_PACKAGES: { status: 'available' },
          },
        },
      },
    },
    security: {
      collection: { properties: { status: 'available' }, packageVerifier: { status: 'available' } },
      developerOptions: {
        adbEnabled: { status: 'available' },
        developmentSettingsEnabled: { status: 'available' },
        verifyAppsOverUsb: { status: 'available' },
      },
      accessibility: { collection: { status: 'available' } },
      deviceAdmins: { status: 'available' },
    },
  }
}

test('coverage completa usa pesos objetivos e soma 100%', () => {
  const coverage = buildSecurityCoverage(completeResult())
  assert.equal(coverage.status, 'sufficient')
  assert.equal(coverage.coveragePercent, 100)
  assert.deepEqual(coverage.missingEssential, [])
})

test('AppOps não suportado registra cobertura limitada sem virar evidência negativa', () => {
  const result = completeResult()
  result.apps.collection.appOps.operations.SYSTEM_ALERT_WINDOW.status = 'not_supported'
  result.apps.collection.appOps.operations.REQUEST_INSTALL_PACKAGES.status = 'not_supported'
  const coverage = buildSecurityCoverage(result)
  assert.equal(coverage.checks.appOps.status, 'not_supported')
  assert.equal(coverage.status, 'limited')
  assert.ok(coverage.missingEssential.includes('appOps'))
  assert.match(coverage.policy.note, /não reduz o score/i)
})

test('sem módulos essenciais coverage fica insuficiente', () => {
  const coverage = buildSecurityCoverage({})
  assert.equal(coverage.status, 'insufficient')
  assert.equal(coverage.coveragePercent, 0)
  assert.ok(coverage.missingEssential.includes('packages'))
  assert.ok(coverage.missingEssential.includes('securitySettings'))
})

test('sem apps de usuário detalhes e AppOps são not_applicable', () => {
  const result = completeResult()
  result.apps.userTotal = 0
  result.apps.collection.details = { status: 'not_available' }
  result.apps.collection.appOps = null
  const coverage = buildSecurityCoverage(result)
  assert.equal(coverage.checks.packageDetails.status, 'not_applicable')
  assert.equal(coverage.checks.appOps.status, 'not_applicable')
  assert.equal(coverage.status, 'sufficient')
})

test('combinedStatus diferencia available, partial e not_supported', () => {
  assert.equal(combinedStatus(['available', 'available']), 'available')
  assert.equal(combinedStatus(['available', 'not_supported']), 'partial')
  assert.equal(combinedStatus(['not_supported', 'not_supported']), 'not_supported')
})
