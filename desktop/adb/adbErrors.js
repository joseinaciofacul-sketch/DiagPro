const ADB_ERROR_CODES = Object.freeze({
  ADB_NOT_FOUND: 'ADB_NOT_FOUND',
  ADB_TIMEOUT: 'ADB_TIMEOUT',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  DEVICE_UNAUTHORIZED: 'DEVICE_UNAUTHORIZED',
  DEVICE_DISCONNECTED: 'DEVICE_DISCONNECTED',
  COMMAND_FAILED: 'COMMAND_FAILED',
  COMMAND_NOT_SUPPORTED: 'COMMAND_NOT_SUPPORTED',
  INVALID_DEVICE: 'INVALID_DEVICE',
  INVALID_ARGUMENTS: 'INVALID_ARGUMENTS',
  SCAN_ABORTED: 'SCAN_ABORTED',
  OPERATION_CANCELED: 'OPERATION_CANCELED',
})

const DEFAULT_MESSAGES = Object.freeze({
  ADB_NOT_FOUND: 'O ADB não foi localizado neste computador.',
  ADB_TIMEOUT: 'O comando ADB excedeu o tempo limite.',
  DEVICE_NOT_FOUND: 'O dispositivo informado não foi localizado.',
  DEVICE_OFFLINE: 'O dispositivo está offline.',
  DEVICE_UNAUTHORIZED: 'O dispositivo não autorizou a conexão ADB.',
  DEVICE_DISCONNECTED: 'O dispositivo foi desconectado durante a operação.',
  COMMAND_FAILED: 'O comando ADB falhou.',
  COMMAND_NOT_SUPPORTED: 'O comando não é suportado por este Android ou fabricante.',
  INVALID_DEVICE: 'O serial do dispositivo é inválido.',
  INVALID_ARGUMENTS: 'Os argumentos do comando ADB são inválidos.',
  SCAN_ABORTED: 'A análise foi cancelada.',
  OPERATION_CANCELED: 'A operação foi cancelada antes da confirmação do resultado.',
})

class AdbError extends Error {
  constructor(code, message = DEFAULT_MESSAGES[code] || DEFAULT_MESSAGES.COMMAND_FAILED, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'AdbError'
    this.code = code
    // Compatibilidade com o contrato anterior do deviceDetector.
    this.codigo = code
    this.details = options.details || null
  }
}

function createAdbError(code, message, options) {
  return new AdbError(code, message || DEFAULT_MESSAGES[code], options)
}

function abortedError(signal) {
  const reason = signal?.reason
  if (reason instanceof AdbError) return reason
  if (reason && typeof reason === 'object' && reason.code && DEFAULT_MESSAGES[reason.code]) {
    return createAdbError(reason.code, reason.message)
  }
  return createAdbError(ADB_ERROR_CODES.SCAN_ABORTED)
}

function normalizeAdbFailure(error, stderr = '', { signal = null, deviceCommand = false } = {}) {
  if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
    return abortedError(signal)
  }

  if (error?.code === 'ENOENT') return createAdbError(ADB_ERROR_CODES.ADB_NOT_FOUND, null, { cause: error })
  if (error?.killed || error?.code === 'ETIMEDOUT') {
    return createAdbError(ADB_ERROR_CODES.ADB_TIMEOUT, null, { cause: error })
  }

  const output = `${stderr || ''}\n${error?.message || ''}`.trim()
  if (/unauthorized/i.test(output)) {
    return createAdbError(ADB_ERROR_CODES.DEVICE_UNAUTHORIZED, null, { cause: error, details: { output } })
  }
  if (/device\s+offline|device is offline/i.test(output)) {
    return createAdbError(ADB_ERROR_CODES.DEVICE_OFFLINE, null, { cause: error, details: { output } })
  }
  if (/no devices\/emulators found|device ['"]?.+['"]? not found|device is not connected|transport.*closed/i.test(output)) {
    const code = deviceCommand ? ADB_ERROR_CODES.DEVICE_DISCONNECTED : ADB_ERROR_CODES.DEVICE_NOT_FOUND
    return createAdbError(code, null, { cause: error, details: { output } })
  }
  if (/unknown command|unknown option|not supported|inaccessible or not found|(?:^|\s)(?:cmd|sha256sum): not found/i.test(output)) {
    return createAdbError(ADB_ERROR_CODES.COMMAND_NOT_SUPPORTED, null, { cause: error, details: { output } })
  }

  return createAdbError(
    ADB_ERROR_CODES.COMMAND_FAILED,
    output || DEFAULT_MESSAGES.COMMAND_FAILED,
    { cause: error, details: output ? { output } : null },
  )
}

function availabilityFromError(error) {
  const code = error?.code || error?.codigo || ADB_ERROR_CODES.COMMAND_FAILED
  if (code === ADB_ERROR_CODES.COMMAND_NOT_SUPPORTED) {
    return { status: 'not_supported', reason: code }
  }
  if ([ADB_ERROR_CODES.DEVICE_NOT_FOUND, ADB_ERROR_CODES.DEVICE_OFFLINE, ADB_ERROR_CODES.DEVICE_UNAUTHORIZED].includes(code)) {
    return { status: 'not_available', reason: code }
  }
  return { status: 'error', reason: code }
}

module.exports = {
  ADB_ERROR_CODES,
  DEFAULT_MESSAGES,
  AdbError,
  availabilityFromError,
  createAdbError,
  normalizeAdbFailure,
}
