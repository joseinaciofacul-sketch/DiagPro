import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, AppWindow, BatteryCharging, CheckCircle2, ChevronRight,
  Cpu, CreditCard, HardDrive, Loader2, MemoryStick, Play, Settings2, ShieldCheck,
  SlidersHorizontal, Smartphone, Trash2, RotateCcw, Wrench, X,
} from 'lucide-react'
import useDeviceStatus from '../hooks/useDeviceStatus.js'
import DeviceCard from '../components/DeviceCard.jsx'
import { salvarDiagnostico, salvarRemediacao } from '../services/diagnostics.js'
import { getDiagnosticCapability } from '../services/subscription.js'
import { getDefaultScanMode } from '../utils/preferences.js'
import './ScannerPage.css'

const MODOS = [
  { id: 'quick', title: 'Rápida', description: 'Aplicativos, segurança, bateria e armazenamento.' },
  { id: 'complete', title: 'Completa', description: 'Executa todos os módulos disponíveis.' },
  { id: 'custom', title: 'Personalizada', description: 'Você escolhe quais módulos analisar.' },
]

const MODULOS = [
  { id: 'system', label: 'Sistema', icon: Smartphone },
  { id: 'apps', label: 'Aplicativos', icon: AppWindow },
  { id: 'security', label: 'Segurança', icon: ShieldCheck },
  { id: 'permissions', label: 'Permissões', icon: Settings2 },
  { id: 'battery', label: 'Bateria', icon: BatteryCharging },
  { id: 'storage', label: 'Armazenamento', icon: HardDrive },
  { id: 'performance', label: 'Desempenho', icon: Cpu },
]

const MODULOS_INICIAIS = ['system', 'apps', 'security', 'battery', 'storage']

const NOMES_ETAPAS = {
  identification: 'Identificação',
  system: 'Sistema',
  apps: 'Aplicativos',
  permissions: 'Permissões',
  security: 'Segurança',
  battery: 'Bateria',
  storage: 'Armazenamento',
  performance: 'Desempenho',
  consolidation: 'Consolidação',
}

const STATUS_ETAPAS = {
  running: 'Analisando...',
  completed: 'Concluído',
  unavailable: 'Indisponível',
  waiting: 'Aguardando',
}

const MENSAGEM_INTERRUPCAO = 'O dispositivo foi desconectado durante a análise. Reconecte-o e inicie um novo scan.'

const SEVERIDADES = {
  info: 'Informativo',
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',
  critical: 'Crítico',
}

const NIVEIS_CONFIANCA = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
}

const STATUS_RISCO_SEGURANCA = {
  calculated: 'Calculado',
  partial: 'Parcial',
  not_calculated: 'Não calculado',
  insufficient_data: 'Dados insuficientes',
}

const STATUS_REMEDIACAO = {
  available: 'Disponível',
  preparing: 'Preparando preview...',
  awaiting_confirmation: 'Aguardando confirmação',
  remediation_pending: 'Correção pendente',
  executing: 'Executando...',
  verifying: 'Verificando resultado...',
  cancel_requested: 'Cancelamento solicitado',
  resolved: 'Resolvido nesta sessão',
  verification_failed: 'Verificação falhou',
  failed: 'Falha na correção',
  not_verified: 'Correção não verificada',
  inconclusive: 'Resultado inconclusivo',
  canceled: 'Correção cancelada',
  device_disconnected: 'Dispositivo desconectado',
  not_authorized: 'ADB não autorizado',
  not_supported: 'Ação não suportada',
  not_available: 'Sem correção automática segura',
}

const MANUAL_ACTION_TYPES = new Set([
  'guide_user', 'manual_review', 'manual_security_setting',
  'manual_device_admin_review', 'manual_accessibility_review', 'manual_overlay_review',
])

function projectionIdForFinding(diagnostic, findingId) {
  const projection = Array.isArray(diagnostic?.security_findings)
    ? diagnostic.security_findings.find((item) => item?.id === findingId)
    : null
  return projection?.projection_id || null
}

const STATUS_SINCRONIZACAO = {
  saving: 'Sincronizando auditoria...',
  saved: 'Auditoria salva no histórico',
  failed: 'Auditoria não sincronizada',
  not_available: 'Auditoria mantida nesta sessão',
}

function valor(valorRecebido, sufixo = '') {
  return valorRecebido === null || valorRecebido === undefined ? 'Não disponível' : `${valorRecebido}${sufixo}`
}

function formatarEvidencia(evidence) {
  if (Array.isArray(evidence)) return evidence.map((item) => {
    const dado = item?.value
    const exibicao = dado && typeof dado === 'object' ? JSON.stringify(dado) : String(dado ?? '')
    return `${item?.key || item?.observationId || 'evidence'}: ${exibicao}`
  }).join(' · ')
  if (!evidence || typeof evidence !== 'object') return 'Evidência técnica não detalhada.'
  return Object.entries(evidence).map(([chave, dado]) => {
    const exibicao = Array.isArray(dado)
      ? dado.join(', ')
      : dado && typeof dado === 'object'
        ? Object.entries(dado).map(([subchave, valorInterno]) => `${subchave}: ${valorInterno}`).join(', ')
        : String(dado)
    return `${chave}: ${exibicao}`
  }).join(' · ')
}

function resumirHash(hash) {
  return typeof hash === 'string' && hash.length > 24
    ? `${hash.slice(0, 16)}…${hash.slice(-8)}`
    : hash || 'Não verificado'
}

