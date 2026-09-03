import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ChevronRight, Clock3, FileText, Filter,
  Loader2, RefreshCw, Search, ShieldAlert, Smartphone, Trash2, Wrench, X,
} from 'lucide-react'
import { listarDiagnosticos, salvarRemediacao } from '../services/diagnostics.js'
import './ThreatsPage.css'

const STATUS_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'detected', label: 'Em revisão' },
  { id: 'pending', label: 'Correção pendente' },
  { id: 'resolved', label: 'Resolvidos' },
  { id: 'failed', label: 'Falha' },
  { id: 'not_verified', label: 'Não verificados' },
]

const STATUS_LABELS = {
  detected: 'Em revisão',
  pending: 'Correção pendente',
  resolved: 'Resolvido',
  failed: 'Falha na correção',
  not_verified: 'Não verificado',
}

const SEVERITY_LABELS = {
  info: 'Informativo', low: 'Baixo', medium: 'Médio', high: 'Alto', critical: 'Crítico',
}

const ACTION_LABELS = {
  uninstall_user_app: 'Desinstalação de aplicativo',
  guide_user: 'Orientação manual',
  no_safe_action: 'Sem correção automática segura',
  manual_review: 'Revisão manual',
  manual_security_setting: 'Revisão de configuração de segurança',
  manual_device_admin_review: 'Revisão manual de administrador do dispositivo',
  manual_accessibility_review: 'Revisão manual de acessibilidade',
  manual_overlay_review: 'Revisão manual de sobreposição',
  rescan: 'Nova análise',
  no_action: 'Sem ação automática segura',
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== ''
}

function normalizeList(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  throw new Error('A API retornou um formato de diagnósticos inválido.')
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR')
}

function timestamp(value) {
  const parsed = value ? new Date(value).getTime() : Number.NaN
  return Number.isNaN(parsed) ? null : parsed
}

function latestRemediation(remediations, findingId) {
  const matches = remediations
    .map((remediation, index) => ({ remediation, index }))
    .filter(({ remediation }) => remediation?.findingId === findingId)

  if (!matches.length) return null
  return matches.reduce((latest, candidate) => {
    const latestTime = timestamp(latest.remediation?.finishedAt || latest.remediation?.startedAt)
    const candidateTime = timestamp(candidate.remediation?.finishedAt || candidate.remediation?.startedAt)
    if (candidateTime !== null && (latestTime === null || candidateTime > latestTime)) return candidate
    if (candidateTime === latestTime && candidate.index > latest.index) return candidate
    return latest
  }).remediation
}

function consolidatedStatus(remediation, findingStatus) {
  if (remediation?.status === 'remediation_pending' || findingStatus === 'remediation_pending') return 'pending'
  if (remediation?.status === 'resolved') return 'resolved'
  if (['failed', 'verification_failed'].includes(remediation?.status)) return 'failed'
  if (['not_verified', 'inconclusive', 'device_disconnected', 'not_authorized', 'not_supported'].includes(remediation?.status)) return 'not_verified'
  if (findingStatus === 'resolved') return 'resolved'
  if (findingStatus === 'verification_failed') return 'failed'
  return 'detected'
}

const REMEDIATION_STATUS = {
  resolved: 'Resolvido', verification_failed: 'Verificação falhou', failed: 'Falha',
  inconclusive: 'Resultado inconclusivo', canceled: 'Cancelado',
  device_disconnected: 'Dispositivo desconectado', not_authorized: 'ADB não autorizado',
  not_supported: 'Ação não suportada', not_verified: 'Não verificado',
}

function actionLabel(action) {
  return ACTION_LABELS[action?.type] || action?.title || action?.type || ''
}

function remediationActionLabel(remediation) {
  return ACTION_LABELS[remediation?.action] || remediation?.action || ''
}

function verificationText(verification) {
  if (!verification || typeof verification !== 'object') return ''
  if (verification.status === 'not_verified') return 'O resultado da ação não pôde ser verificado.'
  if (verification.status !== 'verified') return ''

  const source = verification.source === 'package_manager' ? ' pelo Package Manager' : ''
  const user = hasValue(verification.user) ? ` para o usuário Android ${verification.user}` : ''
  if (verification.installed === false) return `Ausência do pacote confirmada${source}${user}.`
  if (verification.installed === true) return `O pacote continuava instalado${source}${user}.`
  return 'A verificação foi registrada sem o estado de instalação do pacote.'
}

