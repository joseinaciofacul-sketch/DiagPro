function criarErro(codigo, mensagem) {
  const erro = new Error(mensagem)
  erro.codigo = codigo
  return erro
}

function criarExecutorRemediacao({ uninstall, verify, now = () => new Date().toISOString() }) {
  if (typeof uninstall !== 'function' || typeof verify !== 'function') {
    throw new TypeError('Executor de remediação requer funções uninstall e verify.')
  }
  const activePackages = new Set()
  const consumedTokens = new Set()

  async function execute({ serial, packageName, confirmationToken, findingId = null } = {}) {
    if (!confirmationToken) {
      throw criarErro('CONFIRMATION_REQUIRED', 'O confirmationToken é obrigatório para remover o aplicativo.')
    }
    if (consumedTokens.has(confirmationToken)) {
      throw criarErro('ACTION_ALREADY_EXECUTED', 'Esta confirmação já foi utilizada.')
    }
    const packageKey = `${serial}:${packageName}`
    if (activePackages.has(packageKey)) {
      throw criarErro('REMEDIATION_IN_PROGRESS', 'Já existe uma correção em andamento para este aplicativo.')
    }

    consumedTokens.add(confirmationToken)
    activePackages.add(packageKey)
    const startedAt = now()
    const transitions = [{ status: 'executing', at: startedAt }]
    const base = {
      findingId,
      action: 'uninstall_user_app',
      packageName,
      startedAt,
      transitions,
    }

    try {
      let execution
      try {
        execution = await uninstall({ serial, packageName, confirmationToken })
      } catch (erro) {
        const finishedAt = now()
        transitions.push({ status: 'failed', at: finishedAt })
        return {
          ok: false,
          status: 'failed',
          message: erro.message || 'A remoção do aplicativo falhou.',
          verification: { status: 'not_verified', installed: null },
          remediation: { ...base, finishedAt, status: 'failed', verification: { status: 'not_verified', installed: null } },
        }
      }
      if (execution?.ok !== true) {
        const finishedAt = now()
        transitions.push({ status: 'failed', at: finishedAt })
        return {
          ok: false,
          status: 'failed',
          message: execution?.message || 'O Android não confirmou a remoção.',
          verification: { status: 'not_verified', installed: null },
          remediation: { ...base, finishedAt, status: 'failed', verification: { status: 'not_verified', installed: null } },
        }
      }

      transitions.push({ status: 'verifying', at: now() })
      let verification
      try {
        verification = await verify({ serial, packageName })
      } catch {
        verification = { status: 'not_verified', installed: null }
      }

      const status = verification?.status !== 'verified'
        ? 'not_verified'
        : verification.installed === false
          ? 'resolved'
          : 'failed'
      const finishedAt = now()
      transitions.push({ status, at: finishedAt })
      const message = status === 'resolved'
        ? 'Aplicativo removido e ausência confirmada pelo Package Manager.'
        : status === 'failed'
          ? 'O comando terminou, mas o pacote ainda aparece instalado para o usuário.'
          : 'O comando terminou, mas não foi possível verificar a ausência do pacote.'

      return {
        ok: status === 'resolved',
        status,
        packageName,
        message,
        verification,
        remediation: { ...base, finishedAt, status, verification },
      }
    } finally {
      activePackages.delete(packageKey)
    }
  }

  return { execute }
}

module.exports = { criarExecutorRemediacao }
