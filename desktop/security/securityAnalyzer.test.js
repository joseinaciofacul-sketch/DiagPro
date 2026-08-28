const test = require('node:test')
const assert = require('node:assert/strict')
const { analisarSeguranca } = require('./securityAnalyzer')

const NOW = new Date('2026-08-27T12:00:00Z')

function userApp(packageName, {
  requestedPermissions = [],
  grantedPermissions = [],
  accessibilityServiceEnabled = false,
  available = true,
  ...details
} = {}) {
  return {
    packageName,
    type: 'user',
    securityDetails: { available, requestedPermissions, grantedPermissions, accessibilityServiceEnabled, ...details },
  }
}

function analisarApp(app) {
  return analisarSeguranca({ permissions: { items: [app] } })
}

test('patch recente não gera achado', () => {
  const result = analisarSeguranca({ security: { securityPatch: '2026-07-01' } }, { now: NOW })
  assert.equal(result.findings.length, 0)
  assert.deepEqual(result.threats, [])
})

test('patch com mais de dois anos gera achado alto baseado na data real', () => {
  const result = analisarSeguranca({ security: { securityPatch: '2023-01-01' } }, { now: NOW })
  assert.equal(result.findings[0].id, 'device.security_patch_age')
  assert.equal(result.findings[0].severity, 'high')
  assert.ok(result.findings[0].evidence.ageDays > 730)
})

test('build depurável gera achado e não ameaça', () => {
  const result = analisarSeguranca({ security: { debuggableBuild: true } }, { now: NOW })
  assert.equal(result.findings[0].id, 'device.debuggable_build')
  assert.deepEqual(result.threats, [])
})

test('root não verificado não gera achado', () => {
  const result = analisarSeguranca({ security: { root: { status: 'not_verified' } } }, { now: NOW })
  assert.equal(result.findings.length, 0)
})

test('su acessível gera achado técnico sem classificar ameaça', () => {
  const result = analisarSeguranca({ security: { root: { status: 'detected', evidence: { path: '/system/xbin/su' } } } }, { now: NOW })
  assert.equal(result.findings[0].id, 'device.su_binary_accessible')
  assert.deepEqual(result.threats, [])
})

test('CAMERA isolada permanece informativa e com risco mínimo', () => {
  const result = analisarApp(userApp('com.example.camera', {
    grantedPermissions: ['android.permission.CAMERA'],
  }))
  assert.equal(result.findings[0].severity, 'info')
  assert.equal(result.findings[0].risk.level, 'minimal')
  assert.equal(result.findings[0].risk.score, 3)
  assert.deepEqual(result.threats, [])
})

test('MICROPHONE e CAMERA não viram ameaça', () => {
  const result = analisarApp(userApp('com.example.media', {
    grantedPermissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
  }))
  assert.equal(result.findings[0].risk.level, 'low')
  assert.deepEqual(result.threats, [])
})

test('ACCESSIBILITY e OVERLAY elevam risco por correlação verificável', () => {
  const result = analisarApp(userApp('com.example.overlay', {
    grantedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
    accessibilityServiceEnabled: true,
  }))
  assert.equal(result.findings[0].risk.level, 'high')
  assert.equal(result.findings[0].risk.score, 52)
  assert.ok(result.findings[0].risk.reasons.some((reason) => reason.id === 'correlation.accessibility_overlay'))
})

test('ACCESSIBILITY e PACKAGE_INSTALL elevam risco', () => {
  const result = analisarApp(userApp('com.example.installer', {
    grantedPermissions: ['android.permission.REQUEST_INSTALL_PACKAGES'],
    accessibilityServiceEnabled: true,
  }))
  assert.equal(result.findings[0].risk.level, 'high')
  assert.ok(result.findings[0].risk.reasons.some((reason) => reason.id === 'correlation.accessibility_package_install'))
})

test('múltiplas capacidades concedidas produzem score maior', () => {
  const camera = analisarApp(userApp('com.example.camera', {
    grantedPermissions: ['android.permission.CAMERA'],
  }))
  const multiple = analisarApp(userApp('com.example.multiple', {
    grantedPermissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.READ_CONTACTS',
    ],
  }))
  assert.ok(multiple.findings[0].risk.score > camera.findings[0].risk.score)
})

test('permissões apenas declaradas pesam menos que permissões concedidas', () => {
  const requested = analisarApp(userApp('com.example.requested', {
    requestedPermissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
  }))
  const granted = analisarApp(userApp('com.example.granted', {
    requestedPermissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
    grantedPermissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
  }))
  assert.equal(requested.findings[0].risk.score, 2)
  assert.equal(granted.findings[0].risk.score, 8)
  assert.ok(requested.findings[0].risk.score < granted.findings[0].risk.score)
})

test('informações indisponíveis reduzem confiança e não geram finding', () => {
  const result = analisarApp(userApp('com.example.unavailable', { available: false }))
  assert.equal(result.appRiskProfiles[0].risk.confidence, 'low')
  assert.equal(result.findings.length, 0)
})