function ScannerPage({ accessToken, onNavigate }) {
  const dispositivo = useDeviceStatus()
  const [modo, setModo] = useState(() => getDefaultScanMode())
  const [modulos, setModulos] = useState(MODULOS_INICIAIS)
  const [resultado, setResultado] = useState(null)
  const [progresso, setProgresso] = useState(null)
  const [etapas, setEtapas] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [interrompido, setInterrompido] = useState(false)
  const [persistencia, setPersistencia] = useState({ status: 'idle', id: null })
  const [licenca, setLicenca] = useState({ status: 'checking', capability: null, message: '' })
  const [remediationStates, setRemediationStates] = useState({})
  const [remediationModal, setRemediationModal] = useState(null)
  const [openGuides, setOpenGuides] = useState({})
  const scanAtivoRef = useRef(null)
  const proximoScanIdRef = useRef(0)
  const persistenciaDiagnosticoRef = useRef({ scanId: 0, id: null, data: null, promise: null })
  const remediationActionBindingsRef = useRef({})
  const findings = Array.isArray(resultado?.security?.findings) ? resultado.security.findings : []
  const securityRisk = resultado?.securityRisk || resultado?.security?.securityRisk || null
  const confirmedThreats = Array.isArray(resultado?.security?.confirmedThreats)
    ? resultado.security.confirmedThreats
    : []
  const remediationActions = Array.isArray(resultado?.security?.remediationActions)
    ? resultado.security.remediationActions
    : []

  const verificarLicenca = useCallback(async () => {
    setLicenca({ status: 'checking', capability: null, message: '' })
    try {
      const capability = await getDiagnosticCapability({ accessToken })
      setLicenca({
        status: capability.allowed ? 'allowed' : 'blocked',
        capability,
        message: capability.message,
      })
      return capability
    } catch (error) {
      setLicenca({
        status: error?.status === 401 ? 'auth-error' : 'error',
        capability: null,
        message: error?.status === 401
          ? 'Sua sessão expirou. Entre novamente para verificar a licença.'
          : 'Não foi possível verificar a licença. Tente novamente.',
      })
      return null
    }
  }, [accessToken])

  useEffect(() => { void verificarLicenca() }, [verificarLicenca])

  useEffect(() => {
    if (!window.diagpro?.onScanProgress) return undefined
    const unsubscribe = window.diagpro.onScanProgress((evento) => {
      const scanAtivo = scanAtivoRef.current
      if (!scanAtivo?.valido) return
      if (evento?.scanId && evento.scanId !== scanAtivo.id) return

      setProgresso(evento)

      if (!evento?.stage || !STATUS_ETAPAS[evento.status]) return
      setEtapas((atuais) => {
        const indiceExistente = atuais.findIndex((etapa) => etapa.id === evento.stage)
        const etapaAtualizada = {
          id: evento.stage,
          label: NOMES_ETAPAS[evento.stage] || evento.label || evento.stage,
          status: evento.status,
          index: evento.index,
        }

        if (indiceExistente === -1) return [...atuais, etapaAtualizada]
        return atuais.map((etapa, index) => (index === indiceExistente ? { ...etapa, ...etapaAtualizada } : etapa))
      })
    })

    return () => {
      if (scanAtivoRef.current) scanAtivoRef.current.valido = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!window.diagpro?.onRemediationProgress) return undefined
    return window.diagpro.onRemediationProgress((event) => {
      if (!event?.actionId || !event?.status) return
      const plannerActionId = remediationActionBindingsRef.current[event.actionId] || event.actionId
      setRemediationStates((current) => ({
        ...current,
        [plannerActionId]: { ...current[plannerActionId], status: event.status },
      }))
    })
  }, [])

  useEffect(() => {
    const scanAtivo = scanAtivoRef.current
    const perdeuDispositivoDoScan = scanAtivo?.valido
      && (dispositivo.status !== 'connected' || dispositivo.serial !== scanAtivo.serial)

    if (perdeuDispositivoDoScan) {
      if (typeof window.diagpro?.cancelScan === 'function') {
        void window.diagpro.cancelScan(scanAtivo.id)
      }
      scanAtivo.valido = false
      scanAtivo.interrompido = true
      setCarregando(false)
      setResultado(null)
      setErro('')
      setInterrompido(true)
      setRemediationModal(null)
      setProgresso((atual) => ({
        ...atual,
        progress: atual?.progress ?? 0,
        label: 'Análise interrompida',
      }))
      return
    }

    if (dispositivo.status !== 'connected' && !scanAtivo?.interrompido) {
      setCarregando(false)
      setProgresso(null)
      setEtapas([])
      setResultado(null)
      setErro('')
      setInterrompido(false)
      setRemediationModal(null)
    }
  }, [dispositivo.serial, dispositivo.status])

  const podeIniciar = dispositivo.status === 'connected'
    && !carregando
    && licenca.status === 'allowed'
    && (modo !== 'custom' || modulos.length > 0)

  function alternarModulo(id) {
    setModulos((atuais) => atuais.includes(id)
      ? atuais.filter((item) => item !== id)
      : [...atuais, id])
  }

  function atualizarEstadoRemediacao(actionId, status, message = '') {
    setRemediationStates((atuais) => ({
      ...atuais,
      [actionId]: { ...atuais[actionId], status, message },
    }))
  }

  function atualizarSincronizacaoRemediacao(actionId, persistenceStatus, persistenceMessage = '') {
    setRemediationStates((atuais) => ({
      ...atuais,
      [actionId]: { ...atuais[actionId], persistenceStatus, persistenceMessage },
    }))
  }

  function registrarAuditoria(remediation) {
    if (!remediation) return
    setResultado((atual) => {
      if (!atual) return atual
      const remediations = [...(atual.remediations || [])]
      const existingIndex = remediations.findIndex((item) => item?.executionId === remediation.executionId)
      if (existingIndex >= 0) remediations[existingIndex] = remediation
      else remediations.push(remediation)
      return { ...atual, remediations }
    })
  }

  async function persistirAuditoriaRemediacao(actionId, remediation) {
    if (!remediation?.executionId) {
      atualizarSincronizacaoRemediacao(
        actionId,
        'not_available',
        'O executor não retornou uma auditoria identificável para sincronização.',
      )
      return null
    }

    const binding = persistenciaDiagnosticoRef.current
    let diagnosticoId = binding.id
    if (!diagnosticoId && binding.promise) {
      atualizarSincronizacaoRemediacao(actionId, 'saving', 'Aguardando o diagnóstico ser salvo no histórico.')
      try {
        const diagnostico = await binding.promise
        if (persistenciaDiagnosticoRef.current !== binding) return
        diagnosticoId = diagnostico?.id
        binding.data = diagnostico
      } catch {
        diagnosticoId = null
      }
    }

    if (persistenciaDiagnosticoRef.current !== binding) return
    if (!diagnosticoId) {
      atualizarSincronizacaoRemediacao(
        actionId,
        'not_available',
        'A correção foi mantida nesta sessão, pois o diagnóstico não possui ID salvo.',
      )
      return null
    }

    const projectionId = remediation.projectionId
      || projectionIdForFinding(binding.data, remediation.findingId)
    const payload = projectionId ? { ...remediation, projectionId } : remediation
    atualizarSincronizacaoRemediacao(actionId, 'saving', 'Enviando o registro técnico da correção.')
    try {
      const resposta = await salvarRemediacao(diagnosticoId, payload, { accessToken })
      if (persistenciaDiagnosticoRef.current !== binding) return
      atualizarSincronizacaoRemediacao(
        actionId,
        'saved',
        resposta?.duplicate ? 'Este registro já estava salvo no histórico.' : `Vinculada ao diagnóstico #${diagnosticoId}.`,
      )
      return resposta
    } catch {
      if (persistenciaDiagnosticoRef.current !== binding) return
      atualizarSincronizacaoRemediacao(
        actionId,
        'failed',
        'A correção não será repetida; apenas o registro no histórico falhou.',
      )
      return null
    }
  }

  async function prepararRemocao(finding, action) {
    const api = window.diagpro
    if (
      action?.type !== 'uninstall_user_app'
      || action.availability !== 'available'
      || !finding.packageName
      || remediationStates[action.id]?.status === 'preparing'
      || remediationStates[action.id]?.status === 'executing'
      || typeof api?.getRemovalPreview !== 'function'
    ) return

    atualizarEstadoRemediacao(action.id, 'preparing')
    try {
      const preview = await api.getRemovalPreview({
        serial: dispositivo.serial,
        packageName: finding.packageName,
        finding: {
          id: finding.id,
          ruleId: finding.ruleId,
          category: finding.category,
          subjectType: finding.subjectType,
          packageName: finding.packageName,
          status: finding.status,
          title: finding.title,
          severity: finding.severity,
          evidenceConfidence: finding.evidenceConfidence,
        },
        action: { type: action.type, availability: action.availability },
        projectionId: projectionIdForFinding(persistenciaDiagnosticoRef.current.data, finding.id),
      })
      if (
        preview?.ok !== true
        || preview.removable !== true
        || !preview.confirmationToken
        || !preview.actionId
        || !Number.isInteger(preview.currentUserId)
      ) {
        atualizarEstadoRemediacao(action.id, 'failed', preview?.message || 'O aplicativo não está disponível para remoção segura.')
        return
      }
      remediationActionBindingsRef.current[preview.actionId] = action.id
      atualizarEstadoRemediacao(action.id, 'awaiting_confirmation')
      setRemediationModal({ finding, action, preview, confirmationToken: preview.confirmationToken })
    } catch {
      atualizarEstadoRemediacao(action.id, 'failed', 'Não foi possível preparar a remoção do aplicativo.')
    }
  }

  function cancelarPreviewRemocao() {
    if (!remediationModal || ['remediation_pending', 'executing', 'verifying', 'cancel_requested'].includes(remediationStates[remediationModal.action.id]?.status)) return
    if (typeof window.diagpro?.cancelRemediation === 'function') {
      void window.diagpro.cancelRemediation({
        actionId: remediationModal.preview.actionId,
        confirmationToken: remediationModal.confirmationToken,
      })
    }
    atualizarEstadoRemediacao(remediationModal.action.id, 'available')
    delete remediationActionBindingsRef.current[remediationModal.preview.actionId]
    setRemediationModal(null)
  }

  async function solicitarCancelamentoRemocao() {
    const modal = remediationModal
    if (!modal?.preview?.actionId || typeof window.diagpro?.cancelRemediation !== 'function') return
    atualizarEstadoRemediacao(modal.action.id, 'cancel_requested', 'O DiagPro interromperá a operação se o comando ainda não tiver sido disparado.')
    await window.diagpro.cancelRemediation({
      actionId: modal.preview.actionId,
      confirmationToken: modal.confirmationToken,
    })
  }

  async function confirmarRemocao() {
    const modal = remediationModal
    const api = window.diagpro
    if (
      !modal?.confirmationToken
      || remediationStates[modal.action.id]?.status === 'executing'
      || typeof api?.uninstallUserApp !== 'function'
    ) return

    const startedAt = new Date().toISOString()
    const projectionId = projectionIdForFinding(
      persistenciaDiagnosticoRef.current.data,
      modal.finding.id,
    ) || modal.preview.auditContext?.projectionId || null
    const pendingAudit = {
      ...modal.preview.auditContext,
      executionId: modal.preview.actionId,
      actionId: modal.preview.actionId,
      findingId: modal.finding.id,
      projectionId,
      startedAt,
      finishedAt: null,
      status: 'remediation_pending',
      actionDispatched: false,
      transitions: [{ status: 'remediation_pending', at: startedAt }],
      adbResult: null,
      verification: {
        status: 'not_verified', installed: null, source: 'package_manager',
        user: modal.preview.currentUserId,
      },
      error: null,
    }
    registrarAuditoria(pendingAudit)
    atualizarEstadoRemediacao(modal.action.id, 'remediation_pending', 'A confirmação foi registrada; o dispositivo será revalidado antes da remoção.')
    await persistirAuditoriaRemediacao(modal.action.id, pendingAudit)
    atualizarEstadoRemediacao(modal.action.id, 'executing')
    try {
      const result = await api.uninstallUserApp({
        serial: dispositivo.serial,
        packageName: modal.finding.packageName,
        androidUserId: modal.preview.currentUserId,
        confirmationToken: modal.confirmationToken,
        actionId: modal.preview.actionId,
        findingId: modal.finding.id,
        projectionId,
      })
      const status = result?.remediation?.status || (result?.ok ? 'inconclusive' : 'failed')
      const fallbackFinishedAt = new Date().toISOString()
      const remediation = result?.remediation || {
        ...pendingAudit,
        findingId: modal.finding.id,
        action: 'uninstall_user_app',
        packageName: modal.finding.packageName,
        finishedAt: fallbackFinishedAt,
        status,
        actionDispatched: false,
        transitions: [...pendingAudit.transitions, { status, at: fallbackFinishedAt }],
        adbResult: { status, code: result?.code || 'UNINSTALL_FAILED', output: null, actionDispatched: false },
        verification: result?.verification || { status: 'not_verified', installed: null },
        error: { code: result?.code || 'UNINSTALL_FAILED', message: result?.message || 'Não foi possível executar a remoção.' },
      }
      registrarAuditoria(remediation)
      atualizarEstadoRemediacao(modal.action.id, status, result?.message || '')
      void persistirAuditoriaRemediacao(modal.action.id, remediation)
    } catch (error) {
      const now = new Date().toISOString()
      const remediation = {
        ...pendingAudit,
        findingId: modal.finding.id,
        action: 'uninstall_user_app',
        packageName: modal.finding.packageName,
        finishedAt: now,
        status: 'failed',
        transitions: [...pendingAudit.transitions, { status: 'failed', at: now }],
        adbResult: { status: 'failed', code: 'IPC_REMEDIATION_FAILED', output: null, actionDispatched: false },
        verification: { status: 'not_verified', installed: null },
        error: { code: 'IPC_REMEDIATION_FAILED', message: error?.message || 'Não foi possível executar a remoção.' },
      }
      registrarAuditoria(remediation)
      atualizarEstadoRemediacao(modal.action.id, 'failed', 'Não foi possível executar a remoção.')
      void persistirAuditoriaRemediacao(modal.action.id, remediation)
    } finally {
      delete remediationActionBindingsRef.current[modal.preview.actionId]
      setRemediationModal(null)
    }
  }

  async function iniciarDiagnostico() {
    const configuracaoValida = dispositivo.status === 'connected'
      && !carregando
      && (modo !== 'custom' || modulos.length > 0)
    if (!configuracaoValida || licenca.status !== 'allowed' || !window.diagpro?.startScan) return

    const capability = await verificarLicenca()
    if (!capability?.allowed || dispositivo.status !== 'connected') return

    const scanSequence = proximoScanIdRef.current + 1
    const scanId = typeof window.diagpro.createScanId === 'function'
      ? await window.diagpro.createScanId()
      : globalThis.crypto.randomUUID()
    const scanAtual = {
      id: scanId,
      serial: dispositivo.serial,
      valido: true,
      interrompido: false,
    }
    proximoScanIdRef.current = scanSequence
    scanAtivoRef.current = scanAtual
    setCarregando(true)
    setErro('')
    setInterrompido(false)
    setResultado(null)
    setPersistencia({ status: 'idle', id: null })
    persistenciaDiagnosticoRef.current = { scanId: scanAtual.id, id: null, data: null, promise: null }
    remediationActionBindingsRef.current = {}
    setRemediationStates({})
    setRemediationModal(null)
    setOpenGuides({})
    setEtapas([])
    setProgresso({ progress: 0, label: 'Preparando análise...' })

    try {
      const resposta = await window.diagpro.startScan({
        scanId: scanAtual.id,
        serial: dispositivo.serial,
        mode: modo,
        modules: modo === 'custom' ? modulos : undefined,
      })
      if (scanAtivoRef.current !== scanAtual || !scanAtual.valido) return

      if (!resposta?.ok) {
        setErro(resposta?.message || 'Não foi possível concluir a análise.')
        return
      }
      setResultado(resposta.data)
      setEtapas((atuais) => {
        const finais = Object.entries(resposta.data?.stages || {})
        return finais.reduce((acumuladas, [id, etapa]) => {
          if (!STATUS_ETAPAS[etapa.status]) return acumuladas
          const indiceExistente = acumuladas.findIndex((item) => item.id === id)
          const etapaFinal = { id, label: NOMES_ETAPAS[id] || id, status: etapa.status }
          if (indiceExistente === -1) return [...acumuladas, etapaFinal]
          return acumuladas.map((item, index) => (index === indiceExistente ? { ...item, ...etapaFinal } : item))
        }, atuais)
      })
      setProgresso({ progress: 100, label: 'Análise concluída' })
      setPersistencia({ status: 'saving', id: null })
      const promisePersistencia = salvarDiagnostico(resposta.data, {
        serial: scanAtual.serial,
        accessToken,
      })
      const bindingPersistencia = {
        scanId: scanAtual.id,
        id: null,
        data: null,
        promise: promisePersistencia,
      }
      persistenciaDiagnosticoRef.current = bindingPersistencia
      promisePersistencia.then((diagnostico) => {
        if (persistenciaDiagnosticoRef.current !== bindingPersistencia) return
        bindingPersistencia.id = diagnostico.id
        bindingPersistencia.data = diagnostico
        setPersistencia({ status: 'saved', id: diagnostico.id })
      }).catch((error) => {
        if (persistenciaDiagnosticoRef.current !== bindingPersistencia) return
        setPersistencia({ status: 'error', id: null })
        if (error?.status === 403 && error?.details?.code) {
          setLicenca({
            status: 'blocked',
            capability: error.details,
            message: error.details.message || 'A licença não permite salvar um novo diagnóstico.',
          })
        }
      })
    } catch {
      if (scanAtivoRef.current !== scanAtual || !scanAtual.valido) return
      setErro('Erro ao comunicar com o dispositivo. Verifique a conexão e tente novamente.')
    } finally {
      if (scanAtivoRef.current === scanAtual && scanAtual.valido) {
        scanAtivoRef.current = null
        setCarregando(false)
      }
    }
  }

  return (
    <div className="scanner-page">
      <header className="scanner-heading">
        <div><h1>Scanner</h1><p>Execute uma análise técnica com dados coletados diretamente do dispositivo Android.</p></div>
      </header>

      <section className="scanner-card">
        <div className="scanner-card-title">DISPOSITIVO CONECTADO</div>
        <DeviceCard estado={dispositivo} />
      </section>

      <div className="scanner-workspace">
        <section className="scanner-card scanner-setup">
          <div className="scanner-section-heading"><SlidersHorizontal size={18} /><div><h2>Tipo de análise</h2><p>Escolha o nível de detalhamento do diagnóstico.</p></div></div>
          <div className="scanner-modes">
            {MODOS.map((item) => (
              <button key={item.id} className={`scanner-mode ${modo === item.id ? 'selected' : ''}`} onClick={() => setModo(item.id)} disabled={carregando}>
                <span><strong>{item.title}</strong><small>{item.description}</small></span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>

          {modo === 'custom' && (
            <div className="scanner-modules">
              <h3>Módulos da análise</h3>
              <div className="scanner-module-grid">
                {MODULOS.map(({ id, label, icon: Icon }) => (
                  <label className={modulos.includes(id) ? 'checked' : ''} key={id}>
                    <input type="checkbox" checked={modulos.includes(id)} onChange={() => alternarModulo(id)} disabled={carregando} />
                    <Icon size={18} /><span>{label}</span>
                  </label>
                ))}
              </div>
              {modulos.length === 0 && <p className="scanner-inline-warning">Selecione ao menos um módulo.</p>}
            </div>
          )}

          {licenca.status === 'checking' && <div className="scanner-license-state checking"><Loader2 size={17} className="spin" /><div><strong>Verificando licença...</strong><span>Consultando a autorização real no backend.</span></div></div>}
          {licenca.status === 'blocked' && <div className="scanner-license-state blocked"><AlertTriangle size={18} /><div><strong>Novo diagnóstico indisponível</strong><span>{licenca.message}</span>{licenca.capability?.code === 'monthly_diagnostic_limit_reached' && <small>Uso atual: {licenca.capability.usage} de {licenca.capability.limit} diagnósticos no mês.</small>}</div><button type="button" onClick={() => onNavigate?.('Plano e assinatura')}><CreditCard size={14} /> Ver plano e assinatura</button></div>}
          {(licenca.status === 'error' || licenca.status === 'auth-error') && <div className="scanner-license-state error"><AlertTriangle size={18} /><div><strong>Não foi possível verificar a licença</strong><span>{licenca.message}</span></div><button type="button" onClick={verificarLicenca}><RotateCcw size={14} /> Tentar novamente</button></div>}
          {licenca.status === 'allowed' && licenca.capability?.limit !== null && <div className="scanner-license-usage"><ShieldCheck size={15} /><span>Licença liberada: {licenca.capability.usage} de {licenca.capability.limit} diagnósticos utilizados neste mês.</span></div>}

          <button className="scanner-start" onClick={iniciarDiagnostico} disabled={!podeIniciar}>
            {carregando || licenca.status === 'checking' ? <Loader2 size={19} className="spin" /> : <Play size={19} fill="currentColor" />}
            {carregando ? 'Analisando dispositivo...' : licenca.status === 'checking' ? 'Verificando licença...' : 'Iniciar análise'}
          </button>
        </section>

        <section className="scanner-card scanner-progress-card">
          <div className="scanner-section-heading"><Cpu size={18} /><div><h2>Andamento</h2><p>Acompanhe as etapas executadas pelo scanner.</p></div></div>
          {!progresso && !resultado && <div className="scanner-empty"><ShieldCheck size={42} /><p>A análise ainda não foi iniciada.</p></div>}
          {progresso && (
            <div className="scanner-progress">
              <div className="scanner-progress-copy"><span>{progresso.label}</span><strong>{progresso.progress ?? 0}%</strong></div>
              <div className="scanner-progress-track"><span style={{ width: `${progresso.progress ?? 0}%` }} /></div>
            </div>
          )}
          {erro && <div className="scanner-error"><AlertTriangle size={18} /><span>{erro}</span></div>}
          {interrompido && <div className="scanner-error"><AlertTriangle size={18} /><span>{MENSAGEM_INTERRUPCAO}</span></div>}
          {etapas.length > 0 && (
            <div className="scanner-stages">
              {etapas.map((etapa) => (
                <div className={`scanner-stage-${etapa.status}`} key={etapa.id}>
                  {etapa.status === 'completed' && <CheckCircle2 size={16} />}
                  {etapa.status === 'running' && <Loader2 size={16} className="spin" />}
                  {etapa.status === 'unavailable' && <AlertTriangle size={16} />}
                  {etapa.status === 'waiting' && <span className="scanner-stage-waiting" aria-hidden="true" />}
                  <span>{etapa.label}</span><small>{STATUS_ETAPAS[etapa.status]}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {resultado && (
        <section className="scanner-card scanner-results-card">
          <div className="scanner-card-title">RESULTADO DA ANÁLISE</div>
          <div className="scanner-result-grid">
            <div><HardDrive size={22} /><span>Armazenamento</span><strong>{valor(resultado.storage?.usedGb, ' GB')} usados</strong><small>{valor(resultado.storage?.freeGb, ' GB')} livres</small></div>
            <div><MemoryStick size={22} /><span>Memória RAM</span><strong>{valor(resultado.memory?.availableGb, ' GB')} disponíveis</strong><small>Total: {valor(resultado.memory?.totalGb, ' GB')}</small></div>
            <div><AppWindow size={22} /><span>Aplicativos</span><strong>{valor(resultado.apps?.total)}</strong><small>{resultado.apps ? `${resultado.apps.userTotal} do usuário e ${resultado.apps.systemTotal} do sistema` : 'Módulo não executado'}</small></div>
            <div><ShieldCheck size={22} /><span>Saúde do sistema</span><strong>{resultado.health?.available ? `${resultado.health.score}% — ${resultado.health.label}` : 'Não calculada'}</strong><small>{resultado.health?.explanation || 'Dados insuficientes'}</small></div>
            <div><AlertTriangle size={22} /><span>Risco de Segurança</span><strong>{Number.isFinite(securityRisk?.score) ? `${securityRisk.score}/100 — ${securityRisk.label}` : STATUS_RISCO_SEGURANCA[securityRisk?.status] || 'Não calculado'}</strong><small>{securityRisk?.explanation || 'O scan não produziu cobertura suficiente para calcular o risco técnico.'}</small></div>
          </div>
          {securityRisk && (
            <details className="scanner-security-risk-details">
              <summary>Ver detalhes do Risco de Segurança</summary>
              <p>{securityRisk.meaning}</p>
              <div className="scanner-security-risk-breakdown">
                <span><b>Dispositivo/configuração</b>{securityRisk.breakdown?.deviceRisk ?? 0}</span>
                <span><b>Aplicativos</b>{securityRisk.breakdown?.appRisk ?? 0}</span>
                <span><b>Ameaças confirmadas</b>{securityRisk.breakdown?.confirmedThreatRisk ?? 0}</span>
                <span><b>Cobertura</b>{securityRisk.coverage?.coveragePercent ?? 0}% · {securityRisk.coverage?.status || 'não disponível'}</span>
                <span><b>Fórmula</b>v{securityRisk.version}</span>
              </div>
              {securityRisk.factors?.length > 0 ? (
                <div className="scanner-security-risk-factors">
                  <b>Principais fatores</b>
                  <ul>{securityRisk.factors.slice(0, 8).map((factor) => (
                    <li key={`${factor.findingId}-${factor.subjectId}`}>
                      <span>{factor.ruleId}{factor.subjectType === 'app' ? ` · ${factor.subjectId}` : ''}</span>
                      <strong>+{factor.contribution}</strong>
                    </li>
                  ))}</ul>
                </div>
              ) : (
                <p>Nenhum finding contribuiu diretamente para o score.</p>
              )}
            </details>
          )}
          <div className="scanner-findings">
            <div className="scanner-findings-heading">
              <div><ShieldCheck size={18} /><strong>ACHADOS DE SEGURANÇA</strong></div>
              <span>{findings.length}</span>
            </div>
            <p className="scanner-findings-empty">Ameaças confirmadas: {confirmedThreats.length}. {confirmedThreats.length === 0 ? 'Nenhuma ameaça foi confirmada pelas evidências disponíveis.' : 'Consulte as evidências confirmadas registradas.'}</p>
            {findings.length === 0 ? (
              <p className="scanner-findings-empty">Nenhum achado para revisão foi identificado pelas verificações disponíveis.</p>
            ) : (
              <div className="scanner-findings-list">
                {findings.map((finding, index) => {
                  const action = remediationActions.find((item) => item.findingId === finding.id)
                  const remediationState = action
                    ? remediationStates[action.id] || { status: action.state || action.availability }
                    : null
                  const actionBusy = ['preparing', 'awaiting_confirmation', 'remediation_pending', 'executing', 'verifying', 'cancel_requested'].includes(remediationState?.status)
                  return (
                  <article className={`scanner-finding severity-${finding.severity || 'info'}`} key={`${finding.id}-${index}`}>
                    <div className="scanner-finding-title">
                      <strong>{finding.title}</strong>
                      <span>{SEVERIDADES[finding.severity] || finding.severity || 'Informativo'}</span>
                    </div>
                    {finding.packageName && <code>{finding.packageName}</code>}
                    <p>{finding.summary || finding.description}</p>
                    {finding.evidenceConfidence && (
                      <div className="scanner-finding-risk">
                        <span><b>Severidade</b>{SEVERIDADES[finding.severity] || finding.severity}</span>
                        <span><b>Confiança da evidência</b>{NIVEIS_CONFIANCA[finding.evidenceConfidence] || finding.evidenceConfidence}</span>
                      </div>
                    )}
                    {finding.capabilities?.length > 0 && (
                      <small><b>Capacidades:</b> {finding.capabilities.map((capability) => capability.label).join(', ')}</small>
                    )}
                    {finding.technicalExplanation && (
                      <div className="scanner-finding-reasons">
                        <b>Explicação técnica:</b>
                        <p>{finding.technicalExplanation}</p>
                      </div>
                    )}
                    {finding.packageName && (finding.identity || finding.origin || finding.integrity) && (
                      <details className="scanner-finding-technical">
                        <summary>Detalhes técnicos do aplicativo</summary>
                        <dl>
                          <div><dt>Versão</dt><dd>{finding.identity?.versionName || 'Não disponível'}{finding.identity?.versionCode ? ` (${finding.identity.versionCode})` : ''}</dd></div>
                          <div><dt>Origem</dt><dd>{finding.origin?.label || 'Não verificada'}</dd></div>
                          <div><dt>Instalador</dt><dd>{finding.origin?.installerPackageName || finding.origin?.initiatingPackageName || 'Não disponível'}</dd></div>
                          <div><dt>APK</dt><dd>{finding.identity?.apkPath || 'Não disponível'}</dd></div>
                          <div><dt>SHA-256</dt><dd>{resumirHash(finding.integrity?.hash?.hash)}</dd></div>
                          <div><dt>Assinatura</dt><dd>{finding.integrity?.signature?.certificateDigest ? resumirHash(finding.integrity.signature.certificateDigest) : 'Certificado não verificado'}{finding.integrity?.signature?.schemeVersion ? ` · esquema ${finding.integrity.signature.schemeVersion}` : ''}</dd></div>
                        </dl>
                      </details>
                    )}
                    <small><b>Evidência:</b> {formatarEvidencia(finding.evidence)}</small>
                    <small><b>Recomendação:</b> {finding.recommendation}</small>
                    {action && (
                      <div className="scanner-remediation">
                        {remediationState?.status && remediationState.status !== 'available' && !['no_safe_action', 'no_action'].includes(action.type) && (
                          <div className={`scanner-remediation-status status-${remediationState.status}`}>
                            <strong>{STATUS_REMEDIACAO[remediationState.status] || remediationState.status}</strong>
                            {remediationState.message && <span>{remediationState.message}</span>}
                          </div>
                        )}
                        {remediationState?.persistenceStatus && (
                          <div className={`scanner-remediation-sync sync-${remediationState.persistenceStatus}`}>
                            <strong>{STATUS_SINCRONIZACAO[remediationState.persistenceStatus] || remediationState.persistenceStatus}</strong>
                            {remediationState.persistenceMessage && <span>{remediationState.persistenceMessage}</span>}
                          </div>
                        )}
                        {action.type === 'uninstall_user_app' && remediationState?.status === 'available' && (
                          <button onClick={() => prepararRemocao(finding, action)} disabled={actionBusy || carregando || dispositivo.status !== 'connected'}>
                            <Trash2 size={14} /> Remover aplicativo
                          </button>
                        )}
                        {action.type === 'uninstall_user_app' && actionBusy && (
                          <button disabled><Loader2 size={14} className="spin" />{STATUS_REMEDIACAO[remediationState.status]}</button>
                        )}
                        {MANUAL_ACTION_TYPES.has(action.type) && (
                          <>
                            <button onClick={() => setOpenGuides((atuais) => ({ ...atuais, [action.id]: !atuais[action.id] }))}>
                              <Wrench size={14} /> Como corrigir
                            </button>
                            {openGuides[action.id] && (
                              <div className="scanner-remediation-guide">
                                <strong>{action.title}</strong>
                                <p>{action.guidance}</p>
                                <button onClick={iniciarDiagnostico} disabled={!podeIniciar}><RotateCcw size={13} /> Executar nova análise</button>
                              </div>
                            )}
                          </>
                        )}
                        {['no_safe_action', 'no_action'].includes(action.type) && (
                          <div className="scanner-remediation-unavailable">
                            <strong>Sem correção automática segura</strong>
                            <span>{action.reasonUnavailable}</span>
                            {action.guidance && <span>{action.guidance}</span>}
                          </div>
                        )}
                        {['resolved', 'verification_failed', 'inconclusive', 'failed', 'canceled', 'device_disconnected'].includes(remediationState?.status) && (
                          <button onClick={iniciarDiagnostico} disabled={!podeIniciar}><RotateCcw size={14} /> Executar nova análise</button>
                        )}
                      </div>
                    )}
                  </article>
                  )
                })}
              </div>
            )}
          </div>
          {resultado.warnings?.length > 0 && <div className="scanner-warnings"><strong>Avisos da coleta</strong>{resultado.warnings.map((aviso, index) => <p key={`${aviso.stage}-${index}`}>{aviso.message}</p>)}</div>}
          <p className="scanner-disclaimer">Os resultados refletem apenas os sinais técnicos acessíveis via ADB. O DiagPro não afirma ausência de malware sem evidências verificáveis.</p>
          {persistencia.status === 'saving' && <p className="scanner-persistence saving">Salvando no histórico...</p>}
          {persistencia.status === 'saved' && <p className="scanner-persistence saved">Diagnóstico salvo no histórico. ID: {persistencia.id}</p>}
          {persistencia.status === 'error' && <p className="scanner-persistence error">O diagnóstico foi concluído, mas não pôde ser salvo no histórico.</p>}
        </section>
      )}
      {remediationModal && (
        <div className="scanner-remediation-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) cancelarPreviewRemocao()
        }}>
          <section className="scanner-remediation-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-remediation-title">
            <header>
              <div><Trash2 size={18} /><h2 id="scanner-remediation-title">Confirmar remoção do aplicativo</h2></div>
              <button onClick={cancelarPreviewRemocao} disabled={['remediation_pending', 'executing', 'verifying', 'cancel_requested'].includes(remediationStates[remediationModal.action.id]?.status)} aria-label="Fechar confirmação"><X size={17} /></button>
            </header>
            <div className="scanner-remediation-preview">
              <div><span>Dispositivo</span><strong>{[remediationModal.preview.preview?.device?.manufacturer, remediationModal.preview.preview?.device?.model].filter(Boolean).join(' ') || 'Dispositivo Android'} · {remediationModal.preview.preview?.device?.serial || dispositivo.serial}</strong></div>
              <div><span>Aplicativo</span><strong>{remediationModal.preview.preview?.app?.name || 'Nome não disponível'}</strong></div>
              <div><span>Pacote</span><strong>{remediationModal.finding.packageName}</strong></div>
              <div><span>Tipo</span><strong>Aplicativo do usuário</strong></div>
              <div><span>Usuário Android</span><strong>{remediationModal.preview.currentUserId}</strong></div>
              <div><span>Motivo da atenção</span><strong>{remediationModal.finding.title}</strong></div>
              <div><span>Classificação do achado</span><strong>{SEVERIDADES[remediationModal.finding.severity] || remediationModal.finding.severity || 'Informativo'} · confiança da evidência {NIVEIS_CONFIANCA[remediationModal.finding.evidenceConfidence] || remediationModal.finding.evidenceConfidence || 'não informada'}</strong></div>
              <div><span>Evidências principais</span><strong>{formatarEvidencia(remediationModal.finding.evidence)}</strong></div>
              <div><span>Ação</span><strong>Desinstalar aplicativo de usuário</strong></div>
              <div><span>Impacto</span><strong>{remediationModal.preview.impact || remediationModal.action.impact}</strong></div>
              <div><span>Reversibilidade</span><strong>{remediationModal.preview.preview?.reversible ? 'Reversível' : 'Não garantida; pode exigir nova instalação'}</strong></div>
              <div><span>Confirmação</span><strong>Obrigatória e válida somente para este preview</strong></div>
              <div><span>Riscos</span><strong>{remediationModal.preview.preview?.risks?.join(' ') || 'Dados locais do aplicativo podem ser perdidos.'}</strong></div>
              <div><span>Verificação posterior</span><strong>{remediationModal.preview.preview?.verification?.description || 'O DiagPro verificará a ausência do pacote no mesmo usuário Android.'}</strong></div>
            </div>
            <p className="scanner-remediation-warning"><AlertTriangle size={16} /> Dados e configurações locais do aplicativo podem ser perdidos. Esta ação não confirma que o aplicativo seja malware.</p>
            <footer>
              <button
                className="secondary"
                onClick={['remediation_pending', 'executing', 'verifying'].includes(remediationStates[remediationModal.action.id]?.status) ? solicitarCancelamentoRemocao : cancelarPreviewRemocao}
                disabled={remediationStates[remediationModal.action.id]?.status === 'cancel_requested'}
              >
                {['remediation_pending', 'executing', 'verifying'].includes(remediationStates[remediationModal.action.id]?.status) ? 'Solicitar cancelamento' : 'Cancelar'}
              </button>
              <button className="danger" onClick={confirmarRemocao} disabled={['remediation_pending', 'executing', 'verifying', 'cancel_requested'].includes(remediationStates[remediationModal.action.id]?.status)}>
                {['remediation_pending', 'executing', 'verifying', 'cancel_requested'].includes(remediationStates[remediationModal.action.id]?.status) ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                {['remediation_pending', 'executing', 'verifying', 'cancel_requested'].includes(remediationStates[remediationModal.action.id]?.status) ? (STATUS_REMEDIACAO[remediationStates[remediationModal.action.id]?.status] || 'Processando...') : 'Desinstalar aplicativo'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}

export default ScannerPage
