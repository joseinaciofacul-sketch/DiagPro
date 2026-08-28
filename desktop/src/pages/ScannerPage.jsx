import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, AppWindow, BatteryCharging, CheckCircle2, ChevronRight,
  Cpu, HardDrive, Loader2, MemoryStick, Play, Settings2, ShieldCheck,
  SlidersHorizontal, Smartphone, Trash2, RotateCcw, Wrench, X,
} from 'lucide-react'
import useDeviceStatus from '../hooks/useDeviceStatus.js'
import DeviceCard from '../components/DeviceCard.jsx'
import { salvarDiagnostico } from '../services/diagnostics.js'
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

const NIVEIS_RISCO = {
  minimal: 'Mínimo',
  low: 'Baixo',
  moderate: 'Moderado',
  high: 'Alto',
  critical: 'Crítico',
}

const NIVEIS_CONFIANCA = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
}

const STATUS_REMEDIACAO = {
  available: 'Disponível',
  preparing: 'Preparando preview...',
  awaiting_confirmation: 'Aguardando confirmação',
  executing: 'Executando e verificando...',
  resolved: 'Resolvido nesta sessão',
  failed: 'Falha na correção',
  not_verified: 'Correção não verificada',
  not_available: 'Sem correção automática segura',
}

function valor(valorRecebido, sufixo = '') {
  return valorRecebido === null || valorRecebido === undefined ? 'Não disponível' : `${valorRecebido}${sufixo}`
}

