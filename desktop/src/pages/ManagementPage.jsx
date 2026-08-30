import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, CircleHelp, ClipboardList, Gauge, Hash,
  Loader2, RefreshCw, ShieldAlert, Smartphone, Users, Wrench, XCircle,
} from 'lucide-react'
import { listarClientes } from '../services/clients.js'
import { listarDiagnosticos } from '../services/diagnostics.js'
import './ManagementPage.css'

const PERIODS = [
  { id: 'today', label: 'Hoje' },
  { id: '7days', label: '7 dias' },
  { id: '30days', label: '30 dias' },
  { id: 'all', label: 'Todo período' },
]

const MODE_LABELS = { quick: 'Rápida', complete: 'Completa', custom: 'Personalizada' }
const REMEDIATION_LABELS = {
  resolved: 'Resolvidas',
  failed: 'Falhas',
  not_verified: 'Não verificadas',
}
const EMPTY_VALUE = '--'

function normalizeList(data, resourceName) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  throw new Error(`A API retornou um formato inválido para ${resourceName}.`)
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function validDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfDay(date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function periodStart(period, now) {
  if (period === 'all') return null
  const start = startOfDay(now)
  if (period === '7days') start.setDate(start.getDate() - 6)
  if (period === '30days') start.setDate(start.getDate() - 29)
  return start
}

function diagnosticsInPeriod(diagnostics, period, now = new Date()) {
  if (period === 'all') return diagnostics
  const start = periodStart(period, now)
  return diagnostics.filter((diagnostic) => {
    const date = validDate(diagnostic?.finalizado_em)
    return date && date >= start && date <= now
  })
}

function technicalResult(diagnostic) {
  return diagnostic?.resultado_tecnico && typeof diagnostic.resultado_tecnico === 'object'
    ? diagnostic.resultado_tecnico
    : null
}

function findingsCollection(diagnostic) {
  const findings = technicalResult(diagnostic)?.security?.findings
  return Array.isArray(findings) ? findings : null
}

function remediationsCollection(diagnostic) {
  const remediations = technicalResult(diagnostic)?.remediations
  return Array.isArray(remediations) ? remediations : null
}

function clientId(diagnostic) {
  if (diagnostic?.cliente && typeof diagnostic.cliente === 'object') return diagnostic.cliente.id
  return diagnostic?.cliente
}

function clientName(diagnostic) {
  if (diagnostic?.cliente && typeof diagnostic.cliente === 'object') {
    return diagnostic.cliente.nome || diagnostic.cliente.name || 'Cliente sem nome registrado'
  }
  return 'Não associado'
}

function deviceName(diagnostic) {
  const name = [diagnostic?.fabricante, diagnostic?.modelo].filter(hasValue).join(' ')
  if (name) return name
  if (hasValue(diagnostic?.serial)) return diagnostic.serial
  return 'Identificação não disponível'
}

function formatDate(value) {
  const date = validDate(value)
  return date ? date.toLocaleString('pt-BR') : EMPTY_VALUE
}

function modeLabel(mode) {
  return MODE_LABELS[mode] || (hasValue(mode) ? mode : EMPTY_VALUE)
}

function healthValue(diagnostic) {
  const score = Number(diagnostic?.health_score)
  if (diagnostic?.health_available !== true || !Number.isFinite(score) || score < 0 || score > 100) return EMPTY_VALUE
  return `${score}/100`
}

function healthScores(diagnostics) {
  return diagnostics.map((diagnostic) => {
    const score = Number(diagnostic?.health_score)
    return diagnostic?.health_available === true && Number.isFinite(score) && score >= 0 && score <= 100
      ? score
      : null
  }).filter((score) => score !== null)
}

function dateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function createTimeline(diagnostics, period, now = new Date()) {
  const dated = diagnostics.map((diagnostic) => validDate(diagnostic?.finalizado_em)).filter(Boolean)
  if (dated.length === 0) return []

  let buckets = []
  let keyForDate = dateKey

  if (period === 'today') {
    buckets = Array.from({ length: 24 }, (_, hour) => ({
      key: `${dateKey(now)}-${String(hour).padStart(2, '0')}`,
      label: `${String(hour).padStart(2, '0')}h`,
      count: 0,
    }))
    keyForDate = (date) => `${dateKey(date)}-${String(date.getHours()).padStart(2, '0')}`
  } else if (period === '7days' || period === '30days') {
    const numberOfDays = period === '7days' ? 7 : 30
    const firstDay = startOfDay(now)
    firstDay.setDate(firstDay.getDate() - (numberOfDays - 1))
    buckets = Array.from({ length: numberOfDays }, (_, index) => {
      const day = new Date(firstDay)
      day.setDate(firstDay.getDate() + index)
      return { key: dateKey(day), label: day.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), count: 0 }
    })
  } else {
    const ordered = dated.slice().sort((a, b) => a - b)
    const first = startOfDay(ordered[0])
    const last = startOfDay(ordered[ordered.length - 1])
    const spanInDays = Math.floor((last - first) / 86400000) + 1

    if (spanInDays > 62) {
      const cursor = new Date(first.getFullYear(), first.getMonth(), 1)
      const lastMonth = new Date(last.getFullYear(), last.getMonth(), 1)
      while (cursor <= lastMonth) {
        buckets.push({
          key: monthKey(cursor),
          label: cursor.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''),
          count: 0,
        })
        cursor.setMonth(cursor.getMonth() + 1)
      }
      keyForDate = monthKey
    } else {
      const cursor = new Date(first)
      while (cursor <= last) {
        buckets.push({
          key: dateKey(cursor),
          label: cursor.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          count: 0,
        })
        cursor.setDate(cursor.getDate() + 1)
      }
    }
  }

  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))
  dated.forEach((date) => {
    const bucket = byKey.get(keyForDate(date))
    if (bucket) bucket.count += 1
  })
  return buckets
}

