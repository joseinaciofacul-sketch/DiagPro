const { validPackageName } = require('./packageParsers')

function parseAccessibilityServices(value = '') {
  const text = String(value).trim()
  if (!text || text === 'null') return []
  return text.split(':').map((service) => service.trim()).filter(Boolean)
}

function normalizeAppOpMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  if (mode === 'allowed') return 'allow'
  if (mode === 'ignored') return 'ignore'
  if (mode === 'errored') return 'deny'
  return ['allow', 'ignore', 'deny', 'default', 'foreground'].includes(mode) ? mode : null
}

function parseAppOps(output = '', operation) {
  const text = String(output)
  if (/unknown operation|unknown command|not supported/i.test(text)) {
    return { status: 'not_supported', operation, packages: [], reason: 'COMMAND_NOT_SUPPORTED' }
  }
  if (/permission denial|security exception|not allowed to/i.test(text)) {
    return { status: 'not_available', operation, packages: [], reason: 'ADB_PERMISSION_DENIED' }
  }
  if (!text.trim() || /no operations|none/i.test(text)) {
    return { status: 'available', operation, packages: [], reason: null }
  }

  const byPackage = new Map()
  let currentPackage = null
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    const packageHeader = trimmed.match(/^(?:package\s+)?([A-Za-z][A-Za-z0-9_.-]+):?$/)
    if (packageHeader && validPackageName(packageHeader[1])) {
      currentPackage = packageHeader[1]
      if (!byPackage.has(currentPackage)) byPackage.set(currentPackage, 'allow')
      return
    }
    const inline = trimmed.match(/^(?:package\s+)?([A-Za-z][A-Za-z0-9_.-]+)\s+(?:\([^)]*\)\s*)?(?:[^:]+:)?\s*(allow|allowed|ignore|ignored|deny|errored|default|foreground)\b/i)
    if (inline && validPackageName(inline[1])) {
      byPackage.set(inline[1], normalizeAppOpMode(inline[2]))
      currentPackage = inline[1]
      return
    }
    const operationLine = trimmed.match(/^[A-Z0-9_:.-]+:\s*(allow|allowed|ignore|ignored|deny|errored|default|foreground)\b/i)
    if (operationLine && currentPackage) byPackage.set(currentPackage, normalizeAppOpMode(operationLine[1]))
  })

  const packages = [...byPackage.entries()].map(([packageName, mode]) => ({ packageName, mode }))
  return packages.length > 0
    ? { status: 'available', operation, packages, reason: null }
    : { status: 'error', operation, packages: [], reason: 'UNRECOGNIZED_OUTPUT' }
}

function parseDeviceAdmins(output = '') {
  const text = String(output)
  if (/unknown command|not supported|can't find service/i.test(text)) {
    return { status: 'not_supported', value: [], reason: 'COMMAND_NOT_SUPPORTED' }
  }
  if (/permission denial|security exception/i.test(text)) {
    return { status: 'not_available', value: [], reason: 'ADB_PERMISSION_DENIED' }
  }
  const admins = []
  let currentUserId = null
  text.split(/\r?\n/).forEach((line) => {
    const userMatch = line.match(/(?:User|user)\s+(\d+)/)
    if (userMatch) currentUserId = Number.parseInt(userMatch[1], 10)
    const componentMatch = line.match(/ComponentInfo\{([^}/]+)\/([^}]+)}/)
      || line.match(/(?:admin|component)\s*[=:]\s*([^\s/]+)\/([^\s}]+)/i)
    if (!componentMatch || !validPackageName(componentMatch[1])) return
    admins.push({
      userId: Number.isFinite(currentUserId) ? currentUserId : null,
      packageName: componentMatch[1],
      componentName: `${componentMatch[1]}/${componentMatch[2]}`,
    })
  })
  return { status: 'available', value: admins, reason: null }
}

module.exports = {
  normalizeAppOpMode,
  parseAccessibilityServices,
  parseAppOps,
  parseDeviceAdmins,
}
