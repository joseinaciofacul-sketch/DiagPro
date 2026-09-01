function integer(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function toGb(kilobytes) {
  return Number.isFinite(kilobytes) ? Math.round((kilobytes / 1024 / 1024) * 10) / 10 : null
}

function parseAdbDevices(output = '') {
  const knownStatuses = new Set(['device', 'unauthorized', 'offline', 'recovery', 'sideload', 'bootloader'])
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^list of devices attached/i.test(line) && !/^\* daemon/i.test(line))
    .map((line) => {
      const parts = line.split(/\s+/)
      if (parts.length < 2 || !/^[A-Za-z0-9._:-]{1,128}$/.test(parts[0])) return null
      const status = parts[1] === 'no' && parts[2] === 'permissions' ? 'no_permissions' : parts[1]
      if (!knownStatuses.has(status) && status !== 'no_permissions') return null
      const attributes = {}
      parts.slice(status === 'no_permissions' ? 3 : 2).forEach((part) => {
        const separator = part.indexOf(':')
        if (separator > 0) attributes[part.slice(0, separator)] = part.slice(separator + 1)
      })
      return {
        serial: parts[0],
        status,
        attributes,
      }
    })
    .filter(Boolean)
}

function parseGetprop(output = '') {
  const properties = {}
  String(output).split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*\[([^\]]+)]\s*:\s*\[(.*)]\s*$/)
    if (match) properties[match[1]] = match[2] || null
  })
  return properties
}

function parseBattery(output = '') {
  const get = (key) => {
    const match = String(output).match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi'))
    return match ? match[1].trim() : null
  }
  const statusCode = integer(get('status'))
  const level = integer(get('level'))
  const usb = get('USB powered') === 'true'
  const ac = get('AC powered') === 'true'
  const wireless = get('Wireless powered') === 'true'
  const statusByCode = { 2: 'Carregando', 3: 'Descarregando', 4: 'Não carregando', 5: 'Completa' }
  return {
    level,
    status: statusCode ? statusByCode[statusCode] || 'Não disponível' : 'Não disponível',
    charging: statusCode === 2 || statusCode === 5 || usb || ac || wireless,
    source: usb ? 'USB' : ac ? 'Tomada' : wireless ? 'Sem fio' : null,
  }
}

function parseStorage(output = '') {
  const rows = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const columns = rows
    .map((line) => line.split(/\s+/))
    .find((items) => items.length >= 4 && integer(items[1]) !== null && integer(items[2]) !== null)

  if (!columns) return { totalGb: null, usedGb: null, freeGb: null, usagePercent: null }
  const totalKb = integer(columns[1])
  const usedKb = integer(columns[2])
  const freeKb = integer(columns[3])
  const percentColumn = columns.find((column) => /^\d+%$/.test(column))
  return {
    totalGb: toGb(totalKb),
    usedGb: toGb(usedKb),
    freeGb: toGb(freeKb),
    usagePercent: percentColumn
      ? integer(percentColumn)
      : totalKb && usedKb !== null
        ? Math.round((usedKb / totalKb) * 100)
        : null,
  }
}

function parseMemory(output = '') {
  const getKb = (key) => {
    const match = String(output).match(new RegExp(`^${key}:\\s*(\\d+)`, 'mi'))
    return match ? integer(match[1]) : null
  }
  const totalKb = getKb('MemTotal')
  const availableKb = getKb('MemAvailable') ?? getKb('MemFree')
  return {
    totalGb: toGb(totalKb),
    availableGb: toGb(availableKb),
    usedGb: totalKb !== null && availableKb !== null ? toGb(totalKb - availableKb) : null,
  }
}

function parseCurrentUser(output = '') {
  const text = String(output).trim()
  const direct = text.match(/^\s*(\d+)\s*$/)
  const labelled = text.match(/(?:current\s+user(?:\s+id)?|user)\s*[:=]\s*(\d+)/i)
  const value = integer(direct?.[1] ?? labelled?.[1])
  return value === null
    ? { status: text ? 'error' : 'not_available', value: null, reason: text ? 'UNRECOGNIZED_OUTPUT' : 'EMPTY_OUTPUT' }
    : { status: 'available', value, reason: null }
}

function parseAndroidUsers(output = '') {
  const text = String(output)
  const users = []
  text.split(/\r?\n/).forEach((line) => {
    const match = line.match(/UserInfo\{(\d+):([^:}]*):([^}]*)}/i)
    if (!match) return
    const flagsAndState = `${match[3]} ${line}`
    users.push({
      id: integer(match[1]),
      name: match[2]?.trim() || null,
      managedProfile: /MANAGED_PROFILE|profile/i.test(flagsAndState),
      running: /\brunning\b/i.test(line),
    })
  })
  if (users.length > 0) return { status: 'available', value: users, reason: null }
  return {
    status: text.trim() ? 'error' : 'not_available',
    value: [],
    reason: text.trim() ? 'UNRECOGNIZED_OUTPUT' : 'EMPTY_OUTPUT',
  }
}

function parseSettingValue(output = '') {
  const value = String(output).trim()
  return !value || value === 'null' || value === 'undefined' ? null : value
}

module.exports = {
  integer,
  parseAdbDevices,
  parseAndroidUsers,
  parseBattery,
  parseCurrentUser,
  parseGetprop,
  parseMemory,
  parseSettingValue,
  parseStorage,
  toGb,
}