function formatEvidence(evidence) {
  if (Array.isArray(evidence)) return evidence.filter((item) => item && typeof item === 'object').map((item, index) => ({
    key: item.key || item.observationId || `evidence-${index + 1}`,
    value: item.value && typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value ?? ''),
  }))
  if (!evidence || typeof evidence !== 'object') return []
  return Object.entries(evidence).filter(([, value]) => (
    hasValue(value) && (!Array.isArray(value) || value.length > 0)
  )).map(([key, value]) => {
    if (Array.isArray(value)) return { key, value: value.join(', ') }
    if (value && typeof value === 'object') return { key, value: JSON.stringify(value) }
    return { key, value: String(value) }
  })
}

function buildOccurrences(diagnostics) {
  return diagnostics.flatMap((diagnostic) => {
    const technicalResult = diagnostic?.resultado_tecnico
    const security = technicalResult && typeof technicalResult === 'object' ? technicalResult.security : null
    const findings = diagnostic?.security_projection_available && Array.isArray(diagnostic?.security_findings)
      ? diagnostic.security_findings
      : Array.isArray(security?.findings) ? security.findings : []
    const remediations = Array.isArray(technicalResult?.remediations) ? technicalResult.remediations : []
    const actions = Array.isArray(security?.remediationActions) ? security.remediationActions : []

    return findings.map((finding, findingIndex) => {
      const findingId = finding?.id
      const remediation = hasValue(findingId) ? latestRemediation(remediations, findingId) : null
      const plannedAction = hasValue(findingId)
        ? actions.find((action) => action?.findingId === findingId) || null
        : null
      return {
        key: `${diagnostic.id}:${finding?.id || findingIndex}`,
        diagnostic,
        finding,
        remediation,
        plannedAction,
        status: consolidatedStatus(remediation, finding?.status),
        diagnosticTime: timestamp(diagnostic.finalizado_em),
      }
    })
  }).sort((a, b) => (b.diagnosticTime ?? -Infinity) - (a.diagnosticTime ?? -Infinity))
}

