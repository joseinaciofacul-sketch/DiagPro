const { createObservation, isoDate } = require('./analysisModels')
const { normalizarIdentidade, normalizarIntegridade, normalizarOrigem } = require('./appIdentityNormalizer')
const { CAPABILITY_DEFINITIONS, derivarCapacidades, normalizarSinaisAplicativo } = require('./permissionRules')

const DAY_MS = 24 * 60 * 60 * 1000

function patchAgeDays(securityPatch, now = new Date()) {
  if (typeof securityPatch !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(securityPatch)) return null
  const patchTime = Date.parse(`${securityPatch}T00:00:00Z`)
  const nowTime = now instanceof Date ? now.getTime() : Date.parse(now)
  if (!Number.isFinite(patchTime) || !Number.isFinite(nowTime) || patchTime > nowTime) return null
  return Math.floor((nowTime - patchTime) / DAY_MS)
}

function observationEvidence(observation) {
  return {
    key: observation.category,
    value: observation.value,
    source: observation.source,
    quality: observation.evidenceConfidence,
    observationId: observation.id,
  }
}

function setEvidence(context, fact, observation) {
  context.evidenceByFact[fact] = observationEvidence(observation)
}

function addDeviceObservation(result, context, input) {
  const observation = createObservation(input)
  result.push(observation)
  return observation
}

function buildDeviceContext(security = {}, { now = new Date(), collectedAt = now } = {}) {
  const observations = []
  const context = {
    subjectType: 'device',
    subjectId: 'current_device',
    facts: {
      securityPatch: { value: security.securityPatch || null, ageDays: patchAgeDays(security.securityPatch, now) },
      build: {
        debuggable: security.debuggableBuild === true,
        secure: security.secureBuild,
        testKeys: typeof security.buildTags === 'string'
          && security.buildTags.split(',').map((tag) => tag.trim()).includes('test-keys'),
      },
      packageVerifier: { enabled: security.packageVerifierEnabled },
      root: { suAccessible: security.root?.status === 'detected' },
    },
    evidenceByFact: {},
  }

  if (context.facts.securityPatch.ageDays !== null) {
    const observation = addDeviceObservation(observations, context, {
      id: 'observation.device.security_patch',
      category: 'security_patch', subjectType: 'device', subjectId: context.subjectId,
      source: 'adb_getprop', status: 'observed',
      value: { securityPatch: security.securityPatch, ageDays: context.facts.securityPatch.ageDays },
      evidenceConfidence: 'high', collectedAt,
    })
    setEvidence(context, 'securityPatch.ageDays', observation)
  }

  if (typeof security.debuggableBuild === 'boolean') {
    const observation = addDeviceObservation(observations, context, {
      id: 'observation.device.build_debuggable', category: 'build_configuration',
      subjectType: 'device', subjectId: context.subjectId, source: 'adb_getprop',
      value: { property: 'ro.debuggable', enabled: security.debuggableBuild },
      evidenceConfidence: 'high', collectedAt,
    })
    setEvidence(context, 'build.debuggable', observation)
  }

  if (typeof security.secureBuild === 'boolean') {
    const observation = addDeviceObservation(observations, context, {
      id: 'observation.device.build_secure', category: 'build_configuration',
      subjectType: 'device', subjectId: context.subjectId, source: 'adb_getprop',
      value: { property: 'ro.secure', enabled: security.secureBuild },
      evidenceConfidence: 'high', collectedAt,
    })
    setEvidence(context, 'build.secure', observation)
  }

  if (typeof security.buildTags === 'string') {
    const observation = addDeviceObservation(observations, context, {
      id: 'observation.device.build_tags', category: 'build_configuration',
      subjectType: 'device', subjectId: context.subjectId, source: 'adb_getprop',
      value: { property: 'ro.build.tags', value: security.buildTags, testKeys: context.facts.build.testKeys },
      evidenceConfidence: 'high', collectedAt,
    })
    setEvidence(context, 'build.testKeys', observation)
  }

  if (typeof security.packageVerifierEnabled === 'boolean') {
    const observation = addDeviceObservation(observations, context, {
      id: 'observation.device.package_verifier', category: 'security_configuration',
      subjectType: 'device', subjectId: context.subjectId, source: 'adb_settings',
      value: { setting: 'global.package_verifier_enable', enabled: security.packageVerifierEnabled },
      evidenceConfidence: 'high', collectedAt,
    })
    setEvidence(context, 'packageVerifier.enabled', observation)
  }

  if (security.root?.status) {
    const observation = addDeviceObservation(observations, context, {
      id: 'observation.device.root_signal', category: 'modified_environment',
      subjectType: 'device', subjectId: context.subjectId, source: 'adb_shell',
      status: security.root.status, value: security.root.evidence || { detected: false },
      evidenceConfidence: security.root.status === 'detected' ? 'medium' : 'low', collectedAt,
    })
    setEvidence(context, 'root.suAccessible', observation)
  }

  const developerSignals = [
    ['adb_enabled', security.developerOptions?.adbEnabled],
    ['development_settings_enabled', security.developerOptions?.developmentSettingsEnabled],
    ['verify_apps_over_usb', security.developerOptions?.verifyAppsOverUsb],
  ]
  developerSignals.forEach(([setting, state]) => {
    if (!state?.status) return
    observations.push(createObservation({
      id: `observation.device.developer_option.${setting}`,
      category: 'developer_configuration', subjectType: 'device', subjectId: context.subjectId,
      source: 'adb_settings', status: state.status,
      value: { setting, value: state.value ?? null, reason: state.reason || null },
      evidenceConfidence: state.status === 'available' ? 'high' : 'low', collectedAt,
    }))
  })

  return { context, observations }
}

