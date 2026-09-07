import { fetchAutenticado } from '../utils/auth.js'
import { apiUrl } from '../config/api.js'

const CLIENTS_URL = apiUrl('/api/clientes/')

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

export function listarClientes({ accessToken } = {}) {
  return request(CLIENTS_URL, {}, accessToken, 'Não foi possível carregar os clientes.')
}

export function obterCliente(id, { accessToken } = {}) {
  return request(`${CLIENTS_URL}${encodeURIComponent(id)}/`, {}, accessToken, 'Não foi possível carregar o cliente.')
}

export function criarCliente(payload, { accessToken } = {}) {
  return request(CLIENTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, accessToken, 'Não foi possível cadastrar o cliente.')
}

export function editarCliente(id, payload, { accessToken } = {}) {
  return request(`${CLIENTS_URL}${encodeURIComponent(id)}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, accessToken, 'Não foi possível atualizar o cliente.')
}