test('aplicativo de sistema não recebe perfil de risco agressivo', () => {
  const result = analisarSeguranca({ permissions: { items: [{
    packageName: 'android',
    type: 'system',
    securityDetails: { available: true, grantedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'] },
  }] } })
  assert.equal(result.appRiskProfiles.length, 0)
  assert.equal(result.findings.length, 0)
})

test('score alto sozinho não alimenta threats', () => {
  const result = analisarApp(userApp('com.example.highrisk', {
    grantedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.REQUEST_INSTALL_PACKAGES'],
    accessibilityServiceEnabled: true,
  }))
  assert.ok(result.findings[0].risk.score >= 40)
  assert.deepEqual(result.threats, [])
})

test('motivos registram exatamente a evidência que adicionou pontos', () => {
  const result = analisarApp(userApp('com.example.camera', {
    grantedPermissions: ['android.permission.CAMERA'],
  }))
  const reason = result.findings[0].risk.reasons[0]
  assert.deepEqual(reason, {
    id: 'capability.camera.granted',
    points: 3,
    message: 'Capacidade Câmera concedida.',
    evidence: {
      capability: 'CAMERA',
      state: 'granted',
      signals: ['android.permission.CAMERA'],
    },
  })
})

test('findings são priorizados por severidade e score', () => {
  const result = analisarSeguranca({ permissions: { items: [
    userApp('com.example.camera', { grantedPermissions: ['android.permission.CAMERA'] }),
    userApp('com.example.overlay', {
      grantedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
      accessibilityServiceEnabled: true,
    }),
  ] } })
  assert.equal(result.findings[0].packageName, 'com.example.overlay')
})

test('warnings não viram findings automaticamente', () => {
  const result = analisarSeguranca({ warnings: [{ code: 'COLLECTION_UNAVAILABLE' }] })
  assert.equal(result.findings.length, 0)
  assert.deepEqual(result.threats, [])
})

test('origem conhecida é normalizada sem aumentar o score', () => {
  const result = analisarApp(userApp('com.example.play', {
    installerPackageName: 'com.android.vending',
    grantedPermissions: ['android.permission.CAMERA'],
  }))
  const profile = result.appRiskProfiles[0]
  assert.equal(profile.origin.type, 'google_play')
  assert.equal(profile.origin.label, 'Google Play')
  assert.equal(profile.risk.score, 3)
})

test('origem desconhecida isolada não gera finding nem threat', () => {
  const result = analisarApp(userApp('com.example.unknown'))
  assert.equal(result.appRiskProfiles[0].origin.type, 'unknown')
  assert.equal(result.findings.length, 0)
  assert.deepEqual(result.threats, [])
})

test('instalação via ADB é normalizada e só pesa com capacidades fortes', () => {
  const result = analisarApp(userApp('com.example.adb', {
    initiatingPackageName: 'com.android.shell',
    grantedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
    accessibilityServiceEnabled: true,
  }))
  const profile = result.appRiskProfiles[0]
  assert.equal(profile.origin.type, 'adb')
  assert.ok(profile.risk.reasons.some((reason) => reason.id === 'correlation.origin_adb_strong_capabilities'))
  assert.equal(profile.risk.score, 54)
  assert.deepEqual(result.threats, [])
})

test('hash SHA-256 presente é preservado como evidência de integridade', () => {
  const hash = 'a'.repeat(64)
  const result = analisarApp(userApp('com.example.hashed', {
    integrity: {
      hash: { algorithm: 'SHA-256', hash, status: 'available' },
      signature: { status: 'not_verified' },
    },
  }))
  assert.deepEqual(result.appRiskProfiles[0].integrity.hash, {
    algorithm: 'SHA-256', hash, status: 'available', reason: null,
  })
})

test('hash indisponível não gera pontos nem finding', () => {
  const result = analisarApp(userApp('com.example.nohash', {
    integrity: {
      hash: { algorithm: 'SHA-256', hash: null, status: 'not_verified', reason: 'HASH_COMMAND_UNAVAILABLE' },
    },
  }))
  const profile = result.appRiskProfiles[0]
  assert.equal(profile.integrity.hash.status, 'not_verified')
  assert.equal(profile.risk.score, 0)
  assert.equal(result.findings.length, 0)
})

test('assinatura indisponível não é tratada como risco', () => {
  const result = analisarApp(userApp('com.example.unsignedunknown', {
    integrity: { signature: { status: 'not_verified', reason: 'CERTIFICATE_DIGEST_UNAVAILABLE_VIA_ADB' } },
  }))
  assert.equal(result.appRiskProfiles[0].integrity.signature.status, 'not_verified')
  assert.equal(result.appRiskProfiles[0].risk.score, 0)
  assert.deepEqual(result.threats, [])
})

test('origem desconhecida com capacidades fortes aumenta risco de forma controlada', () => {
  const known = analisarApp(userApp('com.example.known', {
    installerPackageName: 'com.android.vending',
    grantedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
    accessibilityServiceEnabled: true,
  }))
  const unknown = analisarApp(userApp('com.example.unknownstrong', {
    grantedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
    accessibilityServiceEnabled: true,
  }))
  assert.equal(unknown.findings[0].risk.score - known.findings[0].risk.score, 4)
  assert.ok(unknown.findings[0].risk.reasons.some((reason) => reason.id === 'correlation.origin_unknown_strong_capabilities'))
})

test('score V3 permanece explicável pela soma dos motivos', () => {
  const result = analisarApp(userApp('com.example.explainable', {
    initiatingPackageName: 'com.android.shell',
    grantedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
    accessibilityServiceEnabled: true,
  }))
  const risk = result.findings[0].risk
  assert.equal(risk.rawScore, risk.reasons.reduce((total, reason) => total + reason.points, 0))
  assert.equal(risk.score, Math.min(100, risk.rawScore))
})
