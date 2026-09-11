import assert from 'node:assert/strict'
import test from 'node:test'

import { cancelGoogleLogin, executeGoogleLogin } from './googleLogin.mjs'

test('clique inicia loading e aplica a mesma sessão JWT respeitando lembrar-me', async () => {
  const loading = []
  const success = []
  const errors = []
  const ok = await executeGoogleLogin({
    bridge: { startGoogleAuth: async () => ({ ok: true, access: 'access', refresh: 'refresh', username: 'user' }) },
    apiBaseUrl: 'https://api.example.test', remember: true,
    onLoading: (value) => loading.push(value), onSuccess: (...args) => success.push(args), onError: (value) => errors.push(value),
  })
  assert.equal(ok, true)
  assert.deepEqual(loading, [true, false])
  assert.deepEqual(success, [['access', 'refresh', 'user', true]])
  assert.deepEqual(errors, [''])
})

test('erro e cancelamento terminam loading sem criar sessão', async () => {
  const loading = []
  const errors = []
  const ok = await executeGoogleLogin({
    bridge: { startGoogleAuth: async () => ({ ok: false, code: 'login_canceled' }) },
    apiBaseUrl: 'https://api.example.test', remember: false,
    onLoading: (value) => loading.push(value), onSuccess: () => assert.fail('não deve autenticar'), onError: (value) => errors.push(value),
  })
  assert.equal(ok, false)
  assert.deepEqual(loading, [true, false])
  assert.equal(errors.at(-1), 'Login com Google cancelado.')
})

test('botão de cancelamento usa somente o canal específico do bridge', async () => {
  let canceled = false
  await cancelGoogleLogin({ cancelGoogleAuth: async () => { canceled = true } })
  assert.equal(canceled, true)
})
