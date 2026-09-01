const SPECIAL_PERMISSION_TO_CAPABILITY = Object.freeze({
  'android.permission.SYSTEM_ALERT_WINDOW': { id: 'overlay', appOp: 'SYSTEM_ALERT_WINDOW' },
  'android.permission.REQUEST_INSTALL_PACKAGES': { id: 'installUnknownApps', appOp: 'REQUEST_INSTALL_PACKAGES' },
})

function integer(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function validPackageName(packageName) {
  return typeof packageName === 'string'
    && /^[A-Za-z][A-Za-z0-9_.-]{1,254}$/.test(packageName)
    && packageName.includes('.')
}

function validApkPath(apkPath) {
  return typeof apkPath === 'string' && /^\/[A-Za-z0-9_./=+~:-]+\.apk$/.test(apkPath)
}

function fieldValue(output, field) {
  const match = String(output).match(new RegExp(`(?:^|[\\s{])${field}=([^\\s}\\r\\n]+)`, 'mi'))
  if (!match) return null
  const value = match[1].trim()
  return !value || value === 'null' ? null : value
}

function parsePackageList(output = '', type = 'user') {
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const withoutPrefix = line.replace(/^package:/, '')
      if (type !== 'user' || !withoutPrefix.includes('=')) {
        return { packageName: withoutPrefix.split(/\s+/)[0], apkPath: null }
      }
      const separator = withoutPrefix.lastIndexOf('=')
      return { packageName: withoutPrefix.slice(separator + 1).trim(), apkPath: withoutPrefix.slice(0, separator).trim() }
    })
    .filter((item) => validPackageName(item.packageName))
    .map(({ packageName, apkPath }) => ({
      name: null,
      packageName,
      ...(validApkPath(apkPath) ? { apkPath } : {}),
      type,
      status: 'not_analyzed',
      statusLabel: 'Não analisado',
    }))
}

function parsePackageDetails(output = '', packageName, {
  enabledAccessibilityServices = [],
  listedApkPath = null,
  currentUserId = 0,
} = {}) {
  const text = String(output)
  if (!text.trim()) return { available: false, reason: 'EMPTY_PACKAGE_DETAILS' }

  const requestedPermissions = []
  const grantedPermissions = []
  const reportedSpecialPermissionGrants = []
  const flags = new Set()
  let readingRequested = false
  let activeUserId = null
  let installed = null
  let enabled = null
  let firstInstallTime = null
  let lastUpdateTime = null
  let versionName = null
  let versionCode = null
  let uid = null
  let codePath = null
  let resourcePath = null

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    const userHeader = trimmed.match(/^User\s+(\d+):/i)
    if (userHeader) activeUserId = integer(userHeader[1])

    if (trimmed === 'requested permissions:') {
      readingRequested = true
      activeUserId = null
      return
    }
    if (readingRequested) {
      if (/^android\.permission\.[A-Za-z0-9_]+$/.test(trimmed)) {
        requestedPermissions.push(trimmed)
      } else if (trimmed && /:$/.test(trimmed)) {
        readingRequested = false
      }
    }

    const grantedMatch = trimmed.match(/^(android\.permission\.[A-Za-z0-9_]+):\s+granted=true\b/)
    if (grantedMatch && (activeUserId === null || activeUserId === currentUserId)) {
      if (SPECIAL_PERMISSION_TO_CAPABILITY[grantedMatch[1]]) {
        reportedSpecialPermissionGrants.push(grantedMatch[1])
      } else {
        grantedPermissions.push(grantedMatch[1])
      }
    }

    const flagsMatch = trimmed.match(/^(?:pkgFlags|flags)=\[([^\]]*)\]/)
    if (flagsMatch) flagsMatch[1].split(/\s+/).filter(Boolean).forEach((flag) => flags.add(flag))
    const firstInstallMatch = trimmed.match(/^firstInstallTime=(.+)$/)
    if (firstInstallMatch) firstInstallTime = firstInstallMatch[1].trim()
    const lastUpdateMatch = trimmed.match(/^lastUpdateTime=(.+)$/)
    if (lastUpdateMatch) lastUpdateTime = lastUpdateMatch[1].trim()
    const versionNameMatch = trimmed.match(/^versionName=(.*)$/)
    if (versionNameMatch) versionName = versionNameMatch[1].trim() || null
    const versionCodeMatch = trimmed.match(/^versionCode=(\d+)\b/)
    if (versionCodeMatch) versionCode = versionCodeMatch[1]
    const uidMatch = trimmed.match(/^(?:userId|appId)=(\d+)\b/)
    if (uidMatch && uid === null) uid = integer(uidMatch[1])
    const codePathMatch = trimmed.match(/^codePath=(.+)$/)
    if (codePathMatch) codePath = codePathMatch[1].trim()
    const resourcePathMatch = trimmed.match(/^resourcePath=(.+)$/)
    if (resourcePathMatch) resourcePath = resourcePathMatch[1].trim()

    if (userHeader && activeUserId === currentUserId) {
      const installedMatch = trimmed.match(/\binstalled=(true|false)\b/)
      if (installedMatch) installed = installedMatch[1] === 'true'
      const enabledMatch = trimmed.match(/\benabled=(\d+)\b/)
      if (enabledMatch) enabled = !['2', '3', '4'].includes(enabledMatch[1])
    }
  })

  const signatureVersionMatch = text.match(/signatures=PackageSignatures\{[^\r\n}]*version:(\d+)/i)
  const apkPath = [listedApkPath, resourcePath, codePath].find(validApkPath) || null
  return {
    available: true,
    currentUserId,
    requestedPermissions: [...new Set(requestedPermissions)].sort(),
    grantedPermissions: [...new Set(grantedPermissions)].sort(),
    reportedSpecialPermissionGrants: [...new Set(reportedSpecialPermissionGrants)].sort(),
    specialCapabilities: {},
    flags: [...flags].sort(),
    installed,
    enabled,
    firstInstallTime,
    lastUpdateTime,
    versionName,
    versionCode,
    uid,
    apkPath,
    installerPackageName: fieldValue(text, 'installerPackageName'),
    initiatingPackageName: fieldValue(text, 'initiatingPackageName'),
    originatingPackageName: fieldValue(text, 'originatingPackageName'),
    integrity: {
      hash: { algorithm: 'SHA-256', hash: null, status: 'not_verified', reason: 'HASH_DEFERRED' },
      signature: {
        status: 'not_verified',
        certificateDigest: null,
        digestAlgorithm: null,
        schemeVersion: signatureVersionMatch ? integer(signatureVersionMatch[1]) : null,
        reason: 'CERTIFICATE_DIGEST_UNAVAILABLE_VIA_ADB',
      },
    },
    accessibilityServiceEnabled: enabledAccessibilityServices.some((service) => service.startsWith(`${packageName}/`)),
  }
}

