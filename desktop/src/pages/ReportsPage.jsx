import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, AppWindow, Battery, CalendarClock, CheckCircle2, ChevronRight,
  Clock3, Cpu, FileSearch, FileText, HardDrive, Loader2, RefreshCw, Search,
  Link2, ShieldAlert, ShieldCheck, Smartphone, User, X,
} from 'lucide-react'
import { associarClienteAoDiagnostico, listarDiagnosticos, obterDiagnostico } from '../services/diagnostics.js'
import { listarClientes } from '../services/clients.js'
import './ReportsPage.css'

const RECENT_LIMIT = 5
const EMPTY_VALUE = '--'

const MODE_LABELS = { quick: 'Rápida', complete: 'Completa', custom: 'Personalizada' }
const MODULE_LABELS = {
  system: 'Sistema', apps: 'Aplicativos', security: 'Segurança', permissions: 'Permissões',
  battery: 'Bateria', storage: 'Armazenamento', performance: 'Desempenho',
}
const STAGE_LABELS = {
  identification: 'Identificação', system: 'Sistema', apps: 'Aplicativos', permissions: 'Permissões',
  security: 'Segurança', battery: 'Bateria', storage: 'Armazenamento',
  performance: 'Desempenho', consolidation: 'Consolidação',
}
const STAGE_STATUS = {
  completed: 'Concluída', unavailable: 'Indisponível', running: 'Em andamento', waiting: 'Aguardando',
}
const FINDING_SEVERITY = {
  info: 'Informativo', low: 'Baixo', medium: 'Médio', high: 'Alto', critical: 'Crítico',
}
const SECURITY_RISK_LEVEL = {
  low: 'Baixo risco observado', attention: 'Atenção', moderate: 'Risco moderado',
  elevated: 'Risco elevado', very_high: 'Risco muito elevado',
}
const SECURITY_RISK_STATUS = {
  calculated: 'Calculado', partial: 'Parcial', not_calculated: 'Não calculado',
  insufficient_data: 'Dados insuficientes',
}
const REMEDIATION_STATUS = {
  remediation_pending: 'Correção pendente', resolved: 'Resolvido',
  verification_failed: 'Verificação falhou', failed: 'Falha',
  not_verified: 'Não verificado', inconclusive: 'Inconclusivo', canceled: 'Cancelado',
  device_disconnected: 'Dispositivo desconectado', not_authorized: 'ADB não autorizado',
  not_supported: 'Não suportado',
}
const TRANSITION_STATUS = {
  remediation_pending: 'Correção pendente', executing: 'Executando', verifying: 'Verificando', resolved: 'Resolvido',
  verification_failed: 'Verificação falhou', failed: 'Falha', not_verified: 'Não verificado',
  inconclusive: 'Inconclusivo', canceled: 'Cancelado', device_disconnected: 'Dispositivo desconectado',
  not_authorized: 'ADB não autorizado', not_supported: 'Não suportado',
}
const ACTION_LABELS = {
  uninstall_user_app: 'Desinstalação de aplicativo',
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== ''
}

function showValue(value, suffix = '') {
  return hasValue(value) ? `${value}${suffix}` : EMPTY_VALUE
}

function formatDate(value) {
  if (!value) return EMPTY_VALUE
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? EMPTY_VALUE : date.toLocaleString('pt-BR')
}

function modeLabel(mode) {
  return MODE_LABELS[mode] || showValue(mode)
}

function healthValue(diagnostic) {
  if (diagnostic?.health_available !== true || !hasValue(diagnostic?.health_score)) return EMPTY_VALUE
  return `${diagnostic.health_score}/100`
}

function technicalResult(diagnostic) {
  return diagnostic?.resultado_tecnico && typeof diagnostic.resultado_tecnico === 'object'
    ? diagnostic.resultado_tecnico
    : null
}

function findingsFrom(diagnostic) {
  if (diagnostic?.security_projection_available && Array.isArray(diagnostic?.security_findings)) {
    return diagnostic.security_findings
  }
  const findings = technicalResult(diagnostic)?.security?.findings
  return Array.isArray(findings) ? findings : []
}