function buildAppContext(app, security = {}, { collectedAt = new Date() } = {}) {
  const details = app?.securityDetails || {}
  const identity = normalizarIdentidade(app)
  const origin = normalizarOrigem(details)
  const integrity = normalizarIntegridade(details)
  const signals = normalizarSinaisAplicativo(app)
  const capabilities = derivarCapacidades(signals)
  const currentUserId = details.currentUserId ?? null
  const admins = Array.isArray(security.deviceAdmins?.value) ? security.deviceAdmins.value : []
  const admin = admins.find((item) => item.packageName === app.packageName
    && (currentUserId === null || item.userId === null || item.userId === currentUserId)) || null
  const context = {
    subjectType: 'app',
    subjectId: app.packageName,
    facts: {
      app: { type: app.type, detailsAvailable: details.available === true },
      origin: { type: origin.type, status: origin.status, untrusted: ['adb', 'unknown'].includes(origin.type) },
      integrity: { hashStatus: integrity.hash.status, signatureStatus: integrity.signature.status },
      capabilities: {},
      deviceAdmin: { active: Boolean(admin), userId: admin?.userId ?? null },
      highImpactCount: 0,
    },
    evidenceByFact: {},
    metadata: { app, identity, origin, integrity, capabilities },
  }
  const observations = []

  const typeObservation = createObservation({
    id: `observation.app.type:${app.packageName}`, category: 'package_type',
    subjectType: 'app', subjectId: app.packageName, source: 'adb_package_manager',
    value: app.type, evidenceConfidence: 'high', collectedAt,
  })
  observations.push(typeObservation)
  setEvidence(context, 'app.type', typeObservation)

  const originObservation = createObservation({
    id: `observation.app.origin:${app.packageName}`, category: 'installation_origin',
    subjectType: 'app', subjectId: app.packageName, source: 'adb_dumpsys_package',
    status: origin.status, value: origin,
    evidenceConfidence: origin.type === 'adb' ? 'high' : origin.status === 'available' ? 'medium' : 'low',
    collectedAt,
  })
  observations.push(originObservation)
  setEvidence(context, 'origin.type', originObservation)
  setEvidence(context, 'origin.untrusted', originObservation)

  const hashObservation = createObservation({
    id: `observation.app.hash:${app.packageName}`, category: 'app_integrity',
    subjectType: 'app', subjectId: app.packageName, source: 'adb_package_metadata',
    status: integrity.hash.status, value: integrity.hash,
    evidenceConfidence: integrity.hash.status === 'available' ? 'high' : 'low', collectedAt,
  })
  observations.push(hashObservation)
  setEvidence(context, 'integrity.hashStatus', hashObservation)

  signals.forEach((signal) => {
    const confidence = signal.evidenceConfidence || (signal.state === 'granted' ? 'medium' : 'medium')
    const signalId = signal.key.replace(/[^A-Za-z0-9_.-]/g, '_').toLowerCase()
    const observation = createObservation({
      id: `observation.app.capability.${signal.capability.toLowerCase()}.${signal.state}.${signalId}:${app.packageName}`,
      category: signal.type === 'permission' ? 'permission' : 'special_capability',
      subjectType: 'app', subjectId: app.packageName, source: signal.source,
      status: signal.state, value: { capability: signal.capability, signal: signal.key, state: signal.state },
      evidenceConfidence: confidence, collectedAt,
    })
    observations.push(observation)
  })

  const highImpact = new Set(['ACCESSIBILITY', 'OVERLAY', 'PACKAGE_INSTALL', 'SMS', 'CALLS'])
  capabilities.forEach((capability) => {
    const verified = ['granted', 'enabled', 'effective'].includes(capability.state)
    context.facts.capabilities[capability.id] = {
      state: capability.state,
      verified,
      effective: capability.state === 'effective',
    }
    if (verified && highImpact.has(capability.id)) context.facts.highImpactCount += 1
    const observation = observations.find((item) => item.value?.capability === capability.id
      && item.value?.state === capability.state)
    if (observation) {
      setEvidence(context, `capabilities.${capability.id}.state`, observation)
      setEvidence(context, `capabilities.${capability.id}.verified`, observation)
      setEvidence(context, `capabilities.${capability.id}.effective`, observation)
    }
  })

  if (admin) {
    const observation = createObservation({
      id: `observation.app.device_admin:${app.packageName}`, category: 'device_administrator',
      subjectType: 'app', subjectId: app.packageName, source: 'adb_dumpsys_device_policy',
      status: 'active', value: { active: true, userId: admin.userId, componentName: admin.componentName },
      evidenceConfidence: 'high', collectedAt,
    })
    observations.push(observation)
    setEvidence(context, 'deviceAdmin.active', observation)
  }

  return { context, observations }
}