function ThreatsPage({ accessToken, onNavigate, onOpenReport, device = { status: 'waiting' } }) {
  const [diagnostics, setDiagnostics] = useState([])
  const [loadState, setLoadState] = useState({ status: 'loading', message: '' })
  const [statusFilter, setStatusFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedOccurrence, setSelectedOccurrence] = useState(null)
  const [remediationFlow, setRemediationFlow] = useState(null)
  const currentDeviceRef = useRef(device)
  currentDeviceRef.current = device

  const loadDiagnostics = useCallback(async () => {
    setLoadState({ status: 'loading', message: '' })
    try {
      const response = await listarDiagnosticos({ accessToken })
      setDiagnostics(normalizeList(response))
      setLoadState({ status: 'ready', message: '' })
    } catch (error) {
      setDiagnostics([])
      setLoadState({
        status: error?.status === 401 ? 'auth-error' : 'error',
        message: error?.status === 401
          ? 'Sua sessão expirou. Entre novamente para consultar os findings.'
          : 'Não foi possível carregar os diagnósticos persistidos.',
      })
    }
  }, [accessToken])

  useEffect(() => { loadDiagnostics() }, [loadDiagnostics])

  useEffect(() => {
    if (!window.diagpro?.onRemediationProgress) return undefined
    return window.diagpro.onRemediationProgress((event) => {
      setRemediationFlow((current) => (
        current?.preview?.actionId === event?.actionId
          ? { ...current, status: event.status }
          : current
      ))
    })
  }, [])

  useEffect(() => {
    if (!['preparing', 'awaiting_confirmation'].includes(remediationFlow?.status)) return
    const expectedSerial = remediationFlow.occurrence?.diagnostic?.serial
    if (device.status === 'connected' && device.serial === expectedSerial) return
    if (remediationFlow.preview?.actionId) {
      void window.diagpro?.cancelRemediation?.({
        actionId: remediationFlow.preview.actionId,
        confirmationToken: remediationFlow.confirmationToken,
      })
    }
    setRemediationFlow((current) => current ? {
      ...current,
      status: 'failed',
      message: device.status === 'connected'
        ? 'O dispositivo conectado mudou. Abra um novo preview para o aparelho correto.'
        : 'O dispositivo foi desconectado. Reconecte-o e abra um novo preview.',
    } : current)
  }, [device.serial, device.status])

  const occurrences = useMemo(() => buildOccurrences(diagnostics), [diagnostics])
  const semanticCounts = useMemo(() => diagnostics.reduce((counts, diagnostic) => {
    const security = diagnostic?.resultado_tecnico?.security
    return {
      confirmedThreats: counts.confirmedThreats + (Array.isArray(security?.confirmedThreats) ? security.confirmedThreats.length : 0),
      observations: counts.observations + (Array.isArray(security?.observations) ? security.observations.length : 0),
    }
  }, { confirmedThreats: 0, observations: 0 }), [diagnostics])
  const severities = useMemo(() => [...new Set(
    occurrences.map(({ finding }) => finding?.severity).filter(hasValue),
  )].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR')), [occurrences])

  const counts = useMemo(() => STATUS_FILTERS.slice(1).reduce((result, filter) => ({
    ...result,
    [filter.id]: occurrences.filter((occurrence) => occurrence.status === filter.id).length,
  }), {}), [occurrences])

  const filteredOccurrences = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
    return occurrences.filter((occurrence) => {
      const { diagnostic, finding, status } = occurrence
      const searchable = [
        finding?.title, finding?.summary, finding?.description, finding?.packageName, finding?.subjectId, finding?.category,
        diagnostic?.fabricante, diagnostic?.modelo, diagnostic?.serial, diagnostic?.id,
      ].filter(hasValue).join(' ').toLocaleLowerCase('pt-BR')
      return (statusFilter === 'all' || status === statusFilter)
        && (severityFilter === 'all' || finding?.severity === severityFilter)
        && (!normalizedQuery || searchable.includes(normalizedQuery))
    })
  }, [occurrences, query, severityFilter, statusFilter])

  const selected = selectedOccurrence
  const evidence = selected ? formatEvidence(selected.finding?.evidence) : []
  const selectedActionLabel = selected ? actionLabel(selected.plannedAction) : ''
  const executedActionLabel = selected ? remediationActionLabel(selected.remediation) : ''
  const selectedVerification = selected ? verificationText(selected.remediation?.verification) : ''

  const selectedPackage = selected?.finding?.packageName
    || (selected?.finding?.subjectType === 'app' ? selected.finding.subjectId : null)
  const canOpenPreview = selected?.plannedAction?.type === 'uninstall_user_app'
    && selected.plannedAction.availability === 'available'
    && ['detected', 'failed', 'not_verified'].includes(selected.status)
    && device.status === 'connected'
    && device.serial === selected.diagnostic.serial

  async function openRemediationPreview() {
    if (!canOpenPreview || !selectedPackage || typeof window.diagpro?.getRemovalPreview !== 'function') return
    const expectedSerial = selected.diagnostic.serial
    setRemediationFlow({ status: 'preparing', occurrence: selected, message: '', syncMessage: '' })
    try {
      const preview = await window.diagpro.getRemovalPreview({
        serial: expectedSerial,
        packageName: selectedPackage,
        finding: {
          id: selected.finding.id,
          ruleId: selected.finding.ruleId,
          category: selected.finding.category,
          subjectType: selected.finding.subjectType,
          packageName: selectedPackage,
          status: selected.finding.status,
          title: selected.finding.title,
          severity: selected.finding.severity,
          evidenceConfidence: selected.finding.evidenceConfidence,
        },
        action: { type: 'uninstall_user_app', availability: 'available' },
        projectionId: selected.finding.projection_id || null,
      })
      if (currentDeviceRef.current?.status !== 'connected' || currentDeviceRef.current?.serial !== expectedSerial) {
        if (preview?.actionId) {
          void window.diagpro?.cancelRemediation?.({
            actionId: preview.actionId,
            confirmationToken: preview.confirmationToken,
          })
        }
        setRemediationFlow({
          status: 'failed', occurrence: selected,
          message: 'A conexão do dispositivo mudou durante a validação. Abra um novo preview.', syncMessage: '',
        })
        return
      }
      if (preview?.ok !== true || !preview.actionId || !preview.confirmationToken || !Number.isInteger(preview.currentUserId)) {
        setRemediationFlow({ status: 'failed', occurrence: selected, message: preview?.message || 'Não foi possível preparar a remoção segura.', syncMessage: '' })
        return
      }
      setRemediationFlow({
        status: 'awaiting_confirmation', occurrence: selected, preview,
        confirmationToken: preview.confirmationToken, message: '', syncMessage: '',
      })
    } catch (error) {
      setRemediationFlow({ status: 'failed', occurrence: selected, message: error?.message || 'Não foi possível abrir o preview.', syncMessage: '' })
    }
  }

  async function persistThreatRemediation(payload) {
    try {
      const response = await salvarRemediacao(remediationFlow.occurrence.diagnostic.id, payload, { accessToken })
      setRemediationFlow((current) => current ? { ...current, syncMessage: 'Auditoria sincronizada com o histórico.' } : current)
      return response
    } catch {
      setRemediationFlow((current) => current ? {
        ...current,
        syncMessage: 'O resultado técnico foi preservado nesta sessão, mas a auditoria não pôde ser sincronizada.',
      } : current)
      return null
    }
  }

  async function confirmThreatRemediation() {
    const flow = remediationFlow
    const occurrence = flow?.occurrence
    if (
      flow?.status !== 'awaiting_confirmation'
      || !flow.preview?.actionId
      || typeof window.diagpro?.uninstallUserApp !== 'function'
    ) return
    if (device.status !== 'connected' || device.serial !== occurrence?.diagnostic?.serial) {
      void window.diagpro?.cancelRemediation?.({
        actionId: flow.preview.actionId,
        confirmationToken: flow.confirmationToken,
      })
      setRemediationFlow((current) => current ? {
        ...current,
        status: 'failed',
        message: 'O dispositivo não corresponde mais ao diagnóstico. Abra um novo preview.',
      } : current)
      return
    }
    const startedAt = new Date().toISOString()
    const pending = {
      ...flow.preview.auditContext,
      executionId: flow.preview.actionId,
      actionId: flow.preview.actionId,
      projectionId: occurrence.finding.projection_id || null,
      findingId: occurrence.finding.id,
      startedAt,
      finishedAt: null,
      status: 'remediation_pending',
      actionDispatched: false,
      transitions: [{ status: 'remediation_pending', at: startedAt }],
      adbResult: null,
      verification: {
        status: 'not_verified', installed: null, source: 'package_manager',
        user: flow.preview.currentUserId,
      },
      error: null,
    }
    setRemediationFlow((current) => ({ ...current, status: 'remediation_pending', pending }))
    await persistThreatRemediation(pending)
    setRemediationFlow((current) => ({ ...current, status: 'executing' }))
    try {
      const result = await window.diagpro.uninstallUserApp({
        serial: occurrence.diagnostic.serial,
        packageName: selectedPackage,
        androidUserId: flow.preview.currentUserId,
        confirmationToken: flow.confirmationToken,
        actionId: flow.preview.actionId,
        findingId: occurrence.finding.id,
        projectionId: occurrence.finding.projection_id || null,
      })
      const auditStatus = result?.remediation?.status || (result?.ok ? 'inconclusive' : 'failed')
      const finishedAt = new Date().toISOString()
      const finalAudit = result?.remediation || {
        ...pending,
        finishedAt,
        status: auditStatus,
        transitions: [...pending.transitions, { status: auditStatus, at: finishedAt }],
        adbResult: { status: auditStatus, code: result?.code || 'UNINSTALL_FAILED', output: null, actionDispatched: false },
        verification: result?.verification || pending.verification,
        error: { code: result?.code || 'UNINSTALL_FAILED', message: result?.message || 'A correção falhou.' },
      }
      await persistThreatRemediation(finalAudit)
      setRemediationFlow((current) => ({
        ...current, status: 'result', auditStatus, resultMessage: result?.message || '', finalAudit,
      }))
    } catch (error) {
      const finishedAt = new Date().toISOString()
      const finalAudit = {
        ...pending,
        finishedAt,
        status: 'failed',
        transitions: [...pending.transitions, { status: 'failed', at: finishedAt }],
        adbResult: { status: 'failed', code: 'IPC_REMEDIATION_FAILED', output: null, actionDispatched: false },
        error: { code: 'IPC_REMEDIATION_FAILED', message: error?.message || 'A correção falhou.' },
      }
      await persistThreatRemediation(finalAudit)
      setRemediationFlow((current) => ({ ...current, status: 'result', auditStatus: 'failed', resultMessage: finalAudit.error.message, finalAudit }))
    }
  }

  async function cancelThreatRemediation() {
    const flow = remediationFlow
    if (!flow) return
    if (['remediation_pending', 'executing', 'verifying'].includes(flow.status)) {
      setRemediationFlow((current) => ({ ...current, status: 'cancel_requested' }))
      await window.diagpro?.cancelRemediation?.({
        actionId: flow.preview?.actionId,
        confirmationToken: flow.confirmationToken,
      })
      return
    }
    if (flow.preview?.actionId) {
      await window.diagpro?.cancelRemediation?.({
        actionId: flow.preview.actionId,
        confirmationToken: flow.confirmationToken,
      })
    }
    setRemediationFlow(null)
  }

  function closeThreatRemediationResult() {
    setRemediationFlow(null)
    setSelectedOccurrence(null)
    void loadDiagnostics()
  }

  return (
    <section className="dp-threats-page" aria-labelledby="dp-threats-title">
      <header className="dp-threats-header">
        <div><h1 id="dp-threats-title">Ameaças e achados</h1><p>Ameaças confirmadas são separadas de achados técnicos que ainda exigem revisão.</p></div>
        <button className="dp-threats-refresh" type="button" onClick={loadDiagnostics} disabled={loadState.status === 'loading'}><RefreshCw size={16} className={loadState.status === 'loading' ? 'spin' : ''} /> Atualizar</button>
      </header>

      {loadState.status === 'ready' && (
        <>
          <div className="dp-threats-semantic-summary">
            <div><span>Ameaças confirmadas</span><strong>{semanticCounts.confirmedThreats}</strong><p>{semanticCounts.confirmedThreats === 0 ? 'Nenhuma ameaça confirmada pelas evidências disponíveis.' : 'Evidências confirmadas registradas.'}</p></div>
            <div><span>Achados para revisão</span><strong>{occurrences.length}</strong><p>Combinações técnicas que não equivalem a malware.</p></div>
            <div><span>Observações técnicas</span><strong>{semanticCounts.observations}</strong><p>Sinais coletados que podem não gerar alerta.</p></div>
          </div>
          <div className="dp-threats-summary" aria-label="Resumo dos achados carregados">
            {STATUS_FILTERS.slice(1).map((filter) => <div className={`status-${filter.id}`} key={filter.id}><span>{filter.label}</span><strong>{counts[filter.id]}</strong></div>)}
          </div>
        </>
      )}

      {loadState.status === 'ready' && occurrences.length > 0 && (
        <div className="dp-threats-toolbar">
          <label className="dp-threats-search"><Search size={16} /><span className="dp-threats-visually-hidden">Buscar findings</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por finding, pacote, dispositivo ou serial" /></label>
          <div className="dp-threats-filters" aria-label="Filtrar findings por status"><Filter size={16} aria-hidden="true" />{STATUS_FILTERS.map((filter) => <button className={statusFilter === filter.id ? 'active' : ''} key={filter.id} type="button" onClick={() => setStatusFilter(filter.id)}>{filter.label}</button>)}</div>
          {severities.length > 0 && <label className="dp-threats-severity-filter"><span>Severidade</span><select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option value="all">Todos</option>{severities.map((severity) => <option value={severity} key={severity}>{SEVERITY_LABELS[severity] || severity}</option>)}</select></label>}
        </div>
      )}

      <div className="dp-threats-card">
        <div className="dp-threats-card-heading"><div><h2>Achados que merecem revisão</h2>{loadState.status === 'ready' && <p>{filteredOccurrences.length} ocorrência{filteredOccurrences.length === 1 ? '' : 's'} exibida{filteredOccurrences.length === 1 ? '' : 's'}</p>}</div></div>
        {loadState.status === 'loading' && <div className="dp-threats-state"><Loader2 size={29} className="spin" /><strong>Carregando diagnósticos...</strong><p>Consultando os registros reais do usuário autenticado.</p></div>}
        {(loadState.status === 'error' || loadState.status === 'auth-error') && <div className="dp-threats-state error"><AlertTriangle size={31} /><strong>{loadState.status === 'auth-error' ? 'Autenticação necessária' : 'Erro ao carregar dados'}</strong><p>{loadState.message}</p><button type="button" onClick={loadDiagnostics}>Tentar novamente</button></div>}
        {loadState.status === 'ready' && occurrences.length === 0 && <div className="dp-threats-state"><ShieldAlert size={34} /><strong>Nenhum achado para revisão</strong><p>Também não há afirmação absoluta de que o dispositivo esteja livre de ameaças.</p></div>}
        {loadState.status === 'ready' && occurrences.length > 0 && filteredOccurrences.length === 0 && <div className="dp-threats-state"><Search size={32} /><strong>Nenhuma ocorrência corresponde aos filtros</strong><p>Ajuste a busca ou os filtros para consultar outros findings.</p></div>}

        {loadState.status === 'ready' && filteredOccurrences.length > 0 && (
          <div className="dp-threats-list">
            {filteredOccurrences.map((occurrence) => {
              const { diagnostic, finding, plannedAction, remediation, status } = occurrence
              const action = actionLabel(plannedAction)
              return (
                <button className="dp-threats-item" type="button" key={occurrence.key} onClick={() => setSelectedOccurrence(occurrence)}>
                  <div className={`dp-threats-finding-icon severity-${finding?.severity || 'unknown'}`}><ShieldAlert size={18} /></div>
                  <div className="dp-threats-item-main"><strong>{finding?.title || 'Achado sem título registrado'}</strong>{(finding?.summary || finding?.description) && <p>{finding.summary || finding.description}</p>}<span>{[finding?.packageName || (finding?.subjectType === 'app' ? finding?.subjectId : null), [diagnostic?.fabricante, diagnostic?.modelo].filter(Boolean).join(' '), diagnostic?.serial].filter(Boolean).join(' · ')}</span></div>
                  <div className="dp-threats-item-meta"><span>Diagnóstico</span><strong>#{diagnostic.id}</strong>{formatDate(diagnostic.finalizado_em) && <small>{formatDate(diagnostic.finalizado_em)}</small>}</div>
                  {finding?.severity && <span className={`dp-threats-severity severity-${finding.severity}`}>{SEVERITY_LABELS[finding.severity] || finding.severity}</span>}
                  <span className={`dp-threats-status status-${status}`}>{STATUS_LABELS[status]}</span>
                  {action && <div className="dp-threats-action"><Wrench size={13} /><span>{action}</span>{remediation?.status && <small>{STATUS_LABELS[status]}</small>}</div>}
                  <ChevronRight size={18} className="dp-threats-chevron" />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {selected && (
        <div className="dp-threats-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOccurrence(null) }}>
          <section className="dp-threats-modal" role="dialog" aria-modal="true" aria-labelledby="dp-threats-modal-title">
            <header><div><ShieldAlert size={20} /><span><h2 id="dp-threats-modal-title">{selected.finding?.title || 'Achado sem título registrado'}</h2><small>Diagnóstico #{selected.diagnostic.id}{formatDate(selected.diagnostic.finalizado_em) ? ` · ${formatDate(selected.diagnostic.finalizado_em)}` : ''}</small></span></div><button type="button" aria-label="Fechar detalhes" onClick={() => setSelectedOccurrence(null)}><X size={19} /></button></header>
            <div className="dp-threats-modal-content">
              <section><h3><AlertTriangle size={15} /> Achado para revisão</h3><dl><div><dt>Status</dt><dd><span className={`dp-threats-status status-${selected.status}`}>{STATUS_LABELS[selected.status]}</span></dd></div>{selected.finding?.ruleId && <div><dt>Regra</dt><dd>{selected.finding.ruleId}</dd></div>}{selected.finding?.category && <div><dt>Tipo</dt><dd>{selected.finding.category}</dd></div>}{selected.finding?.severity && <div><dt>Severidade</dt><dd>{SEVERITY_LABELS[selected.finding.severity] || selected.finding.severity}</dd></div>}{selected.finding?.evidenceConfidence && <div><dt>Confiança da evidência</dt><dd>{selected.finding.evidenceConfidence}</dd></div>}{hasValue(selected.finding?.scoreContribution) && <div><dt>Contribuição no score</dt><dd>{selected.finding.scoreContribution}</dd></div>}{selected.finding?.scorerVersion && <div><dt>Fórmula</dt><dd>v{selected.finding.scorerVersion}</dd></div>}{(selected.finding?.packageName || selected.finding?.subjectType === 'app') && <div><dt>Pacote</dt><dd><code>{selected.finding.packageName || selected.finding.subjectId}</code></dd></div>}</dl>{(selected.finding?.summary || selected.finding?.description) && <p>{selected.finding.summary || selected.finding.description}</p>}{selected.finding?.technicalExplanation && <p>{selected.finding.technicalExplanation}</p>}{evidence.length > 0 && <div className="dp-threats-evidence"><strong>Evidências registradas</strong>{evidence.map((item, index) => <div key={`${item.key}-${index}`}><span>{item.key}</span><code>{item.value}</code></div>)}</div>}</section>
              <section><h3><Smartphone size={15} /> Dispositivo</h3><dl>{selected.diagnostic.fabricante && <div><dt>Fabricante</dt><dd>{selected.diagnostic.fabricante}</dd></div>}{selected.diagnostic.modelo && <div><dt>Modelo</dt><dd>{selected.diagnostic.modelo}</dd></div>}{selected.diagnostic.serial && <div><dt>Serial</dt><dd>{selected.diagnostic.serial}</dd></div>}{selected.diagnostic.versao_android && <div><dt>Android</dt><dd>{selected.diagnostic.versao_android}</dd></div>}{selected.diagnostic.security_patch && <div><dt>Patch</dt><dd>{selected.diagnostic.security_patch}</dd></div>}</dl></section>
              <section><h3><Wrench size={15} /> Correção</h3>{selected.finding?.recommendation && <div className="dp-threats-correction-block"><span>Recomendação do finding</span><strong>{selected.finding.recommendation}</strong></div>}{selectedActionLabel && <div className="dp-threats-correction-block"><span>Ação proposta</span><strong>{selectedActionLabel}</strong>{selected.plannedAction?.guidance && <p>{selected.plannedAction.guidance}</p>}{selected.plannedAction?.reasonUnavailable && <p>{selected.plannedAction.reasonUnavailable}</p>}</div>}{selected.remediation ? <div className="dp-threats-correction-block"><span>Ação executada</span><strong>{executedActionLabel || 'Ação sem identificação registrada'}</strong><p>Resultado: {STATUS_LABELS[selected.status]}</p>{selected.remediation.finishedAt && <small>Conclusão: {formatDate(selected.remediation.finishedAt)}</small>}{selectedVerification && <p>{selectedVerification}</p>}</div> : <p className="dp-threats-no-data">Nenhuma execução de correção registrada para este finding.</p>}{selected.plannedAction?.type === 'uninstall_user_app' && selected.plannedAction.availability === 'available' && <div className="dp-threats-remediation-entry"><button type="button" onClick={openRemediationPreview} disabled={!canOpenPreview || remediationFlow?.status === 'preparing'}>{remediationFlow?.status === 'preparing' ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Abrir preview seguro</button>{device.status !== 'connected' && <small>Conecte e autorize o dispositivo para revalidar esta ação.</small>}{device.status === 'connected' && device.serial !== selected.diagnostic.serial && <small>O dispositivo conectado não corresponde ao serial deste diagnóstico.</small>}{selected.status === 'pending' && <small>Esta correção já está pendente no histórico.</small>}</div>}<div className="dp-threats-report-link"><div><RefreshCw size={18} /><span><strong>Nova verificação</strong><small>O snapshot anterior não será alterado; um novo scan produzirá um novo diagnóstico e score.</small></span></div><button type="button" onClick={() => { setSelectedOccurrence(null); onNavigate?.('Scanner') }}>Ir para o Scanner</button></div></section>
              <section><h3><Clock3 size={15} /> Histórico</h3><div className="dp-threats-report-link"><div><FileText size={18} /><span><strong>Diagnóstico #{selected.diagnostic.id}</strong><small>O histórico integral permanece no relatório correspondente.</small></span></div><button type="button" onClick={() => { setSelectedOccurrence(null); if (onOpenReport) onOpenReport(selected.diagnostic.id); else onNavigate?.('Relatórios') }}>Ir para Relatórios</button></div></section>
            </div>
          </section>
        </div>
      )}
      {remediationFlow && (
        <div className="dp-threats-remediation-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !['remediation_pending', 'executing', 'verifying', 'cancel_requested'].includes(remediationFlow.status)) {
            if (remediationFlow.status === 'result') closeThreatRemediationResult()
            else void cancelThreatRemediation()
          }
        }}>
          <section className="dp-threats-remediation-modal" role="dialog" aria-modal="true" aria-labelledby="dp-threats-remediation-title">
            <header><div><Trash2 size={19} /><span><h2 id="dp-threats-remediation-title">Remediação segura</h2><small>{remediationFlow.occurrence?.finding?.title}</small></span></div><button type="button" aria-label="Fechar remediação" disabled={['remediation_pending', 'executing', 'verifying', 'cancel_requested'].includes(remediationFlow.status)} onClick={remediationFlow.status === 'result' ? closeThreatRemediationResult : () => void cancelThreatRemediation()}><X size={18} /></button></header>
            <div className="dp-threats-remediation-content">
              {remediationFlow.status === 'preparing' && <div className="dp-threats-remediation-state"><Loader2 size={26} className="spin" /><strong>Revalidando dispositivo e aplicativo...</strong><p>Nenhuma ação será executada antes da confirmação.</p></div>}
              {remediationFlow.status === 'failed' && <div className="dp-threats-remediation-state error"><AlertTriangle size={26} /><strong>Preview indisponível</strong><p>{remediationFlow.message}</p></div>}
              {remediationFlow.preview && remediationFlow.status !== 'result' && (
                <>
                  <dl>
                    <div><dt>Dispositivo</dt><dd>{[remediationFlow.preview.preview?.device?.manufacturer, remediationFlow.preview.preview?.device?.model].filter(Boolean).join(' ') || 'Dispositivo Android'} · {remediationFlow.preview.preview?.device?.serial}</dd></div>
                    <div><dt>Aplicativo</dt><dd>{remediationFlow.preview.preview?.app?.name || 'Nome não disponível'}</dd></div>
                    <div><dt>Package name</dt><dd><code>{remediationFlow.preview.preview?.app?.packageName}</code></dd></div>
                    <div><dt>Tipo</dt><dd>Aplicativo do usuário</dd></div>
                    <div><dt>Usuário Android</dt><dd>{remediationFlow.preview.currentUserId}</dd></div>
                    <div><dt>Finding</dt><dd>{remediationFlow.occurrence?.finding?.title}</dd></div>
                    <div><dt>Ação</dt><dd>Desinstalar aplicativo de usuário</dd></div>
                    <div><dt>Impacto</dt><dd>{remediationFlow.preview.preview?.impact}</dd></div>
                    <div><dt>Reversibilidade</dt><dd>Não garantida; pode exigir nova instalação</dd></div>
                    <div><dt>Verificação</dt><dd>{remediationFlow.preview.preview?.verification?.description}</dd></div>
                  </dl>
                  <p className="dp-threats-remediation-warning"><AlertTriangle size={15} /> {remediationFlow.preview.preview?.risks?.join(' ') || 'Dados locais podem ser perdidos.'}</p>
                  {remediationFlow.syncMessage && <p className="dp-threats-remediation-sync">{remediationFlow.syncMessage}</p>}
                  {['remediation_pending', 'executing', 'verifying', 'cancel_requested'].includes(remediationFlow.status) && <div className="dp-threats-remediation-state"><Loader2 size={24} className="spin" /><strong>{remediationFlow.status === 'verifying' ? 'Verificando o mesmo pacote e usuário Android...' : remediationFlow.status === 'cancel_requested' ? 'Cancelamento solicitado...' : 'Executando remediação segura...'}</strong><p>Se o comando já tiver sido disparado, o resultado será tratado como inconclusivo até nova verificação.</p></div>}
                </>
              )}
              {remediationFlow.status === 'result' && <div className={`dp-threats-remediation-result status-${remediationFlow.auditStatus}`}><strong>{REMEDIATION_STATUS[remediationFlow.auditStatus] || remediationFlow.auditStatus}</strong><p>{remediationFlow.resultMessage || 'A operação terminou com resultado estruturado.'}</p>{verificationText(remediationFlow.finalAudit?.verification) && <p>{verificationText(remediationFlow.finalAudit.verification)}</p>}{remediationFlow.syncMessage && <small>{remediationFlow.syncMessage}</small>}</div>}
            </div>
            <footer>
              {remediationFlow.status === 'awaiting_confirmation' && <><button className="secondary" type="button" onClick={() => void cancelThreatRemediation()}>Cancelar</button><button className="danger" type="button" onClick={confirmThreatRemediation}><Trash2 size={14} /> Confirmar desinstalação</button></>}
              {['remediation_pending', 'executing', 'verifying'].includes(remediationFlow.status) && <button className="secondary" type="button" onClick={() => void cancelThreatRemediation()}>Solicitar cancelamento</button>}
              {remediationFlow.status === 'cancel_requested' && <button className="secondary" type="button" disabled>Cancelamento solicitado</button>}
              {remediationFlow.status === 'failed' && <button className="secondary" type="button" onClick={() => void cancelThreatRemediation()}>Fechar</button>}
              {remediationFlow.status === 'result' && <><button className="secondary" type="button" onClick={closeThreatRemediationResult}>Fechar</button><button className="primary" type="button" onClick={() => { setRemediationFlow(null); setSelectedOccurrence(null); onNavigate?.('Scanner') }}><RefreshCw size={14} /> Executar nova análise</button></>}
            </footer>
          </section>
        </div>
      )}
    </section>
  )
}

export default ThreatsPage
