export const DEFAULT_API_BASE_URL = 'https://diagpro-api.onrender.com'

export function normalizeApiBaseUrl(value, fallback = DEFAULT_API_BASE_URL) {
  const candidate = String(value || fallback).trim()
  let parsed

  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('A URL base da API do DiagPro é inválida.')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('A URL base da API deve usar HTTP ou HTTPS.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('A URL base da API não pode conter credenciais, consulta ou fragmento.')
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  return parsed.toString().replace(/\/$/, '')
}

export function joinApiUrl(baseUrl, resourcePath) {
  const base = normalizeApiBaseUrl(baseUrl)
  const path = String(resourcePath || '').replace(/^\/+/, '')
  return path ? `${base}/${path}` : base
}
