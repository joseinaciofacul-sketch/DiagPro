import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ChevronRight, Clock3, FileText, Filter,
  Loader2, RefreshCw, Search, ShieldAlert, Smartphone, Wrench, X,
} from 'lucide-react'
import { listarDiagnosticos } from '../services/diagnostics.js'
import './ThreatsPage.css'

const STATUS_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'detected', label: 'Detectados' },
  { id: 'resolved', label: 'Resolvidos' },
  { id: 'failed', label: 'Falha' },
  { id: 'not_verified', label: 'Não verificados' },
]

const STATUS_LABELS = {
  detected: 'Detectado',
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

function consolidatedStatus(remediation) {
  if (remediation?.status === 'resolved') return 'resolved'
  if (remediation?.status === 'failed') return 'failed'
  if (remediation?.status === 'not_verified') return 'not_verified'
  return 'detected'
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
    const findings = Array.isArray(security?.findings) ? security.findings : []
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
        status: consolidatedStatus(remediation),
        diagnosticTime: timestamp(diagnostic.finalizado_em),
      }
    })
  }).sort((a, b) => (b.diagnosticTime ?? -Infinity) - (a.diagnosticTime ?? -Infinity))
}

function ThreatsPage({ accessToken, onNavigate, onOpenReport }) {
  const [diagnostics, setDiagnostics] = useState([])
  const [loadState, setLoadState] = useState({ status: 'loading', message: '' })
  const [statusFilter, setStatusFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedOccurrence, setSelectedOccurrence] = useState(null)

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

  const occurrences = useMemo(() => buildOccurrences(diagnostics), [diagnostics])
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
        finding?.title, finding?.description, finding?.packageName, finding?.category,
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

  return (
    <section className="dp-threats-page" aria-labelledby="dp-threats-title">
      <header className="dp-threats-header">
        <div><h1 id="dp-threats-title">Ameaças</h1><p>Visão consolidada dos findings de segurança registrados nos diagnósticos.</p></div>
        <button className="dp-threats-refresh" type="button" onClick={loadDiagnostics} disabled={loadState.status === 'loading'}><RefreshCw size={16} className={loadState.status === 'loading' ? 'spin' : ''} /> Atualizar</button>
      </header>

      {loadState.status === 'ready' && (
        <div className="dp-threats-summary" aria-label="Resumo dos findings carregados">
          {STATUS_FILTERS.slice(1).map((filter) => <div className={`status-${filter.id}`} key={filter.id}><span>{filter.label}</span><strong>{counts[filter.id]}</strong></div>)}
        </div>
      )}

      {loadState.status === 'ready' && occurrences.length > 0 && (
        <div className="dp-threats-toolbar">
          <label className="dp-threats-search"><Search size={16} /><span className="dp-threats-visually-hidden">Buscar findings</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por finding, pacote, dispositivo ou serial" /></label>
          <div className="dp-threats-filters" aria-label="Filtrar findings por status"><Filter size={16} aria-hidden="true" />{STATUS_FILTERS.map((filter) => <button className={statusFilter === filter.id ? 'active' : ''} key={filter.id} type="button" onClick={() => setStatusFilter(filter.id)}>{filter.label}</button>)}</div>
          {severities.length > 0 && <label className="dp-threats-severity-filter"><span>Risco</span><select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option value="all">Todos</option>{severities.map((severity) => <option value={severity} key={severity}>{SEVERITY_LABELS[severity] || severity}</option>)}</select></label>}
        </div>
      )}

      <div className="dp-threats-card">
        <div className="dp-threats-card-heading"><div><h2>Findings de segurança</h2>{loadState.status === 'ready' && <p>{filteredOccurrences.length} ocorrência{filteredOccurrences.length === 1 ? '' : 's'} exibida{filteredOccurrences.length === 1 ? '' : 's'}</p>}</div></div>
        {loadState.status === 'loading' && <div className="dp-threats-state"><Loader2 size={29} className="spin" /><strong>Carregando diagnósticos...</strong><p>Consultando os registros reais do usuário autenticado.</p></div>}
        {(loadState.status === 'error' || loadState.status === 'auth-error') && <div className="dp-threats-state error"><AlertTriangle size={31} /><strong>{loadState.status === 'auth-error' ? 'Autenticação necessária' : 'Erro ao carregar dados'}</strong><p>{loadState.message}</p><button type="button" onClick={loadDiagnostics}>Tentar novamente</button></div>}
        {loadState.status === 'ready' && occurrences.length === 0 && <div className="dp-threats-state"><ShieldAlert size={34} /><strong>Nenhum finding encontrado</strong><p>Os diagnósticos carregados não possuem findings de segurança persistidos.</p></div>}
        {loadState.status === 'ready' && occurrences.length > 0 && filteredOccurrences.length === 0 && <div className="dp-threats-state"><Search size={32} /><strong>Nenhuma ocorrência corresponde aos filtros</strong><p>Ajuste a busca ou os filtros para consultar outros findings.</p></div>}

        {loadState.status === 'ready' && filteredOccurrences.length > 0 && (
          <div className="dp-threats-list">
            {filteredOccurrences.map((occurrence) => {
              const { diagnostic, finding, plannedAction, remediation, status } = occurrence
              const action = actionLabel(plannedAction)
              return (
                <button className="dp-threats-item" type="button" key={occurrence.key} onClick={() => setSelectedOccurrence(occurrence)}>
                  <div className={`dp-threats-finding-icon severity-${finding?.severity || 'unknown'}`}><ShieldAlert size={18} /></div>
                  <div className="dp-threats-item-main"><strong>{finding?.title || 'Finding sem título registrado'}</strong>{finding?.description && <p>{finding.description}</p>}<span>{[finding?.packageName, [diagnostic?.fabricante, diagnostic?.modelo].filter(Boolean).join(' '), diagnostic?.serial].filter(Boolean).join(' · ')}</span></div>
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
            <header><div><ShieldAlert size={20} /><span><h2 id="dp-threats-modal-title">{selected.finding?.title || 'Finding sem título registrado'}</h2><small>Diagnóstico #{selected.diagnostic.id}{formatDate(selected.diagnostic.finalizado_em) ? ` · ${formatDate(selected.diagnostic.finalizado_em)}` : ''}</small></span></div><button type="button" aria-label="Fechar detalhes" onClick={() => setSelectedOccurrence(null)}><X size={19} /></button></header>
            <div className="dp-threats-modal-content">
              <section><h3><AlertTriangle size={15} /> Detectado</h3><dl><div><dt>Status</dt><dd><span className={`dp-threats-status status-${selected.status}`}>{STATUS_LABELS[selected.status]}</span></dd></div>{selected.finding?.category && <div><dt>Tipo</dt><dd>{selected.finding.category}</dd></div>}{selected.finding?.severity && <div><dt>Severidade</dt><dd>{SEVERITY_LABELS[selected.finding.severity] || selected.finding.severity}</dd></div>}{selected.finding?.packageName && <div><dt>Pacote</dt><dd><code>{selected.finding.packageName}</code></dd></div>}</dl>{selected.finding?.description && <p>{selected.finding.description}</p>}{(hasValue(selected.finding?.risk?.level) || hasValue(selected.finding?.risk?.score) || hasValue(selected.finding?.risk?.confidence)) && <div className="dp-threats-risk-details">{hasValue(selected.finding.risk.level) && <span>Nível: <strong>{selected.finding.risk.level}</strong></span>}{hasValue(selected.finding.risk.score) && <span>Score: <strong>{selected.finding.risk.score}</strong></span>}{hasValue(selected.finding.risk.confidence) && <span>Confiança: <strong>{selected.finding.risk.confidence}</strong></span>}</div>}{evidence.length > 0 && <div className="dp-threats-evidence"><strong>Evidências registradas</strong>{evidence.map((item) => <div key={item.key}><span>{item.key}</span><code>{item.value}</code></div>)}</div>}</section>
              <section><h3><Smartphone size={15} /> Dispositivo</h3><dl>{selected.diagnostic.fabricante && <div><dt>Fabricante</dt><dd>{selected.diagnostic.fabricante}</dd></div>}{selected.diagnostic.modelo && <div><dt>Modelo</dt><dd>{selected.diagnostic.modelo}</dd></div>}{selected.diagnostic.serial && <div><dt>Serial</dt><dd>{selected.diagnostic.serial}</dd></div>}{selected.diagnostic.versao_android && <div><dt>Android</dt><dd>{selected.diagnostic.versao_android}</dd></div>}{selected.diagnostic.security_patch && <div><dt>Patch</dt><dd>{selected.diagnostic.security_patch}</dd></div>}</dl></section>
              <section><h3><Wrench size={15} /> Correção</h3>{selected.finding?.recommendation && <div className="dp-threats-correction-block"><span>Recomendação do finding</span><strong>{selected.finding.recommendation}</strong></div>}{selectedActionLabel && <div className="dp-threats-correction-block"><span>Ação proposta</span><strong>{selectedActionLabel}</strong>{selected.plannedAction?.guidance && <p>{selected.plannedAction.guidance}</p>}{selected.plannedAction?.reasonUnavailable && <p>{selected.plannedAction.reasonUnavailable}</p>}</div>}{selected.remediation ? <div className="dp-threats-correction-block"><span>Ação executada</span><strong>{executedActionLabel || 'Ação sem identificação registrada'}</strong><p>Resultado: {STATUS_LABELS[selected.status]}</p>{selected.remediation.finishedAt && <small>Conclusão: {formatDate(selected.remediation.finishedAt)}</small>}{selectedVerification && <p>{selectedVerification}</p>}</div> : <p className="dp-threats-no-data">Nenhuma execução de correção registrada para este finding.</p>}</section>
              <section><h3><Clock3 size={15} /> Histórico</h3><div className="dp-threats-report-link"><div><FileText size={18} /><span><strong>Diagnóstico #{selected.diagnostic.id}</strong><small>O histórico integral permanece no relatório correspondente.</small></span></div><button type="button" onClick={() => { setSelectedOccurrence(null); if (onOpenReport) onOpenReport(selected.diagnostic.id); else onNavigate?.('Relatórios') }}>Ir para Relatórios</button></div></section>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

export default ThreatsPage
