const ACCESS_KEY = 'diagpro_access_token'
const REFRESH_KEY = 'diagpro_refresh_token'

export function salvarTokens(access, refresh) {
  localStorage.setItem(ACCESS_KEY, access)
  localStorage.setItem(REFRESH_KEY, refresh)
}

export function limparTokens() {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem('diagpro_username')
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY)
}

export function getAccessToken() {
  return localStorage.getItem(ACCESS_KEY)
}

export async function renovarSessao() {
  const refresh = getRefreshToken()
  if (!refresh) return null

  try {
    const resposta = await fetch('http://127.0.0.1:8000/api/token/refresh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    })

    if (!resposta.ok) {
      limparTokens()
      return null
    }

    const dados = await resposta.json()
    localStorage.setItem(ACCESS_KEY, dados.access)
    return dados.access
  } catch {
    return null
  }
}

export async function fetchAutenticado(url, options = {}, accessToken = null) {
  const executar = (token) => fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  })

  const tokenAtual = accessToken || getAccessToken()
  if (!tokenAtual) throw new Error('Sessão autenticada indisponível.')

  let resposta = await executar(tokenAtual)
  if (resposta.status !== 401) return resposta

  const tokenRenovado = await renovarSessao()
  if (!tokenRenovado) return resposta

  resposta = await executar(tokenRenovado)
  return resposta
}
