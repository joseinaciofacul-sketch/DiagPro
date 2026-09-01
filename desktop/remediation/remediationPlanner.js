const GUIDE_BY_FINDING = Object.freeze({
  'device.security_patch_age': {
    title: 'Verificar atualização de segurança',
    description: 'Esta correção depende de uma atualização oficial do sistema.',
    guidance: 'Verifique se existe uma atualização de segurança nas configurações do Android ou pelo software oficial do fabricante.',
  },
  'device.debuggable_build': {
    title: 'Validar firmware instalado',
    description: 'Uma build depurável pode ser intencional em desenvolvimento, mas deve ser validada em dispositivos de produção.',
    guidance: 'Confirme a origem do firmware e, se a configuração não for intencional, utilize somente a imagem oficial e o procedimento do fabricante.',
  },
  'device.insecure_build': {
    title: 'Validar segurança do firmware',
    description: 'O DiagPro não altera propriedades críticas da build automaticamente.',
    guidance: 'Valide a origem do sistema e considere restaurar o firmware oficial seguindo o procedimento do fabricante.',
  },
  'device.test_keys_build': {
    title: 'Confirmar origem da build',
    description: 'Builds com test-keys podem ser legítimas em ambientes de desenvolvimento ou sistemas personalizados.',
    guidance: 'Confirme se a instalação foi intencional e se a imagem utilizada veio de uma fonte confiável.',
  },
  'device.package_verifier_disabled': {
    title: 'Revisar verificação de aplicativos',
    description: 'O DiagPro não altera configurações de segurança protegidas nesta versão.',
    guidance: 'Abra as configurações de segurança do Android e reative a verificação de aplicativos, quando essa opção estiver disponível.',
  },
})

function pacoteValido(packageName) {
  return typeof packageName === 'string'
    && /^[A-Za-z][A-Za-z0-9_.-]{1,254}$/.test(packageName)
    && packageName.includes('.')
}

function acaoBase(finding, overrides) {
  return {
    id: `remediation.${finding.id}`,
    findingId: finding.id,
    packageName: finding.packageName || null,
    type: 'no_action',
    availability: 'not_available',
    state: 'not_available',
    title: 'Nenhuma correção automática segura',
    description: 'O achado permanece disponível para análise técnica.',
    impact: null,
    reversible: null,
    requiresConfirmation: false,
    verification: { type: 'none', status: 'not_available' },
    reasonUnavailable: 'Não existe uma ação automática segura para este achado.',
    guidance: null,
    ...overrides,
  }
}

function findingRuleId(finding) {
  return finding.ruleId || finding.id
}

function guideForFinding(finding) {
  const ruleId = findingRuleId(finding)
  if (ruleId?.startsWith('device.security_patch_age.')) return GUIDE_BY_FINDING['device.security_patch_age']
  return GUIDE_BY_FINDING[ruleId] || null
}

function planejarRemediacaoFinding(finding, apps = []) {
  const app = finding.packageName
    ? apps.find((item) => item.packageName === finding.packageName)
    : null

  const ruleId = findingRuleId(finding)
  const isDeviceAdmin = ruleId?.includes('device_admin') || finding.category === 'device_administrator_context'
  const involvesAccessibility = ruleId?.includes('accessibility')
  const involvesOverlay = ruleId?.includes('overlay')

  if (finding.packageName && (isDeviceAdmin || involvesAccessibility || involvesOverlay)) {
    const type = isDeviceAdmin
      ? 'manual_device_admin_review'
      : involvesAccessibility
        ? 'manual_accessibility_review'
        : 'manual_overlay_review'
    const guidance = isDeviceAdmin
      ? 'Desative a administração do dispositivo nas configurações do Android somente após validar a finalidade do aplicativo. Depois, execute uma nova análise.'
      : involvesAccessibility
        ? 'Revise manualmente o serviço de acessibilidade no dispositivo. O DiagPro não desativa essa permissão automaticamente. Depois, execute uma nova análise.'
        : 'Revise manualmente a permissão de sobreposição no Android. O DiagPro não altera AppOps automaticamente. Depois, execute uma nova análise.'
    return acaoBase(finding, {
      type,
      availability: 'available',
      state: 'available',
      title: 'Revisar configuração manualmente',
      description: 'Este achado exige revisão manual no Android antes de qualquer remoção.',
      guidance,
      reasonUnavailable: null,
      verification: { type: 'rescan_after_manual_action', status: 'pending' },
    })
  }

  if (finding.packageName && finding.remediation?.type === 'manual_guidance') {
    return acaoBase(finding, {
      type: 'manual_review', availability: 'available', state: 'available',
      title: 'Revisar aplicativo manualmente',
      description: 'Não existe alteração automática segura para este achado.',
      guidance: finding.recommendation,
      reasonUnavailable: null,
      verification: { type: 'rescan_after_manual_action', status: 'pending' },
    })
  }

  if (finding.packageName) {
    if (app?.type === 'user' && pacoteValido(finding.packageName)) {
      return acaoBase(finding, {
        type: 'uninstall_user_app',
        availability: 'available',
        state: 'available',
        title: 'Remover aplicativo',
        description: 'Desinstala o aplicativo de usuário após preview e confirmação explícita.',
        impact: 'O aplicativo e seus dados/configurações locais podem ser perdidos.',
        reversible: false,
        requiresConfirmation: true,
        verification: { type: 'package_absent_for_user', status: 'pending' },
        reasonUnavailable: null,
      })
    }
    if (app?.type === 'system') {
      return acaoBase(finding, {
        type: 'manual_review', availability: 'available', state: 'available',
        title: 'Revisar aplicativo de sistema',
        description: 'Aplicativos de sistema nunca são removidos automaticamente pelo DiagPro.',
        guidance: 'Confirme a função do pacote com a documentação do fabricante. Não tente removê-lo pelo DiagPro.',
        reasonUnavailable: null,
        verification: { type: 'rescan_after_manual_action', status: 'pending' },
      })
    }
    return acaoBase(finding, {
      description: 'O pacote não foi confirmado como aplicativo removível de usuário.',
      reasonUnavailable: 'Aplicativo de usuário não confirmado pelo Package Manager.',
    })
  }

  const findingGuide = guideForFinding(finding)
  if (findingGuide) {
    const guide = findingGuide
    return acaoBase(finding, {
      type: 'manual_security_setting',
      availability: 'available',
      state: 'available',
      title: guide.title,
      description: guide.description,
      guidance: guide.guidance,
      reasonUnavailable: null,
      verification: { type: 'rescan_after_manual_action', status: 'pending' },
    })
  }

  if (findingRuleId(finding) === 'device.su_binary_accessible') {
    return acaoBase(finding, {
      type: 'manual_review', availability: 'available', state: 'available',
      description: 'Remover root sem conhecer o método utilizado pode danificar o sistema ou impedir a inicialização.',
      reasonUnavailable: 'A remoção de root exige análise técnica específica e não é segura para automação.',
      guidance: 'Confirme se a alteração foi intencional. Quando necessário, utilize o procedimento oficial do fabricante para restaurar o firmware.',
      verification: { type: 'rescan_after_manual_action', status: 'pending' },
    })
  }

  return acaoBase(finding, {})
}

function planejarRemediacoes(findings = [], apps = []) {
  return findings.map((finding) => planejarRemediacaoFinding(finding, apps))
}

module.exports = {
  GUIDE_BY_FINDING,
  findingRuleId,
  guideForFinding,
  pacoteValido,
  planejarRemediacaoFinding,
  planejarRemediacoes,
}
