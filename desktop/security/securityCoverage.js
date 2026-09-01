const {
  COVERAGE_STATUS_CREDITS,
  COVERAGE_WEIGHTS,
  FULL_CALCULATION_COVERAGE_PERCENT,
  MINIMUM_NUMERIC_COVERAGE_PERCENT,
} = require('./riskScoreConfig')

function normalizeStatus(status, fallback = 'not_executed') {
  return Object.hasOwn(COVERAGE_STATUS_CREDITS, status) ? status : fallback
}

function combinedStatus(statuses = []) {
  const normalized = statuses.filter(Boolean).map((status) => normalizeStatus(status))
  if (normalized.length === 0) return 'not_executed'
  if (normalized.every((status) => ['available', 'not_applicable'].includes(status))) return 'available'
  if (normalized.some((status) => status === 'available')) return 'partial'
  if (normalized.every((status) => status === 'not_supported')) return 'not_supported'
  if (normalized.some((status) => status === 'error')) return 'error'
  return 'not_available'
}

function appOpsStatus(result = {}) {
  const appOps = result.security?.appOps || result.apps?.collection?.appOps
  const operations = appOps?.operations && typeof appOps.operations === 'object'
    ? Object.values(appOps.operations)
    : []
  return combinedStatus(operations.map((operation) => operation?.status))
}

function securitySettingsStatus(security) {
  if (!security) return 'not_executed'
  return combinedStatus([
    security.collection?.packageVerifier?.status,
    security.developerOptions?.adbEnabled?.status,
    security.developerOptions?.developmentSettingsEnabled?.status,
    security.developerOptions?.verifyAppsOverUsb?.status,
  ])
}

function createCheck(id, status, { essential = false, reason = null } = {}) {
  const normalized = normalizeStatus(status)
  return {
    id,
    status: normalized,
    essential,
    weight: COVERAGE_WEIGHTS[id],
    credit: COVERAGE_STATUS_CREDITS[normalized],
    reason,
  }
}

function buildSecurityCoverage(result = {}) {
  const apps = result.apps
  const userAppsKnown = Number.isFinite(apps?.userTotal)
  const hasUserApps = userAppsKnown && apps.userTotal > 0
  const packageDetailsStatus = !apps
    ? 'not_executed'
    : apps.userTotal === 0
      ? 'not_applicable'
      : apps.collection?.details?.status || 'not_available'
  const normalizedAppOpsStatus = !apps
    ? 'not_executed'
    : apps.userTotal === 0
      ? 'not_applicable'
      : appOpsStatus(result)

  const checks = {
    packages: createCheck('packages', apps?.collection?.status || (apps ? 'available' : 'not_executed'), { essential: true }),
    packageDetails: createCheck('packageDetails', packageDetailsStatus, { essential: hasUserApps }),
    appOps: createCheck('appOps', normalizedAppOpsStatus, { essential: hasUserApps }),
    devicePolicy: createCheck('devicePolicy', result.security?.deviceAdmins?.status || 'not_executed'),
    securitySettings: createCheck('securitySettings', securitySettingsStatus(result.security), { essential: true }),
    deviceProperties: createCheck(
      'deviceProperties',
      result.security?.collection?.properties?.status
        || result.device?.collection?.properties?.status
        || 'not_executed',
      { essential: true },
    ),
  }

  const entries = Object.values(checks)
  const totalWeight = entries.reduce((total, check) => total + check.weight, 0)
  const coveredWeight = entries.reduce((total, check) => total + (check.weight * check.credit), 0)
  const coveragePercent = totalWeight > 0 ? Math.round((coveredWeight / totalWeight) * 100) : 0
  const missingEssential = entries
    .filter((check) => check.essential && !['available', 'not_applicable'].includes(check.status))
    .map((check) => check.id)
  const status = coveragePercent < MINIMUM_NUMERIC_COVERAGE_PERCENT
    ? 'insufficient'
    : missingEssential.length > 0 || coveragePercent < FULL_CALCULATION_COVERAGE_PERCENT
      ? 'limited'
      : 'sufficient'

  return {
    status,
    coveragePercent,
    checks,
    missingEssential,
    policy: {
      minimumNumericPercent: MINIMUM_NUMERIC_COVERAGE_PERCENT,
      fullCalculationPercent: FULL_CALCULATION_COVERAGE_PERCENT,
      note: 'Coverage mede execução das fontes; não representa confiança de malware e não reduz o score observado.',
    },
  }
}

module.exports = {
  appOpsStatus,
  buildSecurityCoverage,
  combinedStatus,
  createCheck,
  normalizeStatus,
  securitySettingsStatus,
}
