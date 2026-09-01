const crypto = require('crypto')
const { ADB_ERROR_CODES } = require('../adb/adbErrors')

function criarErro(codigo, mensagem) {
  const erro = new Error(mensagem)
  erro.codigo = codigo
  erro.code = codigo
  return erro
}

function resultadoPorErro(error) {
  const code = error?.code || error?.codigo || 'UNINSTALL_FAILED'
  const dispatched = error?.actionDispatched === true
  if (code === ADB_ERROR_CODES.DEVICE_UNAUTHORIZED) return 'not_authorized'
  if ([ADB_ERROR_CODES.DEVICE_DISCONNECTED, ADB_ERROR_CODES.DEVICE_NOT_FOUND, ADB_ERROR_CODES.DEVICE_OFFLINE].includes(code)) {
    return 'device_disconnected'
  }
  if (code === ADB_ERROR_CODES.COMMAND_NOT_SUPPORTED) return 'not_supported'
  if ([ADB_ERROR_CODES.OPERATION_CANCELED, ADB_ERROR_CODES.SCAN_ABORTED].includes(code)) {
    return dispatched ? 'inconclusive' : 'canceled'
  }
  return 'failed'
}

function criarExecutorRemediacao({
  uninstall,
  verify,
  now = () => new Date().toISOString(),
  createExecutionId = () => crypto.randomUUID(),
}) {
  if (typeof uninstall !== 'function' || typeof verify !== 'function') {
    throw new TypeError('Executor de remediação requer funções uninstall e verify.')
  }
  const activePackages = new Set()
  const consumedTokens = new Set()

  async function execute({
    serial,
    packageName,
    androidUserId,
    confirmationToken,
    actionId = null,
    findingId = null,
    projectionId = null,
    signal = null,
    onTransition = () => {},
  } = {}) {
    if (!confirmationToken) {
      throw criarErro('CONFIRMATION_REQUIRED', 'O confirmationToken é obrigatório para remover o aplicativo.')
    }
    if (consumedTokens.has(confirmationToken)) {
      throw criarErro('ACTION_ALREADY_EXECUTED', 'Esta confirmação já foi utilizada.')
    }
    const packageKey = `${serial}:${androidUserId}:${packageName}`
    if (activePackages.has(packageKey)) {
      throw criarErro('REMEDIATION_IN_PROGRESS', 'Já existe uma correção em andamento para este aplicativo.')
    }

    consumedTokens.add(confirmationToken)
    activePackages.add(packageKey)
    const startedAt = now()
    const executionId = actionId || createExecutionId()
    const transitions = [{ status: 'remediation_pending', at: startedAt }]
    const emit = (status) => {
      const transition = { status, at: now() }
      transitions.push(transition)
      try { onTransition({ actionId: executionId, status, at: transition.at }) } catch { /* interface não pode interromper ADB */ }
      return transition
    }
    const base = {
      executionId,
      actionId: executionId,
      findingId,
      projectionId,
      action: 'uninstall_user_app',
      device: { serial },
      androidUser: androidUserId,
      packageName,
      startedAt,
      logicalCommand: Number.isInteger(androidUserId)
        ? `pm uninstall --user ${androidUserId} ${packageName}`
        : null,
      actionDispatched: false,
      transitions,
    }

    try {
      emit('executing')
      let execution
      try {
        execution = await uninstall({
          serial, packageName, androidUserId, confirmationToken, actionId: executionId, signal,
        })
        if (execution?.ok !== true) {
          const error = criarErro(execution?.code || 'UNINSTALL_FAILED', execution?.message || 'O Android não confirmou a remoção.')
          error.actionDispatched = execution?.actionDispatched === true
          error.remediationContext = execution?.auditContext || null
          throw error
        }
      } catch (error) {
        const status = resultadoPorErro(error)
        const finishedAt = now()
        transitions.push({ status, at: finishedAt })
        const context = error?.remediationContext || {}
        const remediation = {
          ...base,
          ...context,
          executionId,
          actionId: executionId,
          findingId: findingId || context.findingId || null,
          projectionId: projectionId || context.projectionId || null,
          finishedAt,
          status,
          actionDispatched: error?.actionDispatched === true,
          adbResult: {
            status,
            code: error?.code || error?.codigo || 'UNINSTALL_FAILED',
            output: null,
            actionDispatched: error?.actionDispatched === true,
          },
          verification: { status: 'not_verified', installed: null, source: 'package_manager', user: androidUserId ?? null },
          error: { code: error?.code || error?.codigo || 'UNINSTALL_FAILED', message: error?.message || 'A remoção falhou.' },
        }
        return {
          ok: false, actionId: executionId, type: 'uninstall_user_app', status,
          startedAt, finishedAt, adbResult: remediation.adbResult,
          verification: remediation.verification, error: remediation.error, remediation,
          message: remediation.error.message,
        }
      }

      emit('verifying')
      let verification
      try {
        verification = await verify({ serial, packageName, androidUserId, signal })
      } catch (error) {
        verification = {
          status: 'not_verified', installed: null, source: 'package_manager',
          user: androidUserId ?? null, reason: error?.code || error?.codigo || 'VERIFICATION_UNAVAILABLE',
        }
      }
      const auditStatus = verification?.status !== 'verified'
        ? 'inconclusive'
        : verification.installed === false
          ? 'resolved'
          : 'verification_failed'
      const resultStatus = auditStatus === 'resolved' ? 'success' : auditStatus
      const finishedAt = now()
      transitions.push({ status: auditStatus, at: finishedAt })
      const context = execution.auditContext || {}
      const remediation = {
        ...base,
        ...context,
        executionId,
        actionId: executionId,
        findingId: findingId || context.findingId || null,
        projectionId: projectionId || context.projectionId || null,
        finishedAt,
        status: auditStatus,
        actionDispatched: true,
        adbResult: execution.adbResult || { status: 'success', code: 'SUCCESS', output: 'Success', actionDispatched: true },
        verification,
        error: auditStatus === 'resolved' ? null : {
          code: auditStatus === 'verification_failed' ? 'PACKAGE_STILL_INSTALLED' : (verification?.reason || 'VERIFICATION_UNAVAILABLE'),
          message: auditStatus === 'verification_failed'
            ? 'O pacote ainda aparece instalado para o mesmo usuário Android.'
            : 'Não foi possível confirmar a ausência do pacote.',
        },
      }
      const message = auditStatus === 'resolved'
        ? 'Aplicativo removido e ausência confirmada pelo Package Manager.'
        : auditStatus === 'verification_failed'
          ? 'O comando terminou, mas o pacote ainda aparece instalado para o usuário Android.'
          : 'O comando terminou, mas a verificação posterior foi inconclusiva.'

      return {
        ok: auditStatus === 'resolved', actionId: executionId, type: 'uninstall_user_app',
        status: resultStatus, startedAt, finishedAt, packageName, message,
        adbResult: remediation.adbResult, verification, error: remediation.error, remediation,
      }
    } finally {
      activePackages.delete(packageKey)
    }
  }

  return { execute }
}

module.exports = { criarExecutorRemediacao, resultadoPorErro }
