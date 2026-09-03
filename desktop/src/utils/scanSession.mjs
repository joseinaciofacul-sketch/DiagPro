const ACTIVE_SCAN_STATUSES = new Set(['running', 'cancel_requested'])

const SCAN_ERROR_MESSAGES = {
  ADB_NOT_FOUND: 'O ADB não foi localizado. Verifique a instalação e tente novamente.',
  ADB_TIMEOUT: 'O ADB demorou para responder. Verifique o cabo e tente novamente.',
  DEVICE_UNAUTHORIZED: 'Desbloqueie o aparelho e autorize a depuração USB para continuar.',
  DEVICE_OFFLINE: 'O dispositivo está offline. Reconecte o cabo USB e tente novamente.',
  DEVICE_DISCONNECTED: 'O dispositivo foi desconectado durante a análise.',
  DEVICE_NOT_FOUND: 'O dispositivo não está mais conectado.',
  DEVICE_BUSY: 'Já existe uma operação em andamento neste dispositivo.',
  SCAN_ALREADY_EXISTS: 'Esta análise já está em andamento.',
}

export function scanFailureState(response = {}) {
  const code = response?.code || ''
  const status = response?.status || ''

  if (code === 'SCAN_ABORTED' || status === 'canceled') {
    return { status: 'canceled', message: 'A análise foi cancelada. Nenhum diagnóstico foi salvo.' }
  }

  if (
    ['DEVICE_DISCONNECTED', 'DEVICE_NOT_FOUND', 'DEVICE_OFFLINE'].includes(code)
    || status === 'device_disconnected'
  ) {
    return {
      status: 'device_disconnected',
      message: SCAN_ERROR_MESSAGES[code] || 'A conexão com o dispositivo foi interrompida durante a análise.',
    }
  }

  return {
    status: 'failed',
    message: SCAN_ERROR_MESSAGES[code] || response?.message || 'Não foi possível concluir a análise.',
  }
}

export function sessionForConnectedDevice(session, device) {
  if (!session || device?.status !== 'connected' || !device?.serial) return null
  return session.serial === device.serial ? session : null
}

export function reconcileScanSession(session, device) {
  if (!session?.serial) return session || null
  if (device?.status === 'connected' && device.serial === session.serial) return session

  if (!ACTIVE_SCAN_STATUSES.has(session.status)) return null

  const changedDevice = device?.status === 'connected' && device?.serial && device.serial !== session.serial
  return {
    ...session,
    status: changedDevice ? 'device_changed' : 'device_disconnected',
    result: null,
    persistence: { status: 'idle', id: null },
    message: changedDevice
      ? 'A análise foi interrompida porque o dispositivo conectado mudou.'
      : 'A análise foi interrompida porque o dispositivo foi desconectado.',
  }
}

export function updateMatchingScanSession(session, scanId, updates) {
  if (!session || session.scanId !== scanId) return session
  return { ...session, ...updates }
}