function formatarEvidencia(evidence) {
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

function ScannerPage({ accessToken }) {
  const dispositivo = useDeviceStatus()
  const [modo, setModo] = useState('quick')
  const [modulos, setModulos] = useState(MODULOS_INICIAIS)
  const [resultado, setResultado] = useState(null)
  const [progresso, setProgresso] = useState(null)
  const [etapas, setEtapas] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [interrompido, setInterrompido] = useState(false)
  const [persistencia, setPersistencia] = useState({ status: 'idle', id: null })
  const [remediationStates, setRemediationStates] = useState({})
  const [remediationModal, setRemediationModal] = useState(null)
  const [openGuides, setOpenGuides] = useState({})
  const scanAtivoRef = useRef(null)
  const proximoScanIdRef = useRef(0)
  const persistenciaScanIdRef = useRef(0)
  const findings = Array.isArray(resultado?.security?.findings) ? resultado.security.findings : []
  const remediationActions = Array.isArray(resultado?.security?.remediationActions)
    ? resultado.security.remediationActions
    : []

  useEffect(() => {
    if (!window.diagpro?.onScanProgress) return undefined
    const unsubscribe = window.diagpro.onScanProgress((evento) => {
      const scanAtivo = scanAtivoRef.current
      if (!scanAtivo?.valido) return

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
    const scanAtivo = scanAtivoRef.current
    const perdeuDispositivoDoScan = scanAtivo?.valido
      && (dispositivo.status !== 'connected' || dispositivo.serial !== scanAtivo.serial)

    if (perdeuDispositivoDoScan) {
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
    && (modo !== 'custom' || modulos.length > 0)

  function alternarModulo(id) {
    setModulos((atuais) => atuais.includes(id)
      ? atuais.filter((item) => item !== id)
      : [...atuais, id])
  }

  function atualizarEstadoRemediacao(actionId, status, message = '') {
    setRemediationStates((atuais) => ({ ...atuais, [actionId]: { status, message } }))
  }

  function registrarAuditoria(remediation) {
    if (!remediation) return
    setResultado((atual) => atual ? {
      ...atual,
      remediations: [...(atual.remediations || []), remediation],
    } : atual)
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
      })
      if (preview?.ok !== true || preview.removable !== true || !preview.confirmationToken) {
        atualizarEstadoRemediacao(action.id, 'failed', preview?.message || 'O aplicativo não está disponível para remoção segura.')
        return
      }
      atualizarEstadoRemediacao(action.id, 'awaiting_confirmation')
      setRemediationModal({ finding, action, preview, confirmationToken: preview.confirmationToken })
    } catch {
      atualizarEstadoRemediacao(action.id, 'failed', 'Não foi possível preparar a remoção do aplicativo.')
    }
  }

  function cancelarPreviewRemocao() {
    if (!remediationModal || remediationStates[remediationModal.action.id]?.status === 'executing') return
    atualizarEstadoRemediacao(remediationModal.action.id, 'available')
    setRemediationModal(null)
  }

  async function confirmarRemocao() {
    const modal = remediationModal
    const api = window.diagpro
    if (
      !modal?.confirmationToken
      || remediationStates[modal.action.id]?.status === 'executing'
      || typeof api?.uninstallUserApp !== 'function'
    ) return

    atualizarEstadoRemediacao(modal.action.id, 'executing')
    try {
      const result = await api.uninstallUserApp({
        serial: dispositivo.serial,
        packageName: modal.finding.packageName,
        confirmationToken: modal.confirmationToken,
        findingId: modal.finding.id,
      })
      const status = ['resolved', 'failed', 'not_verified'].includes(result?.status)
        ? result.status
        : result?.ok
          ? 'not_verified'
          : 'failed'
      registrarAuditoria(result?.remediation || {
        findingId: modal.finding.id,
        action: 'uninstall_user_app',
        packageName: modal.finding.packageName,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status,
        verification: result?.verification || { status: 'not_verified', installed: null },
      })
      atualizarEstadoRemediacao(modal.action.id, status, result?.message || '')
    } catch {
      const now = new Date().toISOString()
      registrarAuditoria({
        findingId: modal.finding.id,
        action: 'uninstall_user_app',
        packageName: modal.finding.packageName,
        startedAt: now,
        finishedAt: now,
        status: 'failed',
        verification: { status: 'not_verified', installed: null },
      })
      atualizarEstadoRemediacao(modal.action.id, 'failed', 'Não foi possível executar a remoção.')
    } finally {
      setRemediationModal(null)
    }
  }

  async function iniciarDiagnostico() {
    if (!podeIniciar || !window.diagpro?.startScan) return
    const scanAtual = {
      id: proximoScanIdRef.current + 1,
      serial: dispositivo.serial,
      valido: true,
      interrompido: false,
    }
    proximoScanIdRef.current = scanAtual.id
    scanAtivoRef.current = scanAtual
    setCarregando(true)
    setErro('')
    setInterrompido(false)
    setResultado(null)
    setPersistencia({ status: 'idle', id: null })
    setRemediationStates({})
    setRemediationModal(null)
    setOpenGuides({})
    setEtapas([])
    setProgresso({ progress: 0, label: 'Preparando análise...' })

    try {
      const resposta = await window.diagpro.startScan({
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
      persistenciaScanIdRef.current = scanAtual.id
      setPersistencia({ status: 'saving', id: null })
      salvarDiagnostico(resposta.data, {
        serial: scanAtual.serial,
        accessToken,
      }).then((diagnostico) => {
        if (persistenciaScanIdRef.current !== scanAtual.id) return
        setPersistencia({ status: 'saved', id: diagnostico.id })
      }).catch(() => {
        if (persistenciaScanIdRef.current !== scanAtual.id) return
        setPersistencia({ status: 'error', id: null })
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

          <button className="scanner-start" onClick={iniciarDiagnostico} disabled={!podeIniciar}>
            {carregando ? <Loader2 size={19} className="spin" /> : <Play size={19} fill="currentColor" />}
            {carregando ? 'Analisando dispositivo...' : 'Iniciar análise'}
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
          </div>
          <div className="scanner-findings">
            <div className="scanner-findings-heading">
              <div><ShieldCheck size={18} /><strong>ACHADOS DE SEGURANÇA</strong></div>
              <span>{findings.length}</span>
            </div>
            {findings.length === 0 ? (
              <p className="scanner-findings-empty">Nenhum achado de segurança foi identificado pelas verificações disponíveis.</p>
            ) : (
              <div className="scanner-findings-list">
                {findings.map((finding, index) => {
                  const action = remediationActions.find((item) => item.findingId === finding.id)
                  const remediationState = action
                    ? remediationStates[action.id] || { status: action.state || action.availability }
                    : null
                  const actionBusy = ['preparing', 'awaiting_confirmation', 'executing', 'verifying'].includes(remediationState?.status)
                  return (
                  <article className={`scanner-finding severity-${finding.severity || 'info'}`} key={`${finding.id}-${index}`}>
                    <div className="scanner-finding-title">
                      <strong>{finding.title}</strong>
                      <span>{SEVERIDADES[finding.severity] || finding.severity || 'Informativo'}</span>
                    </div>
                    {finding.packageName && <code>{finding.packageName}</code>}
                    <p>{finding.description}</p>
                    {finding.packageName && finding.risk && (
                      <div className="scanner-finding-risk">
                        <span><b>Risco técnico</b>{NIVEIS_RISCO[finding.risk.level] || finding.risk.level} · {finding.risk.score}/100</span>
                        <span><b>Confiança</b>{NIVEIS_CONFIANCA[finding.risk.confidence] || finding.risk.confidence}</span>
                      </div>
                    )}
                    {finding.capabilities?.length > 0 && (
                      <small><b>Capacidades:</b> {finding.capabilities.map((capability) => capability.label).join(', ')}</small>
                    )}
                    {finding.risk?.reasons?.length > 0 && (
                      <div className="scanner-finding-reasons">
                        <b>Motivos:</b>
                        <ul>{finding.risk.reasons.map((reason) => <li key={reason.id}>{reason.message}</li>)}</ul>
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
                        {remediationState?.status && remediationState.status !== 'available' && action.type !== 'no_safe_action' && (
                          <div className={`scanner-remediation-status status-${remediationState.status}`}>
                            <strong>{STATUS_REMEDIACAO[remediationState.status] || remediationState.status}</strong>
                            {remediationState.message && <span>{remediationState.message}</span>}
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
                        {action.type === 'guide_user' && (
                          <>
                            <button onClick={() => setOpenGuides((atuais) => ({ ...atuais, [action.id]: !atuais[action.id] }))}>
                              <Wrench size={14} /> Como corrigir
                            </button>
                            {openGuides[action.id] && (
                              <div className="scanner-remediation-guide">
                                <strong>{action.title}</strong>
                                <p>{action.guidance}</p>
                                <button onClick={iniciarDiagnostico} disabled={!podeIniciar}><RotateCcw size={13} /> Verificar novamente</button>
                              </div>
                            )}
                          </>
                        )}
                        {action.type === 'no_safe_action' && (
                          <div className="scanner-remediation-unavailable">
                            <strong>Sem correção automática segura</strong>
                            <span>{action.reasonUnavailable}</span>
                            {action.guidance && <span>{action.guidance}</span>}
                          </div>
                        )}
                        {remediationState?.status === 'resolved' && (
                          <button onClick={iniciarDiagnostico} disabled={!podeIniciar}><RotateCcw size={14} /> Verificar novamente</button>
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
              <button onClick={cancelarPreviewRemocao} disabled={remediationStates[remediationModal.action.id]?.status === 'executing'} aria-label="Fechar confirmação"><X size={17} /></button>
            </header>
            <div className="scanner-remediation-preview">
              <div><span>Pacote</span><strong>{remediationModal.finding.packageName}</strong></div>
              <div><span>Motivo da atenção</span><strong>{remediationModal.finding.title}</strong></div>
              <div><span>Risco técnico</span><strong>{remediationModal.finding.risk ? `${NIVEIS_RISCO[remediationModal.finding.risk.level] || remediationModal.finding.risk.level} · ${remediationModal.finding.risk.score}/100` : 'Não aplicável'}</strong></div>
              <div><span>Evidências principais</span><strong>{formatarEvidencia(remediationModal.finding.evidence)}</strong></div>
              <div><span>Ação</span><strong>Desinstalar aplicativo de usuário</strong></div>
              <div><span>Impacto</span><strong>{remediationModal.preview.impact || remediationModal.action.impact}</strong></div>
            </div>
            <p className="scanner-remediation-warning"><AlertTriangle size={16} /> Dados e configurações locais do aplicativo podem ser perdidos. Esta ação não confirma que o aplicativo seja malware.</p>
            <footer>
              <button className="secondary" onClick={cancelarPreviewRemocao} disabled={remediationStates[remediationModal.action.id]?.status === 'executing'}>Cancelar</button>
              <button className="danger" onClick={confirmarRemocao} disabled={remediationStates[remediationModal.action.id]?.status === 'executing'}>
                {remediationStates[remediationModal.action.id]?.status === 'executing' ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                {remediationStates[remediationModal.action.id]?.status === 'executing' ? 'Removendo e verificando...' : 'Desinstalar aplicativo'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}

export default ScannerPage
