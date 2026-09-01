const test = require('node:test')
const assert = require('node:assert/strict')
const { planejarRemediacaoFinding } = require('./remediationPlanner')
const { criarExecutorRemediacao, resultadoPorErro } = require('./remediationExecutor')

const appFinding = {
  id: 'app.sensitive_capabilities.com.example.app',
  packageName: 'com.example.app',
  severity: 'medium',
}

test('finding de app de usuário oferece uninstall seguro', () => {
  const action = planejarRemediacaoFinding(appFinding, [{ packageName: 'com.example.app', type: 'user' }])
  assert.equal(action.type, 'uninstall_user_app')
  assert.equal(action.availability, 'available')
  assert.equal(action.requiresConfirmation, true)
  assert.equal(action.verification.type, 'package_absent_for_user')
})

test('app de sistema nunca oferece uninstall', () => {
  const action = planejarRemediacaoFinding(appFinding, [{ packageName: 'com.example.app', type: 'system' }])
  assert.equal(action.type, 'manual_review')
  assert.equal(action.availability, 'available')
  assert.equal(action.requiresConfirmation, false)
})

test('finding sem packageName não oferece uninstall', () => {
  const action = planejarRemediacaoFinding({ id: 'device.unknown', packageName: null }, [])
  assert.equal(action.type, 'no_action')
})

test('patch antigo gera somente orientação manual', () => {
  const action = planejarRemediacaoFinding({ id: 'device.security_patch_age', packageName: null }, [])
  assert.equal(action.type, 'manual_security_setting')
  assert.equal(action.requiresConfirmation, false)
  assert.match(action.guidance, /atualização de segurança/i)
})

test('root detectado não oferece remoção automática', () => {
  const action = planejarRemediacaoFinding({ id: 'device.su_binary_accessible', packageName: null }, [])
  assert.equal(action.type, 'manual_review')
  assert.equal(action.availability, 'available')
  assert.match(action.reasonUnavailable, /remoção de root/i)
})

test('confirmationToken é obrigatório', async () => {
  const executor = criarExecutorRemediacao({
    uninstall: async () => ({ ok: true }),
    verify: async () => ({ status: 'verified', installed: false }),
  })
  await assert.rejects(
    executor.execute({ serial: 'serial', packageName: 'com.example.app' }),
    (erro) => erro.codigo === 'CONFIRMATION_REQUIRED',
  )
})

test('falha de execução nunca vira resolved', async () => {
  const executor = criarExecutorRemediacao({
    uninstall: async () => { throw new Error('falha real') },
    verify: async () => ({ status: 'verified', installed: false }),
  })
  const result = await executor.execute({ serial: 'serial', packageName: 'com.example.app', confirmationToken: 'token-fail' })
  assert.equal(result.status, 'failed')
  assert.equal(result.ok, false)
})

test('uninstall seguido de pacote ausente resulta em resolved', async () => {
  const executor = criarExecutorRemediacao({
    uninstall: async () => ({ ok: true }),
    verify: async () => ({ status: 'verified', installed: false }),
  })
  const result = await executor.execute({ serial: 'serial', packageName: 'com.example.app', confirmationToken: 'token-ok' })
  assert.equal(result.status, 'success')
  assert.equal(result.remediation.status, 'resolved')
  assert.equal(result.verification.installed, false)
  assert.match(result.remediation.executionId, /^[0-9a-f-]{36}$/i)
  assert.ok(result.remediation.transitions.some((transition) => transition.status === 'verifying'))
})

test('cada execução recebe identificador único mesmo para o mesmo pacote', async () => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
  const executor = criarExecutorRemediacao({
    uninstall: async () => ({ ok: true }),
    verify: async () => ({ status: 'verified', installed: false }),
    createExecutionId: () => ids.shift(),
  })

  const primeira = await executor.execute({ serial: 'serial', packageName: 'com.example.app', confirmationToken: 'token-one' })
  const segunda = await executor.execute({ serial: 'serial', packageName: 'com.example.app', confirmationToken: 'token-two' })

  assert.equal(primeira.remediation.executionId, '11111111-1111-4111-8111-111111111111')
  assert.equal(segunda.remediation.executionId, '22222222-2222-4222-8222-222222222222')
})

test('pacote ainda instalado após uninstall resulta em failed', async () => {
  const executor = criarExecutorRemediacao({
    uninstall: async () => ({ ok: true }),
    verify: async () => ({ status: 'verified', installed: true }),
  })
  const result = await executor.execute({ serial: 'serial', packageName: 'com.example.app', confirmationToken: 'token-still-installed' })
  assert.equal(result.status, 'verification_failed')
  assert.equal(result.remediation.status, 'verification_failed')
  assert.equal(result.verification.installed, true)
})

