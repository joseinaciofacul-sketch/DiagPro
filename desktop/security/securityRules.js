const { PATCH_AGE_THRESHOLDS_DAYS } = require('./declarativeRules')
const { patchAgeDays } = require('./observationAnalyzer')

function calcularIdadePatch(securityPatch, now = new Date()) {
  return patchAgeDays(securityPatch, now)
}

function analyzeDevice(security, options) {
  // Import tardio mantém esta fachada livre de ciclo com consumidores legados.
  return require('./securityAnalyzer').analisarSeguranca({ security }, options).findings
}

function analisarSecurityPatch(securityPatch, options = {}) {
  return analyzeDevice({ securityPatch }, options)
    .filter((finding) => finding.category === 'outdated_security_patch')
}

function analisarBuild(security = {}, options = {}) {
  return analyzeDevice(security, options)
    .filter((finding) => ['device.debuggable_build', 'device.insecure_build', 'device.test_keys_build'].includes(finding.ruleId))
}

function analisarConfiguracoes(security = {}, options = {}) {
  return analyzeDevice(security, options)
    .filter((finding) => finding.ruleId === 'device.package_verifier_disabled')
}

function analisarRoot(root = {}, options = {}) {
  return analyzeDevice({ root }, options)
    .filter((finding) => finding.ruleId === 'device.su_binary_accessible')
}

module.exports = {
  PATCH_AGE_THRESHOLDS_DAYS,
  analisarBuild,
  analisarConfiguracoes,
  analisarRoot,
  analisarSecurityPatch,
  calcularIdadePatch,
}
