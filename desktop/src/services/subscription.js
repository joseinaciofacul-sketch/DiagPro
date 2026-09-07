import { fetchAutenticado } from '../utils/auth.js'
import { apiUrl } from '../config/api.js'

const SUBSCRIPTION_URL = apiUrl('/api/assinatura/')
const CHECKOUT_URL = apiUrl('/api/assinatura/checkout/')
const PLANS_URL = apiUrl('/api/planos/')

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

async function request(url, accessToken, message) {
  const response = await fetchAutenticado(url, {}, accessToken)
  const data = await parseResponse(response)
  if (!response.ok) throw apiError(response, data, message)
  return data
}

export function getCurrentSubscription({ accessToken } = {}) {
  return request(SUBSCRIPTION_URL, accessToken, 'Não foi possível carregar a assinatura atual.')
}

export async function getDiagnosticCapability({ accessToken } = {}) {
  const data = await getCurrentSubscription({ accessToken })
  const capability = data?.capacidade_diagnostico
  if (!capability || typeof capability.allowed !== 'boolean' || !capability.code) {
    throw new Error('A API não retornou uma verificação de licença válida.')
  }
  return capability
}

export function listAvailablePlans({ accessToken } = {}) {
  return request(PLANS_URL, accessToken, 'Não foi possível carregar os planos disponíveis.')
}

export async function createSubscriptionCheckout(planId, { accessToken } = {}) {
  const response = await fetchAutenticado(CHECKOUT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plano_id: planId }),
  }, accessToken)
  const data = await parseResponse(response)
  if (!response.ok) {
    throw apiError(response, data, data?.message || 'Não foi possível iniciar o checkout.')
  }
  if (!data?.checkout_url || !data?.pagamento_id) {
    throw new Error('O backend não retornou um checkout válido.')
  }
  return data
}