function securityRiskFrom(diagnostic) {
  if (diagnostic?.security_projection_available) {
    return {
      score: diagnostic.security_risk_score,
      level: diagnostic.security_risk_level,
      status: diagnostic.security_risk_status,
      version: diagnostic.security_risk_version,
    }
  }
  const technical = technicalResult(diagnostic)
  return technical?.securityRisk || technical?.security?.securityRisk || null
}

function securityRiskValue(diagnostic) {
  const risk = securityRiskFrom(diagnostic)
  return Number.isFinite(risk?.score) ? `${risk.score}/100` : EMPTY_VALUE
}

function securitySchemaVersion(diagnostic) {
  if (diagnostic?.security_projection_available) return diagnostic.security_schema_version
  return technicalResult(diagnostic)?.security?.schemaVersion || null
}

function remediationsFrom(diagnostic) {
  const remediations = technicalResult(diagnostic)?.remediations
  return Array.isArray(remediations) ? remediations : []
}

function findingCount(diagnostic) {
  const findings = findingsFrom(diagnostic)
  return Array.isArray(findings) ? findings.length : EMPTY_VALUE
}

function remediationCount(diagnostic) {
  const remediations = technicalResult(diagnostic)?.remediations
  return Array.isArray(remediations) ? remediations.length : EMPTY_VALUE
}

function actionLabel(action) {
  return ACTION_LABELS[action] || showValue(action)
}

function remediationStatusLabel(status) {
  return REMEDIATION_STATUS[status] || showValue(status)
}

function remediationResultText(status) {
  if (status === 'resolved') return 'A execução foi registrada como resolvida após a verificação disponível.'
  if (status === 'failed') return 'A ação não foi confirmada como concluída.'
  if (status === 'not_verified') return 'Não foi possível verificar o resultado da ação.'
  return 'Resultado não disponível.'
}

function verificationText(verification) {
  if (!verification || typeof verification !== 'object') return 'Dados de verificação não disponíveis.'
  if (verification.status === 'not_verified') return 'Não foi possível verificar o resultado da ação.'
  if (verification.status !== 'verified') return 'Status de verificação não disponível.'

  const source = verification.source === 'package_manager' ? ' pelo Package Manager' : ''
  const user = hasValue(verification.user) ? ` para o usuário Android ${verification.user}` : ''
  if (verification.installed === false) return `Ausência do pacote confirmada${source}${user}.`
  if (verification.installed === true) return `O pacote continuava instalado${source}${user}.`
  return 'A verificação foi registrada sem informar o estado de instalação do pacote.'
}

function normalizeList(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  throw new Error('A API retornou um formato de histórico inválido.')
}

function ResourceField({ label, value }) {
  return <div className="dp-report-detail-field"><span>{label}</span><strong>{value}</strong></div>
}