function analyzeObservations({ security = {}, permissions = null, apps = null } = {}, options = {}) {
  const now = options.now || new Date()
  const collectedAt = isoDate(options.collectedAt || now)
  const device = buildDeviceContext(security, { now, collectedAt })
  const items = Array.isArray(permissions?.items)
    ? permissions.items
    : Array.isArray(apps?.items) ? apps.items : []
  const appResults = items.filter((app) => app?.packageName).map((app) => buildAppContext(app, security, { collectedAt }))
  const analyzedPackages = new Set(appResults.map((result) => result.context.subjectId))
  const unlinkedAdminObservations = (Array.isArray(security.deviceAdmins?.value) ? security.deviceAdmins.value : [])
    .filter((admin) => admin?.packageName && !analyzedPackages.has(admin.packageName))
    .map((admin) => createObservation({
      id: `observation.app.device_admin:${admin.packageName}`,
      category: 'device_administrator', subjectType: 'app', subjectId: admin.packageName,
      source: 'adb_dumpsys_device_policy', status: 'active',
      value: { active: true, userId: admin.userId ?? null, componentName: admin.componentName || null },
      evidenceConfidence: 'high', collectedAt,
    }))
  return {
    observations: [...device.observations, ...appResults.flatMap((result) => result.observations), ...unlinkedAdminObservations],
    deviceContext: device.context,
    appContexts: appResults.map((result) => result.context),
  }
}

module.exports = {
  analyzeObservations,
  buildAppContext,
  buildDeviceContext,
  patchAgeDays,
}
