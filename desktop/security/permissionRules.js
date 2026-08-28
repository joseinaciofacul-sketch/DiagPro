const CAPABILITY_DEFINITIONS = Object.freeze({
  SMS: { label: 'SMS', requestedWeight: 1, grantedWeight: 8 },
  CONTACTS: { label: 'Contatos', requestedWeight: 1, grantedWeight: 5 },
  CALLS: { label: 'Chamadas', requestedWeight: 1, grantedWeight: 8 },
  LOCATION: { label: 'Localização', requestedWeight: 1, grantedWeight: 5 },
  CAMERA: { label: 'Câmera', requestedWeight: 1, grantedWeight: 3 },
  MICROPHONE: { label: 'Microfone', requestedWeight: 1, grantedWeight: 5 },
  PACKAGE_INSTALL: { label: 'Instalação de pacotes', requestedWeight: 2, grantedWeight: 12 },
  OVERLAY: { label: 'Sobreposição de tela', requestedWeight: 2, grantedWeight: 12 },
  ACCESSIBILITY: { label: 'Acessibilidade', requestedWeight: 0, grantedWeight: 18 },
})

const PERMISSION_CAPABILITIES = Object.freeze({
  'android.permission.SEND_SMS': 'SMS',
  'android.permission.READ_SMS': 'SMS',
  'android.permission.RECEIVE_SMS': 'SMS',
  'android.permission.READ_CONTACTS': 'CONTACTS',
  'android.permission.WRITE_CONTACTS': 'CONTACTS',
  'android.permission.READ_CALL_LOG': 'CALLS',
  'android.permission.WRITE_CALL_LOG': 'CALLS',
  'android.permission.CALL_PHONE': 'CALLS',
  'android.permission.READ_PHONE_STATE': 'CALLS',
  'android.permission.ACCESS_FINE_LOCATION': 'LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION': 'LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION': 'LOCATION',
  'android.permission.CAMERA': 'CAMERA',
  'android.permission.RECORD_AUDIO': 'MICROPHONE',
  'android.permission.REQUEST_INSTALL_PACKAGES': 'PACKAGE_INSTALL',
  'android.permission.SYSTEM_ALERT_WINDOW': 'OVERLAY',
})

// Mantido como exportação compatível com a V1 e derivado do mapeamento central de capacidades.
const SENSITIVE_PERMISSIONS = Object.freeze(Object.fromEntries(
  Object.entries(PERMISSION_CAPABILITIES).map(([permission, capability]) => [permission, {
    group: capability.toLowerCase(),
    capability,
    label: CAPABILITY_DEFINITIONS[capability].label,
  }]),
))

function normalizarSinaisAplicativo(app) {
  const details = app?.securityDetails
  if (!details?.available) return []

  const requested = new Set(details.requestedPermissions || [])
  const granted = new Set(details.grantedPermissions || [])
  const permissions = new Set([...requested, ...granted])
  const signals = []

  permissions.forEach((permission) => {
    const capability = PERMISSION_CAPABILITIES[permission]
    if (!capability) return
    signals.push({
      type: 'permission',
      key: permission,
      capability,
      state: granted.has(permission) ? 'granted' : 'requested',
      source: 'adb_dumpsys_package',
    })
  })

  if (details.accessibilityServiceEnabled === true) {
    signals.push({
      type: 'configuration',
      key: 'enabled_accessibility_service',
      capability: 'ACCESSIBILITY',
      state: 'enabled',
      source: 'adb_settings',
    })
  }
  return signals
}

function derivarCapacidades(signals) {
  const statePriority = { requested: 1, granted: 2, enabled: 3 }
  const byCapability = new Map()

  signals.forEach((signal) => {
    const current = byCapability.get(signal.capability)
    if (!current) {
      byCapability.set(signal.capability, {
        id: signal.capability,
        label: CAPABILITY_DEFINITIONS[signal.capability].label,
        state: signal.state,
        evidence: [signal.key],
        sources: [signal.source],
      })
      return
    }
    current.evidence = [...new Set([...current.evidence, signal.key])]
    current.sources = [...new Set([...current.sources, signal.source])]
    if (statePriority[signal.state] > statePriority[current.state]) current.state = signal.state
  })

  return [...byCapability.values()].sort((a, b) => a.id.localeCompare(b.id))
}

module.exports = {
  CAPABILITY_DEFINITIONS,
  PERMISSION_CAPABILITIES,
  SENSITIVE_PERMISSIONS,
  normalizarSinaisAplicativo,
  derivarCapacidades,
}