function parsePackageDump(output = '', options = {}) {
  const text = String(output)
  const headers = [...text.matchAll(/^\s*Package \[([^\]]+)](?:[^\r\n]*)$/gmi)]
  const detailsByPackage = new Map()
  headers.forEach((header, index) => {
    const packageName = header[1]?.trim()
    if (!validPackageName(packageName)) return
    const start = header.index
    const end = headers[index + 1]?.index ?? text.length
    detailsByPackage.set(packageName, parsePackageDetails(text.slice(start, end), packageName, options))
  })
  return detailsByPackage
}

function applySpecialCapabilityStates(details, packageName, appOpsResult) {
  if (!details?.available) return details
  const granted = new Set(details.grantedPermissions || [])
  const specialCapabilities = {}
  Object.entries(SPECIAL_PERMISSION_TO_CAPABILITY).forEach(([permission, definition]) => {
    if (!(details.requestedPermissions || []).includes(permission)) return
    const operationState = appOpsResult?.operations?.[definition.appOp]
    const packageState = operationState?.packages?.find((item) => item.packageName === packageName)
    const status = operationState?.status || 'not_available'
    const mode = packageState?.mode || null
    const effective = status === 'available' ? (mode === null ? false : ['allow', 'foreground'].includes(mode)) : null
    if (effective === true) granted.add(permission)
    specialCapabilities[definition.id] = {
      status,
      requested: true,
      effective,
      mode,
      permission,
      appOp: definition.appOp,
      source: status === 'available' ? 'adb_appops' : null,
      reason: operationState?.reason || (status === 'available' && mode === null ? 'NO_EXPLICIT_APP_OP' : null),
    }
  })
  return { ...details, grantedPermissions: [...granted].sort(), specialCapabilities }
}

module.exports = {
  SPECIAL_PERMISSION_TO_CAPABILITY,
  applySpecialCapabilityStates,
  parsePackageDetails,
  parsePackageDump,
  parsePackageList,
  validApkPath,
  validPackageName,
}
