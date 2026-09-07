import { fetchAutenticado } from '../utils/auth.js'
import { apiUrl } from '../config/api.js'

const ME_URL = apiUrl('/api/me/')
const PASSWORD_URL = apiUrl('/api/me/password/')
const COMPANIES_URL = apiUrl('/api/empresas/')

async function parseResponse(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function apiError(response, details, message) {
  const error = new Error(message)
  error.status = response.status
  error.details = details
  return error
}

async function request(url, options, accessToken, message) {
  const response = await fetchAutenticado(url, options, accessToken)
  const data = await parseResponse(response)
  if (!response.ok) throw apiError(response, data, message)
  return data
}

export function getCurrentUser({ accessToken } = {}) {
  return request(ME_URL, {}, accessToken, 'Não foi possível carregar os dados da conta.')
}

export function updateCurrentUser(payload, { accessToken } = {}) {
  return request(ME_URL, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, accessToken, 'Não foi possível atualizar os dados da conta.')
}

export function changeCurrentPassword(payload, { accessToken } = {}) {
  return request(PASSWORD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, accessToken, 'Não foi possível alterar a senha.')
}

export function listCurrentCompanies({ accessToken } = {}) {
  return request(COMPANIES_URL, {}, accessToken, 'Não foi possível carregar os dados da assistência.')
}

export function createCurrentCompany(payload, { accessToken } = {}) {
  return request(COMPANIES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, accessToken, 'Não foi possível salvar os dados da assistência.')
}

export function updateCurrentCompany(id, payload, { accessToken } = {}) {
  return request(`${COMPANIES_URL}${encodeURIComponent(id)}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, accessToken, 'Não foi possível atualizar os dados da assistência.')
}
