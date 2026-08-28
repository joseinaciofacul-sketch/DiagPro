import { fetchAutenticado } from '../utils/auth.js'

const DIAGNOSTICS_URL = 'http://127.0.0.1:8000/api/diagnosticos/'

function criarPayloadDiagnostico(resultado, serial) {
  const device = resultado?.device || resultado?.system || {}
  const health = resultado?.health || {}
  const apps = resultado?.apps

  return {
    serial,
    fabricante: device.manufacturer || '',
    modelo: device.model || '',
    versao_android: device.androidVersion || '',
    sdk: device.sdk ?? null,
    security_patch: resultado?.security?.securityPatch ?? device.securityPatch ?? null,
    modo: resultado?.mode,
    modulos: resultado?.modules,
    iniciado_em: resultado?.startedAt,
    finalizado_em: resultado?.finishedAt,
    health_available: health.available ?? null,
    health_score: health.score ?? null,
    health_label: health.label || '',
    health_explanation: health.explanation || '',
    bateria: resultado?.battery ?? null,
    armazenamento: resultado?.storage ?? null,
    memoria: resultado?.memory ?? null,
    apps: apps
      ? {
          total: apps.total ?? null,
          userTotal: apps.userTotal ?? null,
          systemTotal: apps.systemTotal ?? null,
        }
      : null,
    warnings: resultado?.warnings || [],
    stages: resultado?.stages || {},
    resultado_tecnico: resultado,
  }
}

async function lerResposta(resposta) {
  try {
    return await resposta.json()
  } catch {
    return null
  }
}

function criarErroApi(resposta, dados, mensagem) {
  const erro = new Error(mensagem)
  erro.status = resposta.status
  erro.details = dados
  return erro
}

export async function salvarDiagnostico(resultado, { serial, accessToken } = {}) {
  const resposta = await fetchAutenticado(DIAGNOSTICS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(criarPayloadDiagnostico(resultado, serial)),
  }, accessToken)
  const dados = await lerResposta(resposta)

  if (!resposta.ok) {
    throw criarErroApi(resposta, dados, 'Não foi possível salvar o diagnóstico no histórico.')
  }

  return dados
}

export async function listarDiagnosticos({ accessToken } = {}) {
  const resposta = await fetchAutenticado(DIAGNOSTICS_URL, {}, accessToken)
  const dados = await lerResposta(resposta)
  if (!resposta.ok) {
    throw criarErroApi(resposta, dados, 'Não foi possível carregar o histórico de diagnósticos.')
  }
  return dados
}

export async function obterDiagnostico(id, { accessToken } = {}) {
  const resposta = await fetchAutenticado(`${DIAGNOSTICS_URL}${encodeURIComponent(id)}/`, {}, accessToken)
  const dados = await lerResposta(resposta)
  if (!resposta.ok) {
    throw criarErroApi(resposta, dados, 'Não foi possível carregar o diagnóstico.')
  }
  return dados
}

export async function associarClienteAoDiagnostico(id, clienteId, { accessToken } = {}) {
  const resposta = await fetchAutenticado(
    `${DIAGNOSTICS_URL}${encodeURIComponent(id)}/cliente/`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: clienteId }),
    },
    accessToken,
  )
  const dados = await lerResposta(resposta)
  if (!resposta.ok) {
    throw criarErroApi(resposta, dados, 'Não foi possível associar o cliente ao diagnóstico.')
  }
  return dados
}
