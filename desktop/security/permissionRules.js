const CAPABILITY_DEFINITIONS = Object.freeze({
  SMS: { label: 'SMS' },
  CONTACTS: { label: 'Contatos' },
  CALLS: { label: 'Chamadas' },
  LOCATION: { label: 'Localização' },
  CAMERA: { label: 'Câmera' },
  MICROPHONE: { label: 'Microfone' },
  BOOT: { label: 'Inicialização do sistema' },
  PACKAGE_INSTALL: { label: 'Instalação de pacotes' },
  OVERLAY: { label: 'Sobreposição de tela' },
  ACCESSIBILITY: { label: 'Acessibilidade' },
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
  'android.permission.RECEIVE_BOOT_COMPLETED': 'BOOT',
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
    const isSpecialCapability = capability === 'OVERLAY' || capability === 'PACKAGE_INSTALL'
    const specialCapability = capability === 'OVERLAY'
      ? details.specialCapabilities?.overlay
      : capability === 'PACKAGE_INSTALL'
        ? details.specialCapabilities?.installUnknownApps
        : null
    const state = isSpecialCapability
      ? specialCapability?.effective === true ? 'effective' : 'requested'
      : granted.has(permission) ? 'granted' : 'requested'
    signals.push({
      type: isSpecialCapability ? 'special_capability' : 'permission',
      key: permission,
      capability,
      state,
      source: specialCapability?.source || 'adb_dumpsys_package',
      evidenceConfidence: specialCapability?.status === 'available' ? 'high' : 'medium',
    })
  })

  if (details.accessibilityServiceEnabled === true) {
    signals.push({
      type: 'configuration',
      key: 'enabled_accessibility_service',
      capability: 'ACCESSIBILITY',
      state: 'enabled',
      source: 'adb_settings',
      evidenceConfidence: 'high',
    })
  }
  return signals
}

function derivarCapacidades(signals) {
  const statePriority = { requested: 1, granted: 2, enabled: 3, effective: 3 }
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