test('impossibilidade de verificar resulta em inconclusive', async () => {
  const executor = criarExecutorRemediacao({
    uninstall: async () => ({ ok: true }),
    verify: async () => { throw new Error('dispositivo desconectado') },
  })
  const result = await executor.execute({ serial: 'serial', packageName: 'com.example.app', confirmationToken: 'token-unverified' })
  assert.equal(result.status, 'inconclusive')
  assert.equal(result.remediation.status, 'inconclusive')
  assert.equal(result.ok, false)
})

test('execução duplicada simultânea é bloqueada logicamente', async () => {
  let liberar
  const espera = new Promise((resolve) => { liberar = resolve })
  const executor = criarExecutorRemediacao({
    uninstall: async () => { await espera; return { ok: true } },
    verify: async () => ({ status: 'verified', installed: false }),
  })
  const primeira = executor.execute({ serial: 'serial', packageName: 'com.example.app', confirmationToken: 'token-first' })
  await assert.rejects(
    executor.execute({ serial: 'serial', packageName: 'com.example.app', confirmationToken: 'token-second' }),
    (erro) => erro.codigo === 'REMEDIATION_IN_PROGRESS',
  )
  liberar()
  assert.equal((await primeira).status, 'success')
})

test('confirmationToken consumido não pode ser reutilizado', async () => {
  const executor = criarExecutorRemediacao({
    uninstall: async () => ({ ok: true }),
    verify: async () => ({ status: 'verified', installed: false }),
  })
  const args = { serial: 'serial', packageName: 'com.example.app', confirmationToken: 'single-use-token' }
  await executor.execute(args)
  await assert.rejects(executor.execute(args), (erro) => erro.codigo === 'ACTION_ALREADY_EXECUTED')
})

test('Device Admin recebe revisão manual específica', () => {
  const action = planejarRemediacaoFinding({
    ...appFinding, ruleId: 'app.device_admin.untrusted_context',
    category: 'device_administrator_context', remediation: { type: 'manual_guidance' },
  }, [{ packageName: 'com.example.app', type: 'user' }])
  assert.equal(action.type, 'manual_device_admin_review')
  assert.match(action.guidance, /administração do dispositivo/i)
})

test('accessibility recebe revisão manual e rescan', () => {
  const action = planejarRemediacaoFinding({
    ...appFinding, ruleId: 'app.accessibility_overlay', remediation: { type: 'uninstall_user_app' },
  }, [{ packageName: 'com.example.app', type: 'user' }])
  assert.equal(action.type, 'manual_accessibility_review')
  assert.equal(action.verification.type, 'rescan_after_manual_action')
})

test('overlay isolado recebe revisão manual sem alterar AppOps', () => {
  const action = planejarRemediacaoFinding({
    ...appFinding, ruleId: 'app.overlay.review', remediation: { type: 'manual_guidance' },
  }, [{ packageName: 'com.example.app', type: 'user' }])
  assert.equal(action.type, 'manual_overlay_review')
  assert.match(action.guidance, /não altera AppOps/i)
})

test('cancelamento antes do dispatch retorna canceled', async () => {
  const error = new Error('cancelada')
  error.code = 'OPERATION_CANCELED'
  error.actionDispatched = false
  const executor = criarExecutorRemediacao({
    uninstall: async () => { throw error },
    verify: async () => ({ status: 'verified', installed: false }),
  })
  const result = await executor.execute({ serial: 'serial', packageName: 'com.example.app', androidUserId: 10, confirmationToken: 'cancel-before' })
  assert.equal(result.status, 'canceled')
  assert.equal(result.remediation.actionDispatched, false)
})

test('cancelamento após dispatch retorna inconclusive sem fingir reversão', async () => {
  const error = new Error('cancelada')
  error.code = 'OPERATION_CANCELED'
  error.actionDispatched = true
  const executor = criarExecutorRemediacao({
    uninstall: async () => { throw error },
    verify: async () => ({ status: 'verified', installed: false }),
  })
  const result = await executor.execute({ serial: 'serial', packageName: 'com.example.app', androidUserId: 10, confirmationToken: 'cancel-after' })
  assert.equal(result.status, 'inconclusive')
  assert.equal(result.remediation.actionDispatched, true)
})

test('erros operacionais preservam estados distintos', () => {
  assert.equal(resultadoPorErro({ code: 'DEVICE_UNAUTHORIZED' }), 'not_authorized')
  assert.equal(resultadoPorErro({ code: 'DEVICE_OFFLINE' }), 'device_disconnected')
  assert.equal(resultadoPorErro({ code: 'DEVICE_DISCONNECTED' }), 'device_disconnected')
  assert.equal(resultadoPorErro({ code: 'COMMAND_NOT_SUPPORTED' }), 'not_supported')
  assert.equal(resultadoPorErro({ code: 'UNINSTALL_FAILED' }), 'failed')
})
