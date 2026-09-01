const { ADB_ERROR_CODES, availabilityFromError } = require('../../adb/adbErrors')
const { parseAccessibilityServices, parseAppOps, parseDeviceAdmins } = require('../parsers/securityParsers')

const APP_OPS = Object.freeze(['SYSTEM_ALERT_WINDOW', 'REQUEST_INSTALL_PACKAGES'])
const TERMINAL_CODES = new Set([
  ADB_ERROR_CODES.SCAN_ABORTED,
  ADB_ERROR_CODES.DEVICE_DISCONNECTED,
  ADB_ERROR_CODES.DEVICE_OFFLINE,
  ADB_ERROR_CODES.DEVICE_UNAUTHORIZED,
])

function throwIfTerminal(error) {
  if (TERMINAL_CODES.has(error?.code || error?.codigo)) throw error
}

function cached(cache, key, loader) {
  if (!cache) return loader()
  if (!cache.has(key)) cache.set(key, Promise.resolve().then(loader))
  return cache.get(key)
}

function createDeviceSecurityCollector({ adb, deviceCollector }) {
  async function collectAccessibilityServices(serial, { signal = null, cache = null } = {}) {
    return cached(cache, `accessibility-services:${serial}`, async () => {
      const setting = await deviceCollector.readSetting(serial, 'secure', 'enabled_accessibility_services', { signal, cache })
      return {
        status: setting.status,
        value: setting.status === 'available' ? parseAccessibilityServices(setting.value) : [],
        reason: setting.reason,
      }
    })
  }

  async function collectAppOps(serial, { signal = null, cache = null } = {}) {
    return cached(cache, `appops:${serial}`, async () => {
      const operations = {}
      await Promise.all(APP_OPS.map(async (operation) => {
        try {
          const output = await adb.runDevice(
            serial,
            ['shell', 'cmd', 'appops', 'query-op', operation, 'allow'],
            { signal, timeout: 20000 },
          )
          operations[operation] = parseAppOps(output, operation)
        } catch (error) {
          throwIfTerminal(error)
          operations[operation] = { ...availabilityFromError(error), operation, packages: [] }
        }
      }))
      return { operations, source: 'adb_cmd_appops' }
    })
  }

  async function collectDeviceAdmins(serial, { signal = null, cache = null } = {}) {
    return cached(cache, `device-admins:${serial}`, async () => {
      try {
        const output = await adb.runDevice(serial, ['shell', 'dumpsys', 'device_policy'], { signal, timeout: 20000 })
        return parseDeviceAdmins(output)
      } catch (error) {
        throwIfTerminal(error)
        return { ...availabilityFromError(error), value: [] }
      }
    })
  }

  async function collectRootState(serial, { signal = null } = {}) {
    try {
      const output = await adb.runDevice(serial, ['shell', 'sh', '-c', 'command -v su 2>/dev/null'], { signal })
      const path = output.split(/\r?\n/).map((line) => line.trim()).find((line) => /^\/[A-Za-z0-9_./-]+$/.test(line))
      if (path) {
        return { status: 'detected', message: 'O shell ADB localizou um executável su acessível.', evidence: { path } }
      }
      return { status: 'not_detected', message: 'Nenhum executável su acessível foi localizado pelo shell ADB.', evidence: { commandCompleted: true } }
    } catch (error) {
      throwIfTerminal(error)
      if (error?.code === ADB_ERROR_CODES.COMMAND_FAILED) {
        return { status: 'not_detected', message: 'Nenhum executável su acessível foi localizado pelo shell ADB.', evidence: { commandCompleted: true } }
      }
      return { status: 'not_verified', message: 'Não foi possível verificar a presença de su.', reason: error?.code || 'COMMAND_FAILED' }
    }
  }

  async function collectSecurity(serial, { signal = null, cache = null } = {}) {
    const [
      properties,
      packageVerifier,
      verifyAdbInstalls,
      accessibilityEnabled,
      accessibilityServices,
      adbEnabled,
      developmentSettings,
      root,
      deviceAdmins,
      appOps,
    ] = await Promise.all([
      deviceCollector.collectProperties(serial, { signal, cache }),
      deviceCollector.readSetting(serial, 'global', 'package_verifier_enable', { signal, cache }),
      deviceCollector.readSetting(serial, 'global', 'verifier_verify_adb_installs', { signal, cache }),
      deviceCollector.readSetting(serial, 'secure', 'accessibility_enabled', { signal, cache }),
      collectAccessibilityServices(serial, { signal, cache }),
      deviceCollector.readSetting(serial, 'global', 'adb_enabled', { signal, cache }),
      deviceCollector.readSetting(serial, 'global', 'development_settings_enabled', { signal, cache }),
      collectRootState(serial, { signal }),
      collectDeviceAdmins(serial, { signal, cache }),
      collectAppOps(serial, { signal, cache }),
    ])
    const values = properties.value || {}
    return {
      securityPatch: values['ro.build.version.security_patch'] || null,
      debuggableBuild: deviceCollector.booleanFromAndroid(values['ro.debuggable']),
      secureBuild: deviceCollector.booleanFromAndroid(values['ro.secure']),
      buildTags: values['ro.build.tags'] || null,
      packageVerifierEnabled: deviceCollector.booleanFromAndroid(packageVerifier.value),
      verifyAdbInstalls: deviceCollector.booleanFromAndroid(verifyAdbInstalls.value),
      accessibility: {
        enabled: deviceCollector.booleanFromAndroid(accessibilityEnabled.value),
        enabledServices: accessibilityServices.value,
        collection: { status: accessibilityServices.status, reason: accessibilityServices.reason },
      },
      developerOptions: {
        adbEnabled: { status: adbEnabled.status, value: deviceCollector.booleanFromAndroid(adbEnabled.value), reason: adbEnabled.reason },
        developmentSettingsEnabled: {
          status: developmentSettings.status,
          value: deviceCollector.booleanFromAndroid(developmentSettings.value),
          reason: developmentSettings.reason,
        },
        verifyAppsOverUsb: {
          status: verifyAdbInstalls.status,
          value: deviceCollector.booleanFromAndroid(verifyAdbInstalls.value),
          reason: verifyAdbInstalls.reason,
        },
      },
      deviceAdmins,
      appOps,
      vpn: { status: 'not_supported', value: null, reason: 'NO_STABLE_NON_ROOT_SOURCE' },
      userCertificates: { status: 'not_supported', value: null, reason: 'NO_STABLE_NON_ROOT_SOURCE' },
      root,
      findings: [],
      collection: {
        properties: { status: properties.status, reason: properties.reason },
        packageVerifier: { status: packageVerifier.status, reason: packageVerifier.reason },
      },
    }
  }

  return {
    collectAccessibilityServices,
    collectAppOps,
    collectDeviceAdmins,
    collectRootState,
    collectSecurity,
  }
}

module.exports = { APP_OPS, createDeviceSecurityCollector, throwIfTerminal }
