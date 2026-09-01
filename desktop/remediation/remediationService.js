const crypto = require('crypto')
const { ADB_ERROR_CODES, createAdbError } = require('../adb/adbErrors')
const { isValidSerial } = require('../adb/adbClient')
const { validPackageName } = require('../security/parsers/packageParsers')

const ACTION_TYPE = 'uninstall_user_app'
const DEFAULT_TOKEN_TTL_MS = 2 * 60 * 1000

function remediationError(code, message, context = null) {
  const error = createAdbError(code, message)
  error.remediationContext = context
  return error
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function validAndroidUserId(value) {
  return Number.isInteger(value) && value >= 0
}

function findingIsStale(finding) {
  return finding && ['resolved', 'dismissed', 'remediation_pending'].includes(finding.status)
}

function adminForPackage(admins, packageName, androidUserId) {
  const values = Array.isArray(admins?.value) ? admins.value : []
  return values.find((item) => item?.packageName === packageName
    && (item.userId === null || item.userId === undefined || item.userId === androidUserId)) || null
}

function packageListed(output, packageName) {
  return String(output || '').split(/\r?\n/)
    .map((line) => line.trim().replace(/^package:/, '').split(/\s+/)[0])
    .some((item) => item === packageName)
}

function createRemediationService({
  listInstalledApps,
  validateDevice,
  runAdb,
  collectDeviceAdmins = async () => ({ status: 'not_available', value: [] }),
  getDeviceInfo = async (serial) => ({ serial }),
  now = () => Date.now(),
  createActionId = () => crypto.randomUUID(),
  createTokenId = () => crypto.randomUUID(),
  createToken = () => crypto.randomBytes(32).toString('base64url'),
  tokenTtlMs = DEFAULT_TOKEN_TTL_MS,
} = {}) {
  if (typeof listInstalledApps !== 'function' || typeof validateDevice !== 'function' || typeof runAdb !== 'function') {
    throw new TypeError('O serviço de remediação requer listInstalledApps, validateDevice e runAdb.')
  }

  const previewsByTokenHash = new Map()
  const consumedTokenHashes = new Set()
  const canceledTokenHashes = new Set()

  function safeContext(record) {
    return {
      actionId: record.actionId,
      findingId: record.findingId,
      projectionId: record.projectionId,
      action: ACTION_TYPE,
      device: record.preview.device,
      androidUser: record.androidUserId,
      packageName: record.packageName,
      preview: record.preview,
      confirmation: {
        tokenId: record.tokenId,
        tokenHash: record.tokenHash,
        expiresAt: record.expiresAtIso,
      },
      logicalCommand: `pm uninstall --user ${record.androidUserId} ${record.packageName}`,
    }
  }

  async function inspectEligibility({ serial, packageName, signal = null, expectedAndroidUserId = null } = {}) {
    if (!isValidSerial(serial)) throw remediationError('INVALID_DEVICE', 'O serial informado é inválido.')
    if (!validPackageName(packageName)) throw remediationError('INVALID_PACKAGE', 'O packageName informado é inválido.')
    await validateDevice(serial, { signal })
    const apps = await listInstalledApps(serial, { signal })
    const androidUserId = apps?.currentUserId
    if (!validAndroidUserId(androidUserId)) {
      throw remediationError('ANDROID_USER_UNAVAILABLE', 'Não foi possível identificar com segurança o usuário Android atual.')
    }
    if (expectedAndroidUserId !== null && androidUserId !== expectedAndroidUserId) {
      throw remediationError('ANDROID_USER_CHANGED', 'O usuário Android atual mudou desde o preview.')
    }
    const app = Array.isArray(apps?.items)
      ? apps.items.find((item) => item?.packageName === packageName)
      : null
    if (!app) throw remediationError('PACKAGE_NOT_INSTALLED', 'O pacote não está instalado para o usuário Android atual.')
    if (app.type !== 'user') {
      throw remediationError('SYSTEM_APP_BLOCKED', 'Aplicativos de sistema nunca são removidos automaticamente pelo DiagPro.')
    }
    const userPackageOutput = await runAdb(
      ['-s', serial, 'shell', 'pm', 'list', 'packages', '-3', '--user', String(androidUserId), packageName],
      { timeout: 20000, signal },
    )
    if (!packageListed(userPackageOutput, packageName)) {
      throw remediationError('PACKAGE_NOT_INSTALLED', 'O pacote não está instalado como aplicativo de usuário para o usuário Android atual.')
    }
    const admins = await collectDeviceAdmins(serial, { signal })
    const activeAdmin = adminForPackage(admins, packageName, androidUserId)
    if (activeAdmin) {
      throw remediationError(
        'DEVICE_ADMIN_ACTIVE',
        'Desative a administração do dispositivo nas configurações antes de remover este aplicativo.',
      )
    }
    return { app, apps, androidUserId, admins }
  }

  async function createRemovalPreview({
    serial,
    packageName,
    finding = null,
    action = null,
    projectionId = null,
    signal = null,
  } = {}) {
    if (action?.type && action.type !== ACTION_TYPE) {
      throw remediationError('ACTION_NOT_ALLOWED', 'A ação solicitada não permite desinstalação automática.')
    }
    if (finding?.subjectType && finding.subjectType !== 'app') {
      throw remediationError('ACTION_NOT_ALLOWED', 'Somente findings relacionados a aplicativos podem abrir este preview.')
    }
    if (finding?.packageName && finding.packageName !== packageName) {
      throw remediationError('FINDING_PACKAGE_MISMATCH', 'O pacote não corresponde ao finding selecionado.')
    }
    const findingContext = `${finding?.ruleId || ''} ${finding?.category || ''}`.toLowerCase()
    if (/device_admin|accessibility|overlay/.test(findingContext)) {
      throw remediationError(
        'ACTION_REQUIRES_MANUAL_REVIEW',
        'Este finding exige revisão manual da configuração no Android antes de uma nova análise.',
      )
    }
    if (findingIsStale(finding)) {
      throw remediationError('STALE_FINDING', 'O finding não está mais aberto para esta ação. Execute uma nova análise.')
    }

    const eligible = await inspectEligibility({ serial, packageName, signal })
    const deviceInfo = await getDeviceInfo(serial, { signal }).catch(() => ({ serial }))
    const actionId = createActionId()
    const confirmationToken = createToken()
    const confirmationTokenHash = tokenHash(confirmationToken)
    const confirmationTokenId = createTokenId()
    const createdAtMs = now()
    const expiresAtMs = createdAtMs + tokenTtlMs
    const preview = {
      id: actionId,
      device: {
        serial,
        manufacturer: deviceInfo?.manufacturer || null,
        model: deviceInfo?.model || null,
      },
      app: {
        name: eligible.app.name || null,
        packageName,
        type: 'user',
      },
      androidUser: eligible.androidUserId,
      finding: finding ? {
        id: finding.id || null,
        projectionId: Number.isInteger(projectionId) ? projectionId : null,
        title: finding.title || null,
        severity: finding.severity || null,
        evidenceConfidence: finding.evidenceConfidence || null,
      } : null,
      action: {
        type: ACTION_TYPE,
        label: 'Desinstalar aplicativo de usuário',
      },
      impact: 'O aplicativo e seus dados/configurações locais podem ser perdidos para o usuário Android atual.',
      reversible: false,
      requiresConfirmation: true,
      risks: [
        'Dados e configurações locais do aplicativo podem ser perdidos.',
        'A remoção não confirma que o aplicativo seja uma ameaça.',
      ],
      verification: {
        type: 'package_absent_for_user',
        description: 'Após a remoção, o DiagPro verificará o mesmo pacote no mesmo dispositivo e usuário Android.',
      },
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    }
    const record = {
      actionId,
      tokenId: confirmationTokenId,
      tokenHash: confirmationTokenHash,
      serial,
      packageName,
      androidUserId: eligible.androidUserId,
      action: ACTION_TYPE,
      findingId: finding?.id || null,
      projectionId: Number.isInteger(projectionId) ? projectionId : null,
      expiresAtMs,
      expiresAtIso: preview.expiresAt,
      preview,
    }
    previewsByTokenHash.set(confirmationTokenHash, record)
    return {
      removable: true,
      actionId,
      confirmationToken,
      confirmationTokenId,
      confirmationTokenHash,
      app: eligible.app,
      currentUserId: eligible.androidUserId,
      preview,
      impact: preview.impact,
      auditContext: safeContext(record),
    }
  }

  function consumeToken({ confirmationToken, actionId, serial, packageName, androidUserId }) {
    if (typeof confirmationToken !== 'string' || !confirmationToken) {
      throw remediationError('CONFIRMATION_REQUIRED', 'A confirmação explícita é obrigatória.')
    }
    const hash = tokenHash(confirmationToken)
    if (canceledTokenHashes.has(hash)) {
      throw remediationError(ADB_ERROR_CODES.OPERATION_CANCELED, 'A correção foi cancelada pelo operador.')
    }
    if (consumedTokenHashes.has(hash)) {
      throw remediationError('ACTION_ALREADY_EXECUTED', 'Esta confirmação já foi utilizada.')
    }
    const record = previewsByTokenHash.get(hash)
    previewsByTokenHash.delete(hash)
    consumedTokenHashes.add(hash)
    if (!record) throw remediationError('CONFIRMATION_REQUIRED', 'A confirmação é inválida ou não pertence a este preview.')
    const context = safeContext(record)
    if (record.expiresAtMs < now()) throw remediationError('CONFIRMATION_EXPIRED', 'A confirmação expirou. Abra um novo preview.', context)
    if (record.actionId !== actionId) throw remediationError('PREVIEW_MISMATCH', 'A confirmação não pertence a esta ação.', context)
    if (record.serial !== serial) throw remediationError('DEVICE_MISMATCH', 'A confirmação pertence a outro dispositivo.', context)
    if (record.packageName !== packageName) throw remediationError('PACKAGE_MISMATCH', 'A confirmação pertence a outro pacote.', context)
    if (record.androidUserId !== androidUserId) throw remediationError('ANDROID_USER_MISMATCH', 'A confirmação pertence a outro usuário Android.', context)
    if (record.action !== ACTION_TYPE) throw remediationError('ACTION_NOT_ALLOWED', 'A confirmação pertence a outro tipo de ação.', context)
    return record
  }

  async function executeUninstall({
    serial,
    packageName,
    androidUserId,
    confirmationToken,
    actionId,
    signal = null,
  } = {}) {
    const record = consumeToken({ confirmationToken, actionId, serial, packageName, androidUserId })
    const context = safeContext(record)
    let actionDispatched = false
    try {
      if (signal?.aborted) throw signal.reason || remediationError(ADB_ERROR_CODES.OPERATION_CANCELED)
      await inspectEligibility({ serial, packageName, signal, expectedAndroidUserId: record.androidUserId })
      if (signal?.aborted) throw signal.reason || remediationError(ADB_ERROR_CODES.OPERATION_CANCELED)
      actionDispatched = true
      const output = await runAdb(
        ['-s', serial, 'shell', 'pm', 'uninstall', '--user', String(record.androidUserId), packageName],
        { timeout: 20000, signal },
      )
      if (!/^success$/im.test(output)) {
        throw remediationError('UNINSTALL_FAILED', output || 'O Android não confirmou a desinstalação.', context)
      }
      return {
        ok: true,
        actionDispatched,
        adbResult: { status: 'success', code: 'SUCCESS', output: 'Success', actionDispatched },
        auditContext: context,
      }
    } catch (error) {
      error.actionDispatched = actionDispatched
      error.remediationContext = error.remediationContext || context
      throw error
    }
  }

  async function verifyPackageAbsent({ serial, packageName, androidUserId, signal = null } = {}) {
    if (!isValidSerial(serial) || !validPackageName(packageName) || !validAndroidUserId(androidUserId)) {
      return { status: 'not_verified', installed: null, source: 'package_manager', user: androidUserId ?? null, reason: 'INVALID_VERIFICATION_CONTEXT' }
    }
    try {
      await validateDevice(serial, { signal })
      const apps = await listInstalledApps(serial, { signal })
      if (apps?.currentUserId !== androidUserId) {
        return { status: 'not_verified', installed: null, source: 'package_manager', user: androidUserId, reason: 'ANDROID_USER_CHANGED' }
      }
      const output = await runAdb(
        ['-s', serial, 'shell', 'pm', 'list', 'packages', '--user', String(androidUserId), packageName],
        { timeout: 20000, signal },
      )
      const installed = packageListed(output, packageName)
      return { status: 'verified', installed, source: 'package_manager', user: androidUserId }
    } catch (error) {
      return {
        status: 'not_verified', installed: null, source: 'package_manager', user: androidUserId,
        reason: error?.code || error?.codigo || 'VERIFICATION_UNAVAILABLE',
      }
    }
  }

  function cancelPreview({ actionId, confirmationToken } = {}) {
    if (!confirmationToken) return false
    const hash = tokenHash(confirmationToken)
    const record = previewsByTokenHash.get(hash)
    if (!record || record.actionId !== actionId) return false
    previewsByTokenHash.delete(hash)
    canceledTokenHashes.add(hash)
    return true
  }

  return {
    cancelPreview,
    createRemovalPreview,
    executeUninstall,
    inspectEligibility,
    verifyPackageAbsent,
  }
}

module.exports = {
  ACTION_TYPE,
  DEFAULT_TOKEN_TTL_MS,
  adminForPackage,
  createRemediationService,
  findingIsStale,
  packageListed,
  tokenHash,
  validAndroidUserId,
}
