const { ADB_ERROR_CODES, availabilityFromError } = require('../../adb/adbErrors')
const {
  parseAndroidUsers,
  parseBattery,
  parseCurrentUser,
  parseGetprop,
  parseMemory,
  parseSettingValue,
  parseStorage,
} = require('../parsers/adbParsers')

function cached(cache, key, loader) {
  if (!cache) return loader()
  if (!cache.has(key)) cache.set(key, Promise.resolve().then(loader))
  return cache.get(key)
}

function booleanFromAndroid(value) {
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return null
}

const TERMINAL_CODES = new Set([
  ADB_ERROR_CODES.SCAN_ABORTED,
  ADB_ERROR_CODES.DEVICE_DISCONNECTED,
  ADB_ERROR_CODES.DEVICE_OFFLINE,
  ADB_ERROR_CODES.DEVICE_UNAUTHORIZED,
])

function throwIfTerminal(error) {
  if (TERMINAL_CODES.has(error?.code || error?.codigo)) throw error
}

function createDeviceCollector({ adb }) {
  async function collectProperties(serial, { signal = null, cache = null } = {}) {
    return cached(cache, `getprop:${serial}`, async () => {
      const output = await adb.runDevice(serial, ['shell', 'getprop'], { signal })
      const properties = parseGetprop(output)
      return {
        status: Object.keys(properties).length > 0 ? 'available' : 'error',
        reason: Object.keys(properties).length > 0 ? null : 'UNRECOGNIZED_OUTPUT',
        value: properties,
      }
    })
  }

  async function readSetting(serial, namespace, key, { signal = null, cache = null } = {}) {
    return cached(cache, `setting:${serial}:${namespace}:${key}`, async () => {
      try {
        const output = await adb.runDevice(serial, ['shell', 'settings', 'get', namespace, key], { signal })
        const value = parseSettingValue(output)
        return value === null
          ? { status: 'not_available', value: null, reason: 'EMPTY_OR_NULL_SETTING' }
          : { status: 'available', value, reason: null }
      } catch (error) {
        throwIfTerminal(error)
        return { ...availabilityFromError(error), value: null }
      }
    })
  }

  async function collectAndroidUsers(serial, { signal = null, cache = null } = {}) {
    return cached(cache, `android-users:${serial}`, async () => {
      let currentUser
      try {
        currentUser = parseCurrentUser(await adb.runDevice(serial, ['shell', 'am', 'get-current-user'], { signal }))
        if (currentUser.status !== 'available') {
          currentUser = parseCurrentUser(await adb.runDevice(serial, ['shell', 'cmd', 'activity', 'get-current-user'], { signal }))
        }
      } catch (firstError) {
        throwIfTerminal(firstError)
        try {
          currentUser = parseCurrentUser(await adb.runDevice(serial, ['shell', 'cmd', 'activity', 'get-current-user'], { signal }))
        } catch (secondError) {
          throwIfTerminal(secondError || firstError)
          currentUser = { ...availabilityFromError(secondError || firstError), value: null }
        }
      }

      let users
      try {
        users = parseAndroidUsers(await adb.runDevice(serial, ['shell', 'pm', 'list', 'users'], { signal }))
      } catch (error) {
        throwIfTerminal(error)
        users = { ...availabilityFromError(error), value: [] }
      }

      const managedProfiles = users.value.filter((user) => user.managedProfile)
      return {
        currentUserId: currentUser.status === 'available' ? currentUser.value : null,
        currentUser,
        users,
        managedProfiles: {
          status: users.status,
          value: managedProfiles,
          reason: users.reason,
        },
      }
    })
  }

  async function collectIdentification(serial, options = {}) {
    const [properties, androidUsers] = await Promise.all([
      collectProperties(serial, options),
      collectAndroidUsers(serial, options),
    ])
    const values = properties.value || {}
    return {
      manufacturer: values['ro.product.manufacturer'] || null,
      brand: values['ro.product.brand'] || null,
      model: values['ro.product.model'] || null,
      commercialModel: values['ro.product.marketname'] || null,
      androidVersion: values['ro.build.version.release'] || null,
      sdk: values['ro.build.version.sdk'] || null,
      securityPatch: values['ro.build.version.security_patch'] || null,
      buildId: values['ro.build.display.id'] || null,
      androidUsers,
      collection: { properties: { status: properties.status, reason: properties.reason } },
    }
  }

  async function collectBattery(serial, { signal = null } = {}) {
    try {
      return {
        ...parseBattery(await adb.runDevice(serial, ['shell', 'dumpsys', 'battery'], { signal })),
        collection: { status: 'available', reason: null },
      }
    } catch (error) {
      throwIfTerminal(error)
      return {
        level: null, status: 'Não disponível', charging: null, source: null,
        collection: availabilityFromError(error),
      }
    }
  }

  async function collectStorage(serial, { signal = null } = {}) {
    try {
      const parsed = parseStorage(await adb.runDevice(serial, ['shell', 'df', '/data'], { signal }))
      return {
        ...parsed,
        collection: parsed.totalGb === null
          ? { status: 'error', reason: 'UNRECOGNIZED_OUTPUT' }
          : { status: 'available', reason: null },
      }
    } catch (error) {
      throwIfTerminal(error)
      return {
        totalGb: null, usedGb: null, freeGb: null, usagePercent: null,
        collection: availabilityFromError(error),
      }
    }
  }

  async function collectMemory(serial, { signal = null } = {}) {
    try {
      const parsed = parseMemory(await adb.runDevice(serial, ['shell', 'cat', '/proc/meminfo'], { signal }))
      return {
        ...parsed,
        collection: parsed.totalGb === null
          ? { status: 'error', reason: 'UNRECOGNIZED_OUTPUT' }
          : { status: 'available', reason: null },
      }
    } catch (error) {
      throwIfTerminal(error)
      return {
        totalGb: null, availableGb: null, usedGb: null,
        collection: availabilityFromError(error),
      }
    }
  }

  return {
    booleanFromAndroid,
    collectAndroidUsers,
    collectBattery,
    collectIdentification,
    collectMemory,
    collectProperties,
    collectStorage,
    readSetting,
  }
}

module.exports = { booleanFromAndroid, createDeviceCollector }
