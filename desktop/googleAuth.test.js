const assert = require('node:assert/strict')
const test = require('node:test')

test('pacote Electron inclui o módulo Google exigido pelo main', () => {
  const config = require('./electron-builder.cjs')
  assert.ok(config.files.includes('googleAuth.js'))
})

const {
  GoogleDesktopAuthError,
  normalizeApiBaseUrl,
  runGoogleDesktopAuth,
  validateAuthorizationUrl,
} = require('./googleAuth')

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

function startPayload() {
  return {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&scope=openid%20email%20profile&code_challenge_method=S256&client_id=test-client&redirect_uri=https%3A%2F%2Fdiagpro-api.onrender.com%2Fapi%2Fauth%2Fgoogle%2Fcallback%2F&state=test-state&nonce=test-nonce&code_challenge=test-challenge',
    flowId: 'a'.repeat(32),
    pollToken: 'p'.repeat(43),
    codeVerifier: 'v'.repeat(86),
    expiresIn: 60,
  }
}

test('aceita apenas backend oficial e rejeita outros destinos inclusive loopback', () => {
  assert.equal(normalizeApiBaseUrl('https://diagpro-api.onrender.com/'), 'https://diagpro-api.onrender.com')
  assert.throws(() => normalizeApiBaseUrl('http://127.0.0.1:8000'))
  assert.throws(() => normalizeApiBaseUrl('https://api.example.test/'))
  assert.throws(() => normalizeApiBaseUrl('http://api.example.test'))
})

test('aceita somente a autorização Google esperada com PKCE e escopos mínimos', () => {
  assert.match(validateAuthorizationUrl(startPayload().authorizationUrl), /^https:\/\/accounts\.google\.com\//)
  assert.throws(() => validateAuthorizationUrl('https://evil.example/oauth?response_type=code'))
})

test('abre navegador externo, aguarda callback e retorna JWT do DiagPro', async () => {
  const calls = []
  const opened = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: options.body })
    assert.equal(options.redirect, 'error')
    if (url.endsWith('/start/')) return response(200, startPayload())
    if (calls.length === 2) return response(202, { status: 'pending' })
    return response(200, { access: 'access-jwt', refresh: 'refresh-jwt', username: 'google_user' })
  }
  const result = await runGoogleDesktopAuth({
    apiBaseUrl: 'https://diagpro-api.onrender.com', fetchImpl,
    openExternal: async (url) => opened.push(url), pollIntervalMs: 0,
  })
  assert.equal(opened.length, 1)
  assert.equal(result.username, 'google_user')
  assert.equal(JSON.parse(calls[1].body).codeVerifier, startPayload().codeVerifier)
})

test('cancelamento interrompe o polling sem retornar sessão', async () => {
  const controller = new AbortController()
  const auth = runGoogleDesktopAuth({
    apiBaseUrl: 'https://diagpro-api.onrender.com',
    fetchImpl: async () => response(200, startPayload()),
    openExternal: async () => controller.abort(),
    signal: controller.signal,
    pollIntervalMs: 0,
  })
  await assert.rejects(auth, (error) => error instanceof GoogleDesktopAuthError && error.code === 'login_canceled')
})

test('erro seguro do backend é propagado sem detalhes internos', async () => {
  await assert.rejects(
    runGoogleDesktopAuth({
      apiBaseUrl: 'https://diagpro-api.onrender.com',
      fetchImpl: async () => response(503, { code: 'google_not_configured', detail: 'Login indisponível.' }),
      openExternal: async () => {},
    }),
    (error) => error.code === 'google_not_configured' && !error.message.includes('secret'),
  )
})

test('falha de rede vira erro conhecido sem abrir navegador', async () => {
  let opened = false
  await assert.rejects(
    runGoogleDesktopAuth({
      apiBaseUrl: 'https://diagpro-api.onrender.com',
      fetchImpl: async () => { throw new TypeError('network details') },
      openExternal: async () => { opened = true },
    }),
    (error) => error.code === 'backend_unavailable' && !error.message.includes('network details'),
  )
  assert.equal(opened, false)
})

test('destino controlado pelo renderer é rejeitado antes de qualquer acesso de rede', async () => {
  for (const apiBaseUrl of ['https://evil.example', 'https://diagpro-api.onrender.com.evil.example', 'https://diagpro-api.onrender.com/other', 'https://diagpro-api.onrender.com:444']) {
    await assert.rejects(runGoogleDesktopAuth({ apiBaseUrl,
      fetchImpl: async () => assert.fail('não deve acessar rede'),
      openExternal: async () => assert.fail('não deve abrir navegador'),
    }), { code: 'invalid_api_url' })
  }
})

test('callback para outro destino não abre navegador', async () => {
  const payload = startPayload()
  const url = new URL(payload.authorizationUrl)
  url.searchParams.set('redirect_uri', 'https://evil.example/callback')
  payload.authorizationUrl = url.toString()
  await assert.rejects(runGoogleDesktopAuth({ apiBaseUrl: 'https://diagpro-api.onrender.com',
    fetchImpl: async () => response(200, payload),
    openExternal: async () => assert.fail('não deve abrir navegador'),
  }), { code: 'invalid_authorization_url' })
})

test('cancelamento durante a resposta final não entrega sessão', async () => {
  const controller = new AbortController()
  await assert.rejects(runGoogleDesktopAuth({ apiBaseUrl: 'https://diagpro-api.onrender.com',
    signal: controller.signal, pollIntervalMs: 0, openExternal: async () => {},
    fetchImpl: async (url) => {
      if (url.endsWith('/start/')) return response(200, startPayload())
      controller.abort()
      return response(200, { access: 'test-access', refresh: 'test-refresh', username: 'test' })
    },
  }), { code: 'login_canceled' })
})
