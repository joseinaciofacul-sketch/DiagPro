const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { createAdbError, ADB_ERROR_CODES } = require('../../adb/adbErrors')
const { createDeviceCollector } = require('./deviceCollector')
const { createDeviceSecurityCollector } = require('./deviceSecurityCollector')
const { createPackageCollector } = require('./packageCollector')
const deviceDetector = require('../../deviceDetector')

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', name), 'utf8')
}

test('coleta de pacotes usa dump em lote e não calcula hashes automaticamente', async () => {
  const commands = []
  const adb = {
    async runDevice(_serial, args) {
      commands.push(args.join(' '))
      if (args.join(' ') === 'shell pm list packages -3 -f') return fixture('package-list-user.txt')
      if (args.join(' ') === 'shell pm list packages -s') return 'package:android\npackage:com.android.settings'
      if (args.join(' ') === 'shell dumpsys package packages') return fixture('package-dump.txt')
      throw new Error(`Comando inesperado: ${args.join(' ')}`)
    },
  }
  const collector = createPackageCollector({
    adb,
    deviceCollector: {},
    securityCollector: {
      collectAccessibilityServices: async () => ({ status: 'available', value: [], reason: null }),
      collectAppOps: async () => ({
        source: 'test',
        operations: {
          SYSTEM_ALERT_WINDOW: { status: 'available', packages: [], reason: null },
          REQUEST_INSTALL_PACKAGES: { status: 'available', packages: [], reason: null },
        },
      }),
    },
  })
  const result = await collector.listInstalledApps('TEST-SERIAL', {
    includeSecurityDetails: true,
    currentUserId: 10,
  })
  assert.equal(result.total, 3)
  assert.equal(result.userTotal, 2)
  assert.equal(result.systemTotal, 1)
  assert.equal(result.collection.details.strategy, 'bulk')
  assert.equal(result.collection.details.fallbackCommands, 0)
  assert.equal(result.collection.hash.reason, 'HASH_DEFERRED')
  assert.equal(result.items.find((app) => app.packageName === 'com.example.safe').securityDetails.integrity.hash.reason, 'HASH_DEFERRED')
  assert.equal(commands.filter((command) => command.includes('dumpsys package')).length, 1)
  assert.equal(commands.filter((command) => command.includes('sha256sum')).length, 0)
})

test('coleta usa fallback limitado quando dump global não contém pacote', async () => {
  const commands = []
  const adb = {
    async runDevice(_serial, args) {
      const command = args.join(' ')
      commands.push(command)
      if (command === 'shell pm list packages -3 -f') return 'package:/data/app/com.example.one/base.apk=com.example.one'
      if (command === 'shell pm list packages -s') return ''
      if (command === 'shell dumpsys package packages') return 'saída parcial sem blocos'
      if (command === 'shell dumpsys package com.example.one') return fixture('package-dump.txt').split('Package [com.example.partial]')[0]
      throw new Error(`Comando inesperado: ${command}`)
    },
  }
  const collector = createPackageCollector({
    adb,
    deviceCollector: {},
    securityCollector: {
      collectAccessibilityServices: async () => ({ status: 'available', value: [], reason: null }),
      collectAppOps: async () => ({ operations: {} }),
    },
  })
  const result = await collector.listInstalledApps('TEST-SERIAL', { includeSecurityDetails: true, currentUserId: 0 })
  assert.equal(result.collection.details.strategy, 'per_package_fallback')
  assert.equal(result.collection.details.fallbackCommands, 1)
  assert.equal(commands.filter((command) => command === 'shell dumpsys package com.example.one').length, 1)
})

test('usuário Android atual usa comando alternativo quando primeira saída não é interpretável', async () => {
  const commands = []
  const adb = {
    async runDevice(_serial, args) {
      const command = args.join(' ')
      commands.push(command)
      if (command === 'shell am get-current-user') return 'unexpected'
      if (command === 'shell cmd activity get-current-user') return '10'
      if (command === 'shell pm list users') return 'Users:\n  UserInfo{0:Owner:13} running\n  UserInfo{10:Work:MANAGED_PROFILE} running'
      throw new Error(`Comando inesperado: ${command}`)
    },
  }
  const collector = createDeviceCollector({ adb })
  const context = await collector.collectAndroidUsers('TEST-SERIAL')
  assert.equal(context.currentUserId, 10)
  assert.equal(context.managedProfiles.value[0].id, 10)
  assert.ok(commands.includes('shell cmd activity get-current-user'))
})

test('AppOps não suportado vira disponibilidade explícita', async () => {
  const adb = {
    async runDevice() { throw createAdbError(ADB_ERROR_CODES.COMMAND_NOT_SUPPORTED) },
  }
  const collector = createDeviceSecurityCollector({ adb, deviceCollector: {} })
  const result = await collector.collectAppOps('TEST-SERIAL')
  assert.equal(result.operations.SYSTEM_ALERT_WINDOW.status, 'not_supported')
  assert.equal(result.operations.REQUEST_INSTALL_PACKAGES.reason, ADB_ERROR_CODES.COMMAND_NOT_SUPPORTED)
})

test('hash sob demanda indisponível continua desconhecido e sem dado inventado', async () => {
  const adb = {
    async runDevice() { throw createAdbError(ADB_ERROR_CODES.COMMAND_NOT_SUPPORTED) },
  }
  const collector = createPackageCollector({ adb, deviceCollector: {}, securityCollector: {} })
  const details = new Map([['com.example.safe', {
    available: true,
    apkPath: '/data/app/com.example.safe/base.apk',
    integrity: { hash: { status: 'not_verified', reason: 'HASH_DEFERRED' } },
  }]])
  const result = await collector.collectHashes('TEST-SERIAL', details, { packageNames: ['com.example.safe'] })
  assert.equal(result.status, 'not_available')
  assert.equal(result.hashedPackages, 0)
  assert.equal(details.get('com.example.safe').integrity.hash.hash, null)
})

test('fachada deviceDetector preserva APIs públicas existentes', () => {
  for (const method of [
    'coletarDiagnostico', 'desinstalarAppUsuario', 'executarScan', 'listarAppsInstalados',
    'obterPreviewRemocao', 'verificarAdb', 'verificarEstado',
  ]) assert.equal(typeof deviceDetector[method], 'function', `${method} deve continuar público`)
})
