const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const {
  parseAdbDevices,
  parseAndroidUsers,
  parseBattery,
  parseCurrentUser,
  parseGetprop,
  parseMemory,
  parseStorage,
} = require('./adbParsers')
const {
  applySpecialCapabilityStates,
  parsePackageDetails,
  parsePackageDump,
  parsePackageList,
} = require('./packageParsers')
const { parseAppOps, parseDeviceAdmins } = require('./securityParsers')

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', name), 'utf8')
}

test('parser adb devices reconhece device, unauthorized e offline', () => {
  const devices = parseAdbDevices(fixture('adb-devices.txt'))
  assert.deepEqual(devices.map(({ serial, status }) => [serial, status]), [
    ['TEST-SERIAL-001', 'device'],
    ['TEST-SERIAL-UNAUTH', 'unauthorized'],
    ['TEST-SERIAL-OFFLINE', 'offline'],
  ])
  assert.equal(devices[0].attributes.model, 'Test_Model')
})

test('parser adb devices tolera saída vazia e inesperada', () => {
  assert.deepEqual(parseAdbDevices(''), [])
  assert.deepEqual(parseAdbDevices('texto inesperado sem estado'), [])
})

test('parsers de métricas toleram campos ausentes', () => {
  assert.equal(parseBattery('level: 73\nstatus: 3').level, 73)
  assert.equal(parseBattery('garbage').level, null)
  assert.equal(parseStorage('/dev/block/data 1000000 400000 600000 40% /data').usagePercent, 40)
  assert.equal(parseStorage('Filesystem unknown').totalGb, null)
  assert.equal(parseMemory('MemTotal: 8000000 kB\nMemFree: 2000000 kB').availableGb, 2)
})

test('parser converte blocos reais anonimizados para GB decimais exibidos na interface', () => {
  assert.deepEqual(parseStorage(fixture('storage-df-android.txt')), {
    totalGb: 113.1,
    usedGb: 69.7,
    freeGb: 43.2,
    usagePercent: 62,
  })
})

test('parser getprop ignora linhas desconhecidas e preserva propriedades válidas', () => {
  assert.deepEqual(parseGetprop('[ro.product.model]: [Modelo Teste]\nlinha desconhecida'), {
    'ro.product.model': 'Modelo Teste',
  })
})

test('parser de packages separa packageName e caminho sem inventar nome', () => {
  const apps = parsePackageList(fixture('package-list-user.txt'), 'user')
  assert.equal(apps.length, 2)
  assert.equal(apps[0].packageName, 'com.example.safe')
  assert.equal(apps[0].name, null)
  assert.equal(apps[0].statusLabel, 'Não analisado')
})

test('parser dumpsys package respeita usuário Android atual e separa permissões especiais', () => {
  const details = parsePackageDump(fixture('package-dump.txt'), {
    currentUserId: 10,
    enabledAccessibilityServices: ['com.example.safe/.AccessibilityService'],
  }).get('com.example.safe')
  assert.equal(details.currentUserId, 10)
  assert.deepEqual(details.grantedPermissions, ['android.permission.CAMERA'])
  assert.deepEqual(details.reportedSpecialPermissionGrants, ['android.permission.SYSTEM_ALERT_WINDOW'])
  assert.equal(details.accessibilityServiceEnabled, true)
  assert.equal(details.installed, true)
  assert.equal(details.integrity.hash.status, 'not_verified')
  assert.equal(details.integrity.hash.reason, 'HASH_DEFERRED')
})

test('parser dumpsys package tolera pacote parcial', () => {
  const details = parsePackageDump(fixture('package-dump.txt'), { currentUserId: 10 }).get('com.example.partial')
  assert.equal(details.available, true)
  assert.equal(details.versionName, '1.0')
  assert.equal(details.apkPath, null)
  assert.deepEqual(details.requestedPermissions, ['android.permission.RECORD_AUDIO'])
})

test('saída vazia de dumpsys package fica indisponível', () => {
  assert.deepEqual(parsePackageDetails('', 'com.example.empty'), {
    available: false,
    reason: 'EMPTY_PACKAGE_DETAILS',
  })
})

test('usuário Android atual e perfis gerenciados são normalizados', () => {
  assert.deepEqual(parseCurrentUser('Current user: 10'), { status: 'available', value: 10, reason: null })
  const users = parseAndroidUsers('Users:\n\tUserInfo{0:Owner:13} running\n\tUserInfo{10:Work profile:MANAGED_PROFILE} running')
  assert.equal(users.status, 'available')
  assert.equal(users.value[1].managedProfile, true)
  assert.equal(parseCurrentUser('unexpected').status, 'error')
})

test('AppOps normaliza allow, saída vazia, não suportada e inesperada', () => {
  const allowed = parseAppOps('com.example.safe\ncom.example.other', 'SYSTEM_ALERT_WINDOW')
  assert.equal(allowed.status, 'available')
  assert.equal(allowed.packages[0].mode, 'allow')
  assert.equal(parseAppOps('', 'SYSTEM_ALERT_WINDOW').status, 'available')
  assert.equal(parseAppOps('Error: unknown operation', 'SYSTEM_ALERT_WINDOW').status, 'not_supported')
  assert.equal(parseAppOps('formato sem pacote reconhecível', 'SYSTEM_ALERT_WINDOW').status, 'error')
})

test('AppOps efetivo é evidência separada do granted reportado pelo package dump', () => {
  const base = parsePackageDump(fixture('package-dump.txt'), { currentUserId: 10 }).get('com.example.safe')
  const withAppOps = applySpecialCapabilityStates(base, 'com.example.safe', {
    operations: {
      SYSTEM_ALERT_WINDOW: {
        status: 'available', reason: null, packages: [{ packageName: 'com.example.safe', mode: 'allow' }],
      },
    },
  })
  assert.equal(withAppOps.specialCapabilities.overlay.effective, true)
  assert.ok(withAppOps.grantedPermissions.includes('android.permission.SYSTEM_ALERT_WINDOW'))
})

test('Device Administrator é coletado sem conteúdo privado', () => {
  const admins = parseDeviceAdmins('Active admin (User 10):\n  admin=ComponentInfo{com.example.admin/.Receiver}')
  assert.equal(admins.status, 'available')
  assert.deepEqual(admins.value[0], {
    userId: 10,
    packageName: 'com.example.admin',
    componentName: 'com.example.admin/.Receiver',
  })
  assert.equal(parseDeviceAdmins('Unknown command').status, 'not_supported')
})
