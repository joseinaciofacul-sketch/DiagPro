const test = require('node:test')
const assert = require('node:assert/strict')
const { ADB_ERROR_CODES, createAdbError } = require('../adb/adbErrors')
const { createRemediationService } = require('./remediationService')

function fixture(overrides = {}) {
  const state = {
    now: Date.parse('2026-09-01T12:00:00.000Z'),
    currentUserId: 10,
    apps: [{ packageName: 'com.example.app', name: null, type: 'user' }],
    admins: [],
    deviceError: null,
    command: null,
  }
  Object.assign(state, overrides)
  const service = createRemediationService({
    now: () => state.now,
    createActionId: () => '11111111-1111-4111-8111-111111111111',
    createTokenId: () => '22222222-2222-4222-8222-222222222222',
    createToken: () => 'unpredictable-test-token',
    validateDevice: async () => {
      if (state.deviceError) throw state.deviceError
      return { serial: 'SERIAL-1', status: 'device' }
    },
    listInstalledApps: async () => ({ currentUserId: state.currentUserId, items: state.apps }),
    collectDeviceAdmins: async () => ({ status: 'available', value: state.admins }),
    getDeviceInfo: async () => ({ manufacturer: 'Example', model: 'Device' }),
    runAdb: async (args) => {
      if (args.includes('list')) {
        return state.apps.some((app) => app.packageName === 'com.example.app' && app.type === 'user')
          ? 'package:com.example.app'
          : ''
      }
      state.command = args
      if (state.commandError) throw state.commandError
      return state.commandOutput ?? 'Success'
    },
  })
  return { service, state }
}

const previewInput = {
  serial: 'SERIAL-1', packageName: 'com.example.app',
  finding: { id: 'finding-1', subjectType: 'app', packageName: 'com.example.app', status: 'open', title: 'Revisar app' },
  action: { type: 'uninstall_user_app', availability: 'available' },
}

async function previewAndExecute(service, overrides = {}) {
  const preview = await service.createRemovalPreview(previewInput)
  return {
    preview,
    execution: await service.executeUninstall({
      serial: 'SERIAL-1', packageName: 'com.example.app', androidUserId: 10,
      confirmationToken: preview.confirmationToken, actionId: preview.actionId,
      ...overrides,
    }),
  }
}

test('user app elegível gera preview contextual e token hasheado', async () => {
  const { service } = fixture()
  const result = await service.createRemovalPreview(previewInput)
  assert.equal(result.removable, true)
  assert.equal(result.currentUserId, 10)
  assert.equal(result.preview.app.type, 'user')
  assert.equal(result.preview.device.serial, 'SERIAL-1')
  assert.equal(result.preview.finding.id, 'finding-1')
  assert.equal(result.preview.requiresConfirmation, true)
  assert.equal(result.confirmationTokenHash.length, 64)
  assert.equal(JSON.stringify(result.auditContext).includes(result.confirmationToken), false)
})

test('system app é bloqueado sem oferecer uninstall', async () => {
  const { service } = fixture({ apps: [{ packageName: 'com.example.app', type: 'system' }] })
  await assert.rejects(service.createRemovalPreview(previewInput), (error) => error.code === 'SYSTEM_APP_BLOCKED')
})

test('package inválido é rejeitado antes do ADB', async () => {
  const { service } = fixture()
  await assert.rejects(
    service.createRemovalPreview({ serial: 'SERIAL-1', packageName: 'rm -rf' }),
    (error) => error.code === 'INVALID_PACKAGE',
  )
})

test('serial inválido é rejeitado antes do ADB', async () => {
  const { service } = fixture()
  await assert.rejects(
    service.createRemovalPreview({ serial: 'SERIAL 1', packageName: 'com.example.app' }),
    (error) => error.code === 'INVALID_DEVICE',
  )
})

test('token válido executa pm uninstall no usuário Android coletado', async () => {
  const { service, state } = fixture()
  const { execution } = await previewAndExecute(service)
  assert.equal(execution.ok, true)
  assert.deepEqual(state.command, ['-s', 'SERIAL-1', 'shell', 'pm', 'uninstall', '--user', '10', 'com.example.app'])
})

test('token expirado não executa comando', async () => {
  const { service, state } = fixture()
  const preview = await service.createRemovalPreview(previewInput)
  state.now += 3 * 60 * 1000
  await assert.rejects(service.executeUninstall({
    serial: 'SERIAL-1', packageName: 'com.example.app', androidUserId: 10,
    confirmationToken: preview.confirmationToken, actionId: preview.actionId,
  }), (error) => error.code === 'CONFIRMATION_EXPIRED')
  assert.equal(state.command, null)
})

test('token é de uso único e reutilização é rejeitada', async () => {
  const { service } = fixture()
  const { preview } = await previewAndExecute(service)
  await assert.rejects(service.executeUninstall({
    serial: 'SERIAL-1', packageName: 'com.example.app', androidUserId: 10,
    confirmationToken: preview.confirmationToken, actionId: preview.actionId,
  }), (error) => error.code === 'ACTION_ALREADY_EXECUTED')
})

