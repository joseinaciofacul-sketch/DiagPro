const errorMessages = {
  account_link_required: 'Já existe uma conta com este e-mail. Entre com sua senha; o vínculo Google não é automático.',
  account_not_authorized: 'Esta conta Google não está autorizada.',
  auth_temporarily_unavailable: 'O serviço de autenticação está temporariamente indisponível.',
  backend_unavailable: 'Não foi possível conectar à API do DiagPro.',
  email_not_verified: 'O e-mail da conta Google não foi verificado.',
  flow_already_used: 'Esta autenticação Google já foi utilizada.',
  flow_expired: 'O tempo para entrar com Google expirou. Tente novamente.',
  google_auth_in_progress: 'Um login com Google já está em andamento.',
  google_not_configured: 'Login com Google ainda não está disponível.',
  google_unavailable: 'O Google está temporariamente indisponível.',
  invalid_google_token: 'A resposta do Google não pôde ser validada.',
  invalid_nonce: 'A resposta do Google não pôde ser validada.',
  invalid_request: 'A solicitação de login Google é inválida.',
  login_canceled: 'Login com Google cancelado.',
}

export async function executeGoogleLogin({ bridge, apiBaseUrl, remember, onLoading, onSuccess, onError }) {
  onError('')
  onLoading(true)
  try {
    const result = await bridge.startGoogleAuth({ apiBaseUrl })
    if (!result?.ok) {
      onError(errorMessages[result?.code] || result?.message || 'Não foi possível entrar com Google.')
      return false
    }
    onSuccess(result.access, result.refresh, result.username, remember)
    return true
  } catch {
    onError('Não foi possível iniciar o login com Google.')
    return false
  } finally {
    onLoading(false)
  }
}

export async function cancelGoogleLogin(bridge) {
  await bridge.cancelGoogleAuth()
}
