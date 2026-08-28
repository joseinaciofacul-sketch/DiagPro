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
    type: 'no_safe_action',
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

function planejarRemediacaoFinding(finding, apps = []) {
  const app = finding.packageName
    ? apps.find((item) => item.packageName === finding.packageName)
    : null

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
    return acaoBase(finding, {
      description: app?.type === 'system'
        ? 'Aplicativos de sistema não podem ser removidos pelo DiagPro.'
        : 'O pacote não foi confirmado como aplicativo removível de usuário.',
      reasonUnavailable: app?.type === 'system'
        ? 'Aplicativo de sistema protegido.'
        : 'Aplicativo de usuário não confirmado pelo Package Manager.',
    })
  }

  if (GUIDE_BY_FINDING[finding.id]) {
    const guide = GUIDE_BY_FINDING[finding.id]
    return acaoBase(finding, {
      type: 'guide_user',
      availability: 'available',
      state: 'available',
      title: guide.title,
      description: guide.description,
      guidance: guide.guidance,
      reasonUnavailable: null,
      verification: { type: 'rescan_after_manual_action', status: 'pending' },
    })
  }

  if (finding.id === 'device.su_binary_accessible') {
    return acaoBase(finding, {
      description: 'Remover root sem conhecer o método utilizado pode danificar o sistema ou impedir a inicialização.',
      reasonUnavailable: 'A remoção de root exige análise técnica específica e não é segura para automação.',
      guidance: 'Confirme se a alteração foi intencional. Quando necessário, utilize o procedimento oficial do fabricante para restaurar o firmware.',
    })
  }

  return acaoBase(finding, {})
}

function planejarRemediacoes(findings = [], apps = []) {
  return findings.map((finding) => planejarRemediacaoFinding(finding, apps))
}

module.exports = {
  GUIDE_BY_FINDING,
  pacoteValido,
  planejarRemediacaoFinding,
  planejarRemediacoes,
}
