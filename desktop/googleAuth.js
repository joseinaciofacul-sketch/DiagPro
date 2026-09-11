const GOOGLE_AUTH_ORIGIN = 'https://accounts.google.com'
const GOOGLE_AUTH_PATH = '/o/oauth2/v2/auth'
const DIAGPRO_API_BASE_URL = 'https://diagpro-api.onrender.com'

class GoogleDesktopAuthError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function normalizeApiBaseUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new GoogleDesktopAuthError('invalid_api_url', 'A configuração da API é inválida.')
  }
  const local = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !local) {
    throw new GoogleDesktopAuthError('invalid_api_url', 'A API do login Google deve usar HTTPS.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new GoogleDesktopAuthError('invalid_api_url', 'A configuração da API é inválida.')
  }
  const normalized = parsed.toString().replace(/\/$/, '')
  if (normalized !== DIAGPRO_API_BASE_URL) {
    throw new GoogleDesktopAuthError('invalid_api_url', 'O login Google aceita somente a API oficial do DiagPro.')
  }
  return normalized
}

function validateAuthorizationUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new GoogleDesktopAuthError('invalid_authorization_url', 'O endereço de autenticação recebido é inválido.')
  }
  const scopes = new Set((parsed.searchParams.get('scope') || '').split(/\s+/).filter(Boolean))
  const valid = parsed.origin === GOOGLE_AUTH_ORIGIN
    && parsed.pathname === GOOGLE_AUTH_PATH
    && parsed.searchParams.get('response_type') === 'code'
    && parsed.searchParams.get('code_challenge_method') === 'S256'
    && scopes.size === 3
    && ['openid', 'email', 'profile'].every((scope) => scopes.has(scope))
    && ['client_id', 'redirect_uri', 'state', 'nonce', 'code_challenge']
      .every((name) => Boolean(parsed.searchParams.get(name)))
  if (!valid) {
    throw new GoogleDesktopAuthError('invalid_authorization_url', 'O endereço de autenticação recebido não é permitido.')
  }
  return parsed.toString()
}

function safeJson(response) {
  return response.json().catch(() => ({}))
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new GoogleDesktopAuthError('login_canceled', 'Login com Google cancelado.'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

function validateStartPayload(payload) {
  const validFlow = typeof payload.flowId === 'string' && /^[0-9a-f]{32}$/.test(payload.flowId)
  const validSecrets = [payload.pollToken, payload.codeVerifier]
    .every((value) => typeof value === 'string' && value.length >= 40 && value.length <= 160)
  if (!validFlow || !validSecrets) {
    throw new GoogleDesktopAuthError('invalid_backend_response', 'A API retornou uma resposta de autenticação inválida.')
  }
  return payload
}

async function runGoogleDesktopAuth({
  apiBaseUrl,
  fetchImpl = fetch,
  openExternal,
  signal,
  pollIntervalMs = 1000,
}) {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl)
  let response
  try {
    response = await fetchImpl(`${baseUrl}/api/auth/google/start/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    })
  } catch (error) {
    if (signal?.aborted) throw new GoogleDesktopAuthError('login_canceled', 'Login com Google cancelado.')
    throw new GoogleDesktopAuthError('backend_unavailable', 'Não foi possível conectar à API do DiagPro.')
  }
  const startPayload = await safeJson(response)
  if (!response.ok) {
    throw new GoogleDesktopAuthError(startPayload.code || 'google_auth_failed', startPayload.detail || 'Login com Google indisponível.')
  }
  validateStartPayload(startPayload)
  const authorizationUrl = validateAuthorizationUrl(startPayload.authorizationUrl)
  if (new URL(authorizationUrl).searchParams.get('redirect_uri') !== `${baseUrl}/api/auth/google/callback/`) {
    throw new GoogleDesktopAuthError('invalid_authorization_url', 'Callback de autenticação inválido.')
  }
  if (signal?.aborted) throw new GoogleDesktopAuthError('login_canceled', 'Login com Google cancelado.')
  await openExternal(authorizationUrl)

  const deadline = Date.now() + Math.min(Number(startPayload.expiresIn) || 300, 900) * 1000
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new GoogleDesktopAuthError('login_canceled', 'Login com Google cancelado.')
    await wait(pollIntervalMs, signal)
    try {
      response = await fetchImpl(`${baseUrl}/api/auth/google/complete/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowId: startPayload.flowId,
          pollToken: startPayload.pollToken,
          codeVerifier: startPayload.codeVerifier,
        }),
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      })
    } catch {
      if (signal?.aborted) throw new GoogleDesktopAuthError('login_canceled', 'Login com Google cancelado.')
      throw new GoogleDesktopAuthError('backend_unavailable', 'Não foi possível conectar à API do DiagPro.')
    }
    const payload = await safeJson(response)
    if (signal?.aborted) throw new GoogleDesktopAuthError('login_canceled', 'Login com Google cancelado.')
    if (Date.now() >= deadline) break
    if (response.status === 202) continue
    if (!response.ok) {
      throw new GoogleDesktopAuthError(payload.code || 'google_auth_failed', payload.detail || 'Não foi possível entrar com Google.')
    }
    if (![payload.access, payload.refresh, payload.username].every((value) => typeof value === 'string' && value.length > 0)) {
      throw new GoogleDesktopAuthError('invalid_backend_response', 'A API retornou uma sessão inválida.')
    }
    return payload
  }
  throw new GoogleDesktopAuthError('flow_expired', 'O tempo para entrar com Google expirou.')
}

module.exports = {
  GoogleDesktopAuthError,
  normalizeApiBaseUrl,
  runGoogleDesktopAuth,
  validateAuthorizationUrl,
}