for (const [label, field, value, code] of [
  ['outro package', 'packageName', 'com.other.app', 'PACKAGE_MISMATCH'],
  ['outro serial', 'serial', 'SERIAL-2', 'DEVICE_MISMATCH'],
  ['outro Android user', 'androidUserId', 0, 'ANDROID_USER_MISMATCH'],
]) {
  test(`token de ${label} é rejeitado`, async () => {
    const { service } = fixture()
    const preview = await service.createRemovalPreview(previewInput)
    await assert.rejects(service.executeUninstall({
      serial: 'SERIAL-1', packageName: 'com.example.app', androidUserId: 10,
      confirmationToken: preview.confirmationToken, actionId: preview.actionId,
      [field]: value,
    }), (error) => error.code === code)
  })
}

for (const [label, code] of [
  ['unauthorized', ADB_ERROR_CODES.DEVICE_UNAUTHORIZED],
  ['offline', ADB_ERROR_CODES.DEVICE_OFFLINE],
]) {
  test(`dispositivo ${label} bloqueia preview`, async () => {
    const { service } = fixture({ deviceError: createAdbError(code) })
    await assert.rejects(service.createRemovalPreview(previewInput), (error) => error.code === code)
  })
}

test('desconexão antes da ação impede dispatch', async () => {
  const { service, state } = fixture()
  const preview = await service.createRemovalPreview(previewInput)
  state.deviceError = createAdbError(ADB_ERROR_CODES.DEVICE_DISCONNECTED)
  await assert.rejects(service.executeUninstall({
    serial: 'SERIAL-1', packageName: 'com.example.app', androidUserId: 10,
    confirmationToken: preview.confirmationToken, actionId: preview.actionId,
  }), (error) => error.code === ADB_ERROR_CODES.DEVICE_DISCONNECTED && error.actionDispatched === false)
})

test('desconexão durante comando informa que a ação já foi disparada', async () => {
  const { service, state } = fixture()
  const preview = await service.createRemovalPreview(previewInput)
  state.commandError = createAdbError(ADB_ERROR_CODES.DEVICE_DISCONNECTED)
  await assert.rejects(service.executeUninstall({
    serial: 'SERIAL-1', packageName: 'com.example.app', androidUserId: 10,
    confirmationToken: preview.confirmationToken, actionId: preview.actionId,
  }), (error) => error.code === ADB_ERROR_CODES.DEVICE_DISCONNECTED && error.actionDispatched === true)
})

test('mudança de usuário Android na revalidação cancela ação', async () => {
  const { service, state } = fixture()
  const preview = await service.createRemovalPreview(previewInput)
  state.currentUserId = 0
  await assert.rejects(service.executeUninstall({
    serial: 'SERIAL-1', packageName: 'com.example.app', androidUserId: 10,
    confirmationToken: preview.confirmationToken, actionId: preview.actionId,
  }), (error) => error.code === 'ANDROID_USER_CHANGED')
})

test('pacote removido antes da revalidação cancela ação', async () => {
  const { service, state } = fixture()
  const preview = await service.createRemovalPreview(previewInput)
  state.apps = []
  await assert.rejects(service.executeUninstall({
    serial: 'SERIAL-1', packageName: 'com.example.app', androidUserId: 10,
    confirmationToken: preview.confirmationToken, actionId: preview.actionId,
  }), (error) => error.code === 'PACKAGE_NOT_INSTALLED')
})

test('Device Admin ativo bloqueia automação', async () => {
  const { service } = fixture({ admins: [{ packageName: 'com.example.app', userId: 10 }] })
  await assert.rejects(service.createRemovalPreview(previewInput), (error) => error.code === 'DEVICE_ADMIN_ACTIVE')
})

test('finding obsoleto bloqueia preview', async () => {
  const { service } = fixture()
  await assert.rejects(service.createRemovalPreview({
    ...previewInput, finding: { ...previewInput.finding, status: 'resolved' },
  }), (error) => error.code === 'STALE_FINDING')
})

test('finding de accessibility não reutiliza uninstall antigo e exige revisão manual', async () => {
  const { service } = fixture()
  await assert.rejects(service.createRemovalPreview({
    ...previewInput,
    finding: { ...previewInput.finding, ruleId: 'app.accessibility_overlay' },
  }), (error) => error.code === 'ACTION_REQUIRES_MANUAL_REVIEW')
})

test('verificação usa o mesmo usuário e confirma pacote ausente', async () => {
  const { service, state } = fixture()
  state.apps = []
  const result = await service.verifyPackageAbsent({
    serial: 'SERIAL-1', packageName: 'com.example.app', androidUserId: 10,
  })
  assert.deepEqual(result, { status: 'verified', installed: false, source: 'package_manager', user: 10 })
})

test('verificação indisponível retorna resultado inconclusivo estruturado', async () => {
  const { service, state } = fixture()
  state.deviceError = createAdbError(ADB_ERROR_CODES.DEVICE_DISCONNECTED)
  const result = await service.verifyPackageAbsent({
    serial: 'SERIAL-1', packageName: 'com.example.app', androidUserId: 10,
  })
  assert.equal(result.status, 'not_verified')
  assert.equal(result.reason, ADB_ERROR_CODES.DEVICE_DISCONNECTED)
})

test('cancelar preview invalida token antes da execução', async () => {
  const { service } = fixture()
  const preview = await service.createRemovalPreview(previewInput)
  assert.equal(service.cancelPreview({ actionId: preview.actionId, confirmationToken: preview.confirmationToken }), true)
  await assert.rejects(service.executeUninstall({
    serial: 'SERIAL-1', packageName: 'com.example.app', androidUserId: 10,
    confirmationToken: preview.confirmationToken, actionId: preview.actionId,
  }), (error) => error.code === ADB_ERROR_CODES.OPERATION_CANCELED)
})