function aggregateFindings(findings) {
  const groups = new Map()
  findings.forEach((finding) => {
    if (!finding || typeof finding !== 'object') return
    const identity = [finding.id, finding.type, finding.category].find(hasValue)
    if (!identity) return
    const key = String(identity)
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      return
    }
    groups.set(key, {
      key,
      title: [finding.title, finding.name].find(hasValue) || key,
      count: 1,
    })
  })
  return [...groups.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'pt-BR')).slice(0, 6)
}

function aggregateManufacturers(diagnostics) {
  const groups = new Map()
  diagnostics.forEach((diagnostic) => {
    if (!hasValue(diagnostic?.fabricante)) return
    const name = String(diagnostic.fabricante).trim()
    groups.set(name, (groups.get(name) || 0) + 1)
  })
  return [...groups.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 6)
}

function MetricCard({ icon: Icon, label, value, note, tone = '' }) {
  return (
    <article className={`dp-management-metric ${tone}`}>
      <div className="dp-management-metric-icon"><Icon size={18} /></div>
      <div><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>
    </article>
  )
}

function ManagementPage({ accessToken, onOpenReport }) {
  const [clients, setClients] = useState([])
  const [diagnostics, setDiagnostics] = useState([])
  const [period, setPeriod] = useState('30days')
  const [loadState, setLoadState] = useState({ status: 'loading', message: '' })

  const loadData = useCallback(async () => {
    setLoadState({ status: 'loading', message: '' })
    try {
      const [clientsResponse, diagnosticsResponse] = await Promise.all([
        listarClientes({ accessToken }),
        listarDiagnosticos({ accessToken }),
      ])
      setClients(normalizeList(clientsResponse, 'clientes'))
      setDiagnostics(normalizeList(diagnosticsResponse, 'diagnósticos'))
      setLoadState({ status: 'ready', message: '' })
    } catch (error) {
      setClients([])
      setDiagnostics([])
      setLoadState({
        status: error?.status === 401 ? 'auth-error' : 'error',
        message: error?.status === 401
          ? 'Sua sessão expirou. Entre novamente para consultar a visão gerencial.'
          : 'Não foi possível carregar os dados gerenciais do backend.',
      })
    }
  }, [accessToken])

  useEffect(() => { loadData() }, [loadData])

  const filteredDiagnostics = useMemo(
    () => diagnosticsInPeriod(diagnostics, period),
    [diagnostics, period],
  )

  const summary = useMemo(() => {
    const findingsLists = filteredDiagnostics.map(findingsCollection).filter(Boolean)
    const remediationLists = filteredDiagnostics.map(remediationsCollection).filter(Boolean)
    const findings = findingsLists.flat()
    const remediations = remediationLists.flat()
    const scores = healthScores(filteredDiagnostics)
    const serials = new Set(filteredDiagnostics.map((item) => hasValue(item?.serial) ? String(item.serial).trim() : null).filter(Boolean))
    const attendedClients = new Set(filteredDiagnostics.map(clientId).filter(hasValue))
    const remediationCounts = remediations.reduce((counts, remediation) => {
      if (Object.hasOwn(counts, remediation?.status)) counts[remediation.status] += 1
      return counts
    }, { resolved: 0, failed: 0, not_verified: 0 })
    const knownRemediationResults = remediationCounts.resolved + remediationCounts.failed + remediationCounts.not_verified

    return {
      findings,
      findingsAvailable: findingsLists.length > 0,
      remediations,
      remediationsAvailable: remediationLists.length > 0,
      remediationCounts,
      knownRemediationResults,
      serialCount: serials.size,
      withoutSerial: filteredDiagnostics.filter((item) => !hasValue(item?.serial)).length,
      attendedClients: attendedClients.size,
      averageHealth: scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
      healthCount: scores.length,
    }
  }, [filteredDiagnostics])

  const timeline = useMemo(() => createTimeline(filteredDiagnostics, period), [filteredDiagnostics, period])
  const frequentFindings = useMemo(() => aggregateFindings(summary.findings), [summary.findings])
  const manufacturers = useMemo(() => aggregateManufacturers(filteredDiagnostics), [filteredDiagnostics])
  const recentDiagnostics = useMemo(() => filteredDiagnostics
    .filter((diagnostic) => validDate(diagnostic?.finalizado_em))
    .slice().sort((a, b) => validDate(b.finalizado_em) - validDate(a.finalizado_em))
    .slice(0, 6), [filteredDiagnostics])

  const maximumTimeline = Math.max(0, ...timeline.map((bucket) => bucket.count))
  const maximumManufacturer = Math.max(0, ...manufacturers.map((item) => item.count))
  const resolutionRate = summary.remediations.length > 0
    ? (summary.remediationCounts.resolved / summary.remediations.length) * 100
    : null

  return (
    <section className="dp-management-page" aria-labelledby="dp-management-title">
      <header className="dp-management-header">
        <div><h1 id="dp-management-title">Visão Gerencial</h1><p>Indicadores calculados a partir dos registros persistidos da sua operação.</p></div>
        <button className="dp-management-refresh" type="button" onClick={loadData} disabled={loadState.status === 'loading'}>
          <RefreshCw size={16} className={loadState.status === 'loading' ? 'spin' : ''} /> Atualizar
        </button>
      </header>

      <div className="dp-management-period" role="group" aria-label="Filtrar visão gerencial por período">
        <span>Período</span>
        {PERIODS.map((option) => <button className={period === option.id ? 'active' : ''} type="button" key={option.id} onClick={() => setPeriod(option.id)}>{option.label}</button>)}
      </div>

      {loadState.status === 'loading' && <div className="dp-management-state"><Loader2 size={31} className="spin" /><strong>Carregando dados gerenciais...</strong><p>Consultando clientes e diagnósticos do usuário autenticado.</p></div>}

      {(loadState.status === 'error' || loadState.status === 'auth-error') && (
        <div className="dp-management-state error"><AlertTriangle size={33} /><strong>{loadState.status === 'auth-error' ? 'Autenticação necessária' : 'Erro ao carregar dados'}</strong><p>{loadState.message}</p><button type="button" onClick={loadData}>Tentar novamente</button></div>
      )}

      {loadState.status === 'ready' && filteredDiagnostics.length === 0 && (
        <div className="dp-management-state"><ClipboardList size={35} /><strong>{diagnostics.length === 0 ? 'Nenhum diagnóstico disponível' : 'Nenhum diagnóstico no período'}</strong><p>{diagnostics.length === 0 ? `Há ${clients.length} cliente${clients.length === 1 ? '' : 's'} cadastrado${clients.length === 1 ? '' : 's'}, mas ainda não existem diagnósticos persistidos.` : 'Selecione outro período para consultar os registros existentes.'}</p></div>
      )}

      {loadState.status === 'ready' && filteredDiagnostics.length > 0 && (
        <>
          <div className="dp-management-metrics" aria-label="Indicadores gerenciais">
            <MetricCard icon={ClipboardList} label="Diagnósticos realizados" value={filteredDiagnostics.length} />
            <MetricCard icon={Users} label="Clientes atendidos" value={summary.attendedClients} note={`${clients.length} cadastrado${clients.length === 1 ? '' : 's'} na base atual`} />
            <MetricCard icon={Smartphone} label="Dispositivos diagnosticados" value={summary.serialCount} note={summary.withoutSerial > 0 ? `${summary.withoutSerial} diagnóstico${summary.withoutSerial === 1 ? '' : 's'} sem serial` : 'Seriais únicos'} />
            <MetricCard icon={ShieldAlert} label="Findings detectados" value={summary.findingsAvailable ? summary.findings.length : EMPTY_VALUE} />
            <MetricCard icon={Wrench} label="Correções executadas" value={summary.remediationsAvailable ? summary.remediations.length : EMPTY_VALUE} />
            <MetricCard icon={CheckCircle2} label="Correções resolvidas" value={summary.remediationsAvailable ? summary.remediationCounts.resolved : EMPTY_VALUE} tone="success" />
            <MetricCard icon={XCircle} label="Falhas" value={summary.remediationsAvailable ? summary.remediationCounts.failed : EMPTY_VALUE} tone="danger" />
            <MetricCard icon={CircleHelp} label="Não verificadas" value={summary.remediationsAvailable ? summary.remediationCounts.not_verified : EMPTY_VALUE} tone="warning" />
            <MetricCard icon={Gauge} label="Taxa de resolução" value={resolutionRate === null ? EMPTY_VALUE : `${resolutionRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`} note={resolutionRate === null ? 'Sem correções executadas' : 'Resolvidas sobre executadas'} />
            <MetricCard icon={Hash} label="Health Score médio" value={summary.averageHealth === null ? EMPTY_VALUE : `${summary.averageHealth.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}/100`} note={summary.healthCount > 0 ? `${summary.healthCount} score${summary.healthCount === 1 ? '' : 's'} válido${summary.healthCount === 1 ? '' : 's'}` : 'Sem score válido'} />
          </div>

          <div className="dp-management-grid">
            <article className="dp-management-card dp-management-timeline-card">
              <div className="dp-management-card-heading"><div><h2>Diagnósticos ao longo do tempo</h2><p>Distribuição real das conclusões no período selecionado.</p></div></div>
              {timeline.length > 0 && maximumTimeline > 0 ? (
                <div className="dp-management-chart-scroll">
                  <div className="dp-management-timeline" role="img" aria-label="Gráfico de diagnósticos ao longo do tempo">
                    {timeline.map((bucket) => <div className="dp-management-timeline-column" key={bucket.key}><span className="dp-management-chart-value">{bucket.count}</span><div className="dp-management-timeline-track"><span style={{ height: bucket.count > 0 ? `${Math.max(8, (bucket.count / maximumTimeline) * 100)}%` : '0%' }} /></div><small>{bucket.label}</small></div>)}
                  </div>
                </div>
              ) : <div className="dp-management-inline-empty">Não há datas válidas para montar este gráfico.</div>}
            </article>

            <article className="dp-management-card">
              <div className="dp-management-card-heading"><div><h2>Resultado das correções</h2><p>Distribuição das remediações executadas.</p></div></div>
              {summary.remediations.length > 0 ? (
                <div className="dp-management-bars">
                  {Object.entries(REMEDIATION_LABELS).map(([status, label]) => {
                    const count = summary.remediationCounts[status]
                    return <div className={`dp-management-bar-row ${status}`} key={status}><div><span>{label}</span><strong>{count}</strong></div><div className="dp-management-bar-track"><span style={{ width: `${(count / summary.remediations.length) * 100}%` }} /></div></div>
                  })}
                  {summary.knownRemediationResults < summary.remediations.length && <small className="dp-management-data-note">{summary.remediations.length - summary.knownRemediationResults} correção(ões) possui(em) status não reconhecido e não entra(m) na distribuição.</small>}
                </div>
              ) : <div className="dp-management-inline-empty">Nenhuma correção executada no período.</div>}
            </article>

            <article className="dp-management-card">
              <div className="dp-management-card-heading"><div><h2>Findings mais frequentes</h2><p>Agrupados pelo identificador ou tipo persistido.</p></div></div>
              {frequentFindings.length > 0 ? <ol className="dp-management-ranked-list">{frequentFindings.map((item) => <li key={item.key}><div><strong>{item.title}</strong><code>{item.key}</code></div><span>{item.count}</span></li>)}</ol> : <div className="dp-management-inline-empty">Nenhum finding identificável no período.</div>}
            </article>

            <article className="dp-management-card">
              <div className="dp-management-card-heading"><div><h2>Fabricantes mais diagnosticados</h2><p>Contagem por fabricante registrado no diagnóstico.</p></div></div>
              {manufacturers.length > 0 ? <div className="dp-management-manufacturers">{manufacturers.map((item) => <div key={item.name}><div><span>{item.name}</span><strong>{item.count}</strong></div><div className="dp-management-manufacturer-track"><span style={{ width: `${(item.count / maximumManufacturer) * 100}%` }} /></div></div>)}</div> : <div className="dp-management-inline-empty">Nenhum fabricante foi informado no período.</div>}
            </article>
          </div>

          <article className="dp-management-card dp-management-recent">
            <div className="dp-management-card-heading"><div><h2>Diagnósticos recentes</h2><p>Últimas conclusões com data válida dentro do período.</p></div></div>
            {recentDiagnostics.length > 0 ? <div className="dp-management-table-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Dispositivo</th><th>Modo</th><th>Health Score</th><th>Findings</th><th><span className="dp-management-visually-hidden">Ações</span></th></tr></thead><tbody>{recentDiagnostics.map((diagnostic) => { const findings = findingsCollection(diagnostic); return <tr key={diagnostic.id}><td>{formatDate(diagnostic.finalizado_em)}</td><td>{clientName(diagnostic)}</td><td><strong>{deviceName(diagnostic)}</strong>{hasValue(diagnostic.serial) && <small>{diagnostic.serial}</small>}</td><td>{modeLabel(diagnostic.modo)}</td><td>{healthValue(diagnostic)}</td><td>{findings ? findings.length : EMPTY_VALUE}</td><td><button type="button" onClick={() => onOpenReport?.(diagnostic.id)}>Ver relatório</button></td></tr> })}</tbody></table></div> : <div className="dp-management-inline-empty">Nenhum diagnóstico possui data válida para esta lista.</div>}
          </article>
        </>
      )}
    </section>
  )
}

export default ManagementPage