function ReportsPage({ accessToken, diagnosticId = null }) {
  const [diagnostics, setDiagnostics] = useState([])
  const [listState, setListState] = useState({ status: 'loading', message: '' })
  const [view, setView] = useState('recent')
  const [query, setQuery] = useState('')
  const [modeFilter, setModeFilter] = useState('all')
  const [healthFilter, setHealthFilter] = useState('all')
  const [detail, setDetail] = useState({ status: 'closed', data: null, message: '' })
  const [association, setAssociation] = useState({
    status: 'idle', clients: [], selectedId: '', saving: false, message: '', feedback: '',
  })

  const loadDiagnostics = useCallback(async () => {
    setListState({ status: 'loading', message: '' })
    try {
      const response = await listarDiagnosticos({ accessToken })
      const items = normalizeList(response).slice().sort((a, b) => {
        const dateDifference = new Date(b.finalizado_em).getTime() - new Date(a.finalizado_em).getTime()
        return Number.isNaN(dateDifference) || dateDifference === 0 ? Number(b.id) - Number(a.id) : dateDifference
      })
      setDiagnostics(items)
      setListState({ status: 'ready', message: '' })
    } catch (error) {
      setDiagnostics([])
      setListState({
        status: error?.status === 401 ? 'auth-error' : 'error',
        message: error?.status === 401
          ? 'Sua sessão expirou. Entre novamente para consultar os relatórios.'
          : 'Não foi possível carregar os diagnósticos salvos.',
      })
    }
  }, [accessToken])

  useEffect(() => { loadDiagnostics() }, [loadDiagnostics])

  const healthLabels = useMemo(() => [...new Set(
    diagnostics.map((item) => item.health_label).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, 'pt-BR')), [diagnostics])

  const filteredDiagnostics = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
    const base = view === 'recent' ? diagnostics.slice(0, RECENT_LIMIT) : diagnostics
    return base.filter((item) => {
      const searchable = [item.id, item.fabricante, item.modelo, item.serial]
        .filter(hasValue).join(' ').toLocaleLowerCase('pt-BR')
      return (!normalizedQuery || searchable.includes(normalizedQuery))
        && (modeFilter === 'all' || item.modo === modeFilter)
        && (healthFilter === 'all' || item.health_label === healthFilter)
    })
  }, [diagnostics, healthFilter, modeFilter, query, view])

  const openDetail = useCallback(async (id) => {
    setDetail({ status: 'loading', data: null, message: '' })
    setAssociation({ status: 'idle', clients: [], selectedId: '', saving: false, message: '', feedback: '' })
    try {
      const diagnostic = await obterDiagnostico(id, { accessToken })
      setDetail({ status: 'ready', data: diagnostic, message: '' })
      setAssociation((current) => ({ ...current, status: 'loading', selectedId: diagnostic.cliente?.id ? String(diagnostic.cliente.id) : '' }))
      try {
        const clients = normalizeList(await listarClientes({ accessToken }))
        setAssociation((current) => ({ ...current, status: 'ready', clients }))
      } catch (error) {
        setAssociation((current) => ({
          ...current,
          status: 'error',
          message: error?.status === 401
            ? 'Sua sessão expirou. Entre novamente para associar um cliente.'
            : 'Não foi possível carregar os clientes disponíveis.',
        }))
      }
    } catch (error) {
      const message = error?.status === 401
        ? 'Sua sessão expirou. Entre novamente para consultar este diagnóstico.'
        : error?.status === 404
          ? 'Este diagnóstico não está mais disponível.'
          : 'Não foi possível carregar os detalhes do diagnóstico.'
      setDetail({ status: 'error', data: null, message })
    }
  }, [accessToken])

  useEffect(() => {
    if (diagnosticId !== null && diagnosticId !== undefined) openDetail(diagnosticId)
  }, [diagnosticId, openDetail])

  const saveAssociation = useCallback(async () => {
    if (!detail.data || association.status !== 'ready') return
    setAssociation((current) => ({ ...current, saving: true, message: '', feedback: '' }))
    try {
      const updated = await associarClienteAoDiagnostico(
        detail.data.id,
        association.selectedId ? Number(association.selectedId) : null,
        { accessToken },
      )
      setDetail({ status: 'ready', data: updated, message: '' })
      setDiagnostics((current) => current.map((item) => (item.id === updated.id ? { ...item, cliente: updated.cliente } : item)))
      setAssociation((current) => ({ ...current, saving: false, feedback: 'Associação atualizada com sucesso.' }))
    } catch (error) {
      setAssociation((current) => ({
        ...current,
        saving: false,
        message: error?.status === 401
          ? 'Sua sessão expirou. Entre novamente para associar o cliente.'
          : 'Não foi possível atualizar a associação. O diagnóstico continua inalterado.',
      }))
    }
  }, [accessToken, association.selectedId, association.status, detail.data])

  const closeDetail = () => {
    setDetail({ status: 'closed', data: null, message: '' })
    setAssociation({ status: 'idle', clients: [], selectedId: '', saving: false, message: '', feedback: '' })
  }
  const hasActiveFilters = Boolean(query.trim()) || modeFilter !== 'all' || healthFilter !== 'all'
  const selected = detail.data
  const selectedFindings = findingsFrom(selected)
  const selectedRemediations = remediationsFrom(selected)
  const selectedSecurityRisk = securityRiskFrom(selected)
  const selectedFindingsById = new Map(
    selectedFindings.filter((finding) => hasValue(finding?.id)).map((finding) => [finding.id, finding]),
  )

  return (
    <section className="dp-reports-page" aria-labelledby="dp-reports-title">
      <header className="dp-reports-header">
        <div><h1 id="dp-reports-title">Relatórios</h1><p>Consulte diagnósticos e atendimentos realizados.</p></div>
        <button className="dp-reports-refresh" type="button" onClick={loadDiagnostics} disabled={listState.status === 'loading'}>
          <RefreshCw size={16} className={listState.status === 'loading' ? 'spin' : ''} /> Atualizar
        </button>
      </header>

      <div className="dp-reports-tabs" role="tablist" aria-label="Visualização dos relatórios">
        <button role="tab" aria-selected={view === 'recent'} className={view === 'recent' ? 'active' : ''} onClick={() => setView('recent')}>Recentes</button>
        <button role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>Todo o histórico</button>
      </div>

      {listState.status === 'ready' && diagnostics.length > 0 && (
        <div className="dp-reports-toolbar">
          <label className="dp-reports-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por fabricante, modelo, serial ou ID" /></label>
          <label className="dp-reports-select"><span>Modo</span><select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}><option value="all">Todos</option><option value="quick">Rápida</option><option value="complete">Completa</option><option value="custom">Personalizada</option></select></label>
          <label className="dp-reports-select"><span>Health Score</span><select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value)}><option value="all">Todas</option>{healthLabels.map((label) => <option value={label} key={label}>{label}</option>)}</select></label>
        </div>
      )}

      <div className="dp-reports-card">
        <div className="dp-reports-card-heading"><div><h2>{view === 'recent' ? 'Diagnósticos recentes' : 'Todo o histórico'}</h2>{listState.status === 'ready' && diagnostics.length > 0 && <p>{filteredDiagnostics.length} diagnóstico{filteredDiagnostics.length === 1 ? '' : 's'} exibido{filteredDiagnostics.length === 1 ? '' : 's'}</p>}</div></div>

        {listState.status === 'loading' && <div className="dp-reports-state"><Loader2 size={28} className="spin" /><strong>Carregando diagnósticos...</strong></div>}
        {(listState.status === 'error' || listState.status === 'auth-error') && <div className="dp-reports-state error"><AlertTriangle size={30} /><strong>{listState.status === 'auth-error' ? 'Autenticação necessária' : 'Erro ao carregar relatórios'}</strong><p>{listState.message}</p><button type="button" onClick={loadDiagnostics}>Tentar novamente</button></div>}
        {listState.status === 'ready' && diagnostics.length === 0 && <div className="dp-reports-state"><FileText size={34} /><strong>Nenhum diagnóstico salvo</strong><p>Os diagnósticos concluídos e persistidos aparecerão aqui.</p></div>}
        {listState.status === 'ready' && diagnostics.length > 0 && filteredDiagnostics.length === 0 && <div className="dp-reports-state"><FileSearch size={34} /><strong>Nenhum diagnóstico encontrado</strong><p>{hasActiveFilters ? 'Ajuste a busca ou os filtros para consultar outros registros.' : 'Não há registros nesta visualização.'}</p></div>}

        {listState.status === 'ready' && filteredDiagnostics.length > 0 && (
          <div className={`dp-reports-list ${view === 'recent' ? 'compact' : ''}`}>
            {filteredDiagnostics.map((diagnostic) => (
              <button className="dp-reports-item" type="button" key={diagnostic.id} onClick={() => openDetail(diagnostic.id)}>
                <div className="dp-reports-file-icon"><FileText size={19} /></div>
                <div className="dp-reports-item-identity"><strong>Diagnóstico #{diagnostic.id}</strong><span>{[diagnostic.fabricante, diagnostic.modelo].filter(Boolean).join(' ') || 'Não disponível'}</span><small>{showValue(diagnostic.serial)}</small><small>{diagnostic.cliente?.nome ? `Cliente: ${diagnostic.cliente.nome}` : 'Cliente não associado'}</small></div>
                <div className="dp-reports-item-value"><span>Data</span><strong>{formatDate(diagnostic.finalizado_em)}</strong></div>
                <div className="dp-reports-item-value"><span>Modo</span><strong>{modeLabel(diagnostic.modo)}</strong></div>
                <div className="dp-reports-item-value"><span>Health Score</span><strong>{healthValue(diagnostic)}</strong><small>{showValue(diagnostic.health_label)}</small></div>
                <div className="dp-reports-item-value"><span>Findings</span><strong>{findingCount(diagnostic)}</strong></div>
                <div className="dp-reports-item-value"><span>Correções</span><strong>{remediationCount(diagnostic)}</strong></div>
                <ChevronRight size={18} className="dp-reports-item-chevron" />
              </button>
            ))}
          </div>
        )}
      </div>

      {detail.status !== 'closed' && (
        <div className="dp-report-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail() }}>
          <section className="dp-report-modal" role="dialog" aria-modal="true" aria-labelledby="dp-report-detail-title">
            <header className="dp-report-modal-header">
              <div className="dp-report-modal-icon"><FileText size={21} /></div>
              <div><h2 id="dp-report-detail-title">{selected ? `Diagnóstico #${selected.id}` : 'Detalhes do diagnóstico'}</h2><p>{selected ? formatDate(selected.finalizado_em) : 'Consultando registro salvo...'}</p></div>
              <button type="button" onClick={closeDetail} aria-label="Fechar detalhes"><X size={20} /></button>
            </header>

            {detail.status === 'loading' && <div className="dp-report-detail-state"><Loader2 size={28} className="spin" /> Carregando detalhes...</div>}
            {detail.status === 'error' && <div className="dp-report-detail-state error"><AlertTriangle size={28} /><strong>Diagnóstico indisponível</strong><p>{detail.message}</p></div>}

            {detail.status === 'ready' && selected && (
              <div className="dp-report-detail-content">
                <section className="dp-report-detail-section dp-report-client-section">
                  <h3><User size={16} /> Cliente</h3>
                  <div className="dp-report-client-current"><span>Cliente associado</span><strong>{selected.cliente?.nome || 'Cliente não associado'}</strong>{selected.cliente?.telefone && <small>{selected.cliente.telefone}</small>}</div>
                  {association.status === 'loading' && <p className="dp-report-association-state"><Loader2 size={14} className="spin" /> Carregando clientes...</p>}
                  {association.status === 'error' && <p className="dp-report-association-state error"><AlertTriangle size={14} /> {association.message}</p>}
                  {association.status === 'ready' && association.clients.length === 0 && <p className="dp-report-association-state">Nenhum cliente cadastrado para associação.</p>}
                  {association.status === 'ready' && association.clients.length > 0 && <div className="dp-report-association-controls"><select value={association.selectedId} onChange={(event) => setAssociation((current) => ({ ...current, selectedId: event.target.value, message: '', feedback: '' }))} disabled={association.saving}><option value="">Cliente não associado</option>{association.clients.map((client) => <option value={client.id} key={client.id}>{client.nome}</option>)}</select><button type="button" onClick={saveAssociation} disabled={association.saving}><Link2 size={14} /> {association.saving ? 'Salvando...' : 'Atualizar associação'}</button></div>}
                  {association.message && association.status === 'ready' && <p className="dp-report-association-feedback error">{association.message}</p>}
                  {association.feedback && <p className="dp-report-association-feedback success">{association.feedback}</p>}
                </section>

                <section className="dp-report-detail-section"><h3><Smartphone size={16} /> Identificação</h3><div className="dp-report-detail-grid"><ResourceField label="Fabricante" value={showValue(selected.fabricante)} /><ResourceField label="Modelo" value={showValue(selected.modelo)} /><ResourceField label="Serial" value={showValue(selected.serial)} /><ResourceField label="Android" value={showValue(selected.versao_android)} /><ResourceField label="SDK" value={showValue(selected.sdk)} /><ResourceField label="Security patch" value={showValue(selected.security_patch)} /></div></section>

                <section className="dp-report-detail-section"><h3><CalendarClock size={16} /> Análise</h3><div className="dp-report-detail-grid"><ResourceField label="Modo" value={modeLabel(selected.modo)} /><ResourceField label="Início" value={formatDate(selected.iniciado_em)} /><ResourceField label="Conclusão" value={formatDate(selected.finalizado_em)} /><ResourceField label="Módulos" value={Array.isArray(selected.modulos) && selected.modulos.length ? selected.modulos.map((item) => MODULE_LABELS[item] || item).join(', ') : EMPTY_VALUE} /></div></section>

                <section className="dp-report-detail-section"><h3><ShieldCheck size={16} /> Saúde do sistema</h3><div className="dp-report-detail-grid"><ResourceField label="Score" value={healthValue(selected)} /><ResourceField label="Classificação" value={showValue(selected.health_label)} /><ResourceField label="Explicação" value={showValue(selected.health_explanation)} /></div></section>

                <section className="dp-report-detail-section"><h3><ShieldAlert size={16} /> Risco de segurança</h3><div className="dp-report-detail-grid"><ResourceField label="Score técnico" value={securityRiskValue(selected)} /><ResourceField label="Classificação" value={showValue(SECURITY_RISK_LEVEL[selectedSecurityRisk?.level] || selectedSecurityRisk?.level)} /><ResourceField label="Status" value={showValue(SECURITY_RISK_STATUS[selectedSecurityRisk?.status] || selectedSecurityRisk?.status)} /><ResourceField label="Versão da fórmula" value={showValue(selectedSecurityRisk?.version)} /><ResourceField label="Versão do schema" value={showValue(securitySchemaVersion(selected))} /></div></section>

                <section className="dp-report-detail-section"><h3><Cpu size={16} /> Recursos</h3><div className="dp-report-resource-groups">
                  <div><h4><Battery size={14} /> Bateria</h4><ResourceField label="Nível" value={showValue(selected.bateria?.level, hasValue(selected.bateria?.level) ? '%' : '')} /><ResourceField label="Status" value={showValue(selected.bateria?.status)} /><ResourceField label="Fonte" value={showValue(selected.bateria?.source)} /></div>
                  <div><h4><HardDrive size={14} /> Armazenamento</h4><ResourceField label="Total" value={showValue(selected.armazenamento?.totalGb, hasValue(selected.armazenamento?.totalGb) ? ' GB' : '')} /><ResourceField label="Usado" value={showValue(selected.armazenamento?.usedGb, hasValue(selected.armazenamento?.usedGb) ? ' GB' : '')} /><ResourceField label="Livre" value={showValue(selected.armazenamento?.freeGb, hasValue(selected.armazenamento?.freeGb) ? ' GB' : '')} /></div>
                  <div><h4><Cpu size={14} /> Memória</h4><ResourceField label="Total" value={showValue(selected.memoria?.totalGb, hasValue(selected.memoria?.totalGb) ? ' GB' : '')} /><ResourceField label="Usada" value={showValue(selected.memoria?.usedGb, hasValue(selected.memoria?.usedGb) ? ' GB' : '')} /><ResourceField label="Disponível" value={showValue(selected.memoria?.availableGb, hasValue(selected.memoria?.availableGb) ? ' GB' : '')} /></div>
                </div></section>

                <section className="dp-report-detail-section"><h3><AppWindow size={16} /> Aplicativos</h3><div className="dp-report-detail-grid"><ResourceField label="Total" value={showValue(selected.apps?.total)} /><ResourceField label="Usuário" value={showValue(selected.apps?.userTotal)} /><ResourceField label="Sistema" value={showValue(selected.apps?.systemTotal)} /></div></section>

                <section className="dp-report-detail-section">
                  <h3><AlertTriangle size={16} /> Findings detectados</h3>
                  {selectedFindings.length > 0 ? (
                    <div className="dp-report-finding-list">
                      {selectedFindings.map((finding, index) => (
                        <article key={`${finding?.id || 'finding'}-${index}`}>
                          <header>
                            <strong>{showValue(finding?.title)}</strong>
                            <span className={`severity-${finding?.severity || 'unknown'}`}>{FINDING_SEVERITY[finding?.severity] || showValue(finding?.severity)}</span>
                          </header>
                          {finding?.packageName && <code>{finding.packageName}</code>}
                          <p>{showValue(finding?.description)}</p>
                          <div><span>Auditoria</span><strong>Regra: {showValue(finding?.ruleId)} · Confiança da evidência: {showValue(finding?.evidenceConfidence)} · Contribuição: {showValue(finding?.scoreContribution)} · Fórmula: {showValue(finding?.scorerVersion)}</strong></div>
                          <div><span>Recomendação registrada</span><strong>{showValue(finding?.recommendation)}</strong></div>
                        </article>
                      ))}
                    </div>
                  ) : <p className="dp-report-no-data">Nenhum finding registrado neste diagnóstico.</p>}
                </section>

                <section className="dp-report-detail-section">
                  <h3><CheckCircle2 size={16} /> Histórico de correções</h3>
                  {selectedRemediations.length > 0 ? (
                    <div className="dp-report-remediation-list">
                      {selectedRemediations.map((remediation, index) => {
                        const relatedFinding = selectedFindingsById.get(remediation?.findingId)
                        const transitions = Array.isArray(remediation?.transitions) ? remediation.transitions : []
                        return (
                          <article className={`dp-report-remediation status-${remediation?.status || 'unknown'}`} key={remediation?.executionId || `${remediation?.findingId || 'remediation'}-${index}`}>
                            <header>
                              <div><span>Resultado</span><strong>{remediationStatusLabel(remediation?.status)}</strong></div>
                              <time>{formatDate(remediation?.finishedAt || remediation?.startedAt)}</time>
                            </header>
                            <div className="dp-report-remediation-flow">
                              <div><span>Detectado</span><strong>{relatedFinding?.title || remediation?.findingId || 'Finding relacionado não disponível.'}</strong>{relatedFinding?.description && <p>{relatedFinding.description}</p>}</div>
                              <div><span>Recomendado</span><strong>{relatedFinding?.recommendation || 'Recomendação não disponível.'}</strong></div>
                              <div><span>Executado</span><strong>{actionLabel(remediation?.action)}</strong>{remediation?.packageName && <code>{remediation.packageName}</code>}<small>Início: {formatDate(remediation?.startedAt)} · Término: {formatDate(remediation?.finishedAt)}</small></div>
                              <div><span>Verificação</span><strong>{verificationText(remediation?.verification)}</strong></div>
                              <div><span>Resultado final</span><strong>{remediationStatusLabel(remediation?.status)}</strong><p>{remediationResultText(remediation?.status)}</p></div>
                            </div>
                            <div className="dp-report-remediation-timeline">
                              <span>Linha do tempo</span>
                              {transitions.length > 0 ? (
                                <ol>{transitions.map((transition, transitionIndex) => <li key={`${transition?.status || 'transition'}-${transitionIndex}`}><i aria-hidden="true" /><div><strong>{TRANSITION_STATUS[transition?.status] || showValue(transition?.status)}</strong><time>{formatDate(transition?.at)}</time></div></li>)}</ol>
                              ) : <p>Nenhuma transição registrada nesta correção.</p>}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  ) : <p className="dp-report-no-data">Nenhuma ação de correção registrada neste diagnóstico.</p>}
                </section>

                <section className="dp-report-detail-section"><h3><AlertTriangle size={16} /> Avisos</h3>{Array.isArray(selected.warnings) && selected.warnings.length > 0 ? <div className="dp-report-warning-list">{selected.warnings.map((warning, index) => <div key={`${warning?.stage || 'warning'}-${index}`}><strong>{showValue(warning?.stage)}</strong><span>{showValue(warning?.message)}</span>{warning?.code && <small>{warning.code}</small>}</div>)}</div> : <p className="dp-report-no-data">{Array.isArray(selected.warnings) ? 'Nenhum warning registrado nesta coleta.' : 'Não disponível.'}</p>}</section>

                <section className="dp-report-detail-section"><h3><Clock3 size={16} /> Etapas</h3>{selected.stages && Object.keys(selected.stages).length > 0 ? <div className="dp-report-stage-list">{Object.entries(selected.stages).map(([stageId, stage]) => <div key={stageId}>{stage?.status === 'completed' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}<strong>{STAGE_LABELS[stageId] || stageId}</strong><span>{STAGE_STATUS[stage?.status] || showValue(stage?.status)}</span></div>)}</div> : <p className="dp-report-no-data">Nenhuma etapa registrada.</p>}</section>

                <p className="dp-report-disclaimer">Este relatório apresenta somente os sinais técnicos coletados e não certifica ausência de malware.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  )
}

export default ReportsPage
