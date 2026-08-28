const DAY_MS = 24 * 60 * 60 * 1000

// Faixas conservadoras da V1. Elas classificam atraso de manutenção, não malware.
const PATCH_AGE_THRESHOLDS_DAYS = Object.freeze({ low: 180, medium: 365, high: 730 })

function calcularIdadePatch(securityPatch, now = new Date()) {
  if (typeof securityPatch !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(securityPatch)) return null
  const patchTime = Date.parse(`${securityPatch}T00:00:00Z`)
  const nowTime = now instanceof Date ? now.getTime() : Date.parse(now)
  if (!Number.isFinite(patchTime) || !Number.isFinite(nowTime) || patchTime > nowTime) return null
  return Math.floor((nowTime - patchTime) / DAY_MS)
}

function analisarSecurityPatch(securityPatch, { now = new Date() } = {}) {
  const ageDays = calcularIdadePatch(securityPatch, now)
  if (ageDays === null || ageDays <= PATCH_AGE_THRESHOLDS_DAYS.low) return []

  const severity = ageDays > PATCH_AGE_THRESHOLDS_DAYS.high
    ? 'high'
    : ageDays > PATCH_AGE_THRESHOLDS_DAYS.medium
      ? 'medium'
      : 'low'

  return [{
    id: 'device.security_patch_age',
    category: 'device_security',
    severity,
    confidence: 'high',
    title: 'Patch de segurança desatualizado',
    description: `O patch informado pelo dispositivo tem ${ageDays} dias. Um patch antigo pode deixar correções de segurança ausentes, mas não comprova comprometimento.`,
    evidence: { securityPatch, ageDays, thresholdsDays: PATCH_AGE_THRESHOLDS_DAYS },
    recommendation: 'Verifique se o fabricante oferece uma atualização oficial de segurança para este dispositivo.',
    packageName: null,
    source: 'adb_getprop',
  }]
}

function analisarBuild(security = {}) {
  const findings = []
  if (security.debuggableBuild === true) {
    findings.push({
      id: 'device.debuggable_build',
      category: 'device_security',
      severity: 'medium',
      confidence: 'high',
      title: 'Build Android marcada como depurável',
      description: 'A propriedade ro.debuggable está ativa. Essa configuração amplia recursos de depuração, mas não comprova root ou comprometimento.',
      evidence: { property: 'ro.debuggable', value: '1' },
      recommendation: 'Confirme se esta é uma build de desenvolvimento intencional. Em dispositivos de produção, prefira firmware oficial não depurável.',
      packageName: null,
      source: 'adb_getprop',
    })
  }
  if (security.secureBuild === false) {
    findings.push({
      id: 'device.insecure_build',
      category: 'device_security',
      severity: 'high',
      confidence: 'high',
      title: 'Build Android com modo seguro desativado',
      description: 'A propriedade ro.secure está desativada. O sinal indica uma configuração de build menos restritiva, sem afirmar comprometimento.',
      evidence: { property: 'ro.secure', value: '0' },
      recommendation: 'Valide a origem do firmware e considere reinstalar uma versão oficial fornecida pelo fabricante.',
      packageName: null,
      source: 'adb_getprop',
    })
  }
  if (typeof security.buildTags === 'string' && security.buildTags.split(',').map((tag) => tag.trim()).includes('test-keys')) {
    findings.push({
      id: 'device.test_keys_build',
      category: 'device_security',
      severity: 'low',
      confidence: 'high',
      title: 'Build assinada com test-keys',
      description: 'A propriedade ro.build.tags contém test-keys. Isso é comum em builds de desenvolvimento ou personalizadas e, isoladamente, não comprova root.',
      evidence: { property: 'ro.build.tags', value: security.buildTags },
      recommendation: 'Confirme se a instalação de uma build personalizada foi intencional e se sua origem é confiável.',
      packageName: null,
      source: 'adb_getprop',
    })
  }
  return findings
}

function analisarConfiguracoes(security = {}) {
  const findings = []
  if (security.packageVerifierEnabled === false) {
    findings.push({
      id: 'device.package_verifier_disabled',
      category: 'device_security',
      severity: 'medium',
      confidence: 'high',
      title: 'Verificação de pacotes desativada',
      description: 'A configuração global package_verifier_enable está desativada. Isso reduz uma proteção do sistema, mas não indica que exista malware.',
      evidence: { setting: 'global.package_verifier_enable', value: '0' },
      recommendation: 'Reative a verificação de aplicativos nas configurações de segurança do Android, quando disponível.',
      packageName: null,
      source: 'adb_settings',
    })
  }
  return findings
}

function analisarRoot(root = {}) {
  if (root.status !== 'detected' || !root.evidence) return []
  return [{
    id: 'device.su_binary_accessible',
    category: 'device_security',
    severity: 'high',
    confidence: 'medium',
    title: 'Executável su acessível ao shell ADB',
    description: 'O shell ADB localizou um executável su acessível. Esse é um sinal técnico de alteração do ambiente, mas não identifica sua origem nem comprova atividade maliciosa.',
    evidence: root.evidence,
    recommendation: 'Confirme se o acesso administrativo foi habilitado intencionalmente. Caso não tenha sido, restaure o firmware oficial do fabricante.',
    packageName: null,
    source: 'adb_shell',
  }]
}

module.exports = {
  PATCH_AGE_THRESHOLDS_DAYS,
  calcularIdadePatch,
  analisarSecurityPatch,
  analisarBuild,
  analisarConfiguracoes,
  analisarRoot,
}
