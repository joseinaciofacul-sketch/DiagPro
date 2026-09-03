import { useState } from 'react'
import {
  AppWindow, BatteryCharging, ChevronDown, CircleCheck,
  DatabaseBackup, HardDrive, HelpCircle,
  MemoryStick, Play, Rocket, Search, Settings2, Shield, ShieldCheck,
  Smartphone, Sparkles
} from 'lucide-react'
import DeviceCard from '../components/DeviceCard.jsx'
import AnalysisCenter from '../components/AnalysisCenter.jsx'
import './DashboardPage.css'

const quickActions = [
  { icon: Sparkles, label: 'Limpeza\nProfunda', tone: 'blue', available: false },
  { icon: Rocket, label: 'Otimização\nde Sistema', tone: 'green', available: false },
  { icon: BatteryCharging, label: 'Verificação\nde Bateria', tone: 'yellow', target: 'scanner' },
  { icon: AppWindow, label: 'Gerenciar\nApps', tone: 'purple', target: 'devices' },
  { icon: DatabaseBackup, label: 'Backup de\nDados', tone: 'cyan', available: false },
]

// Mapeia as 9 etapas reais do executarScan para as 5 etapas visuais do AnalysisCenter
const MAPA_ETAPAS = {
  identification: 'device',
  system: 'system',
  battery: 'system',
  storage: 'system',
  performance: 'system',
  apps: 'apps',
  permissions: 'security',
  security: 'security',
  consolidation: 'finalizing',
}

const MODOS = { 'Rápida': 'quick', 'Completa': 'complete', 'Personalizada': 'custom' }

function StorageRing({ percentual }) {
  return <div className="dp-storage-ring"><strong>{percentual != null ? `${percentual}%` : '--'}</strong></div>
}

function dashboardScanState(session) {
  if (!session) return null
  if (session.status === 'running' || session.status === 'cancel_requested') {
    return {
      status: 'running',
      stage: MAPA_ETAPAS[session.progress?.stage] || 'device',
      progress: session.progress?.progress ?? 0,
      message: session.status === 'cancel_requested' ? 'Cancelamento solicitado...' : session.progress?.label,
      details: session.progress?.message || null,
    }
  }
  if (session.status === 'completed') return { status: 'complete', stage: 'finalizing', progress: 100 }
  if (session.status === 'partial') return { status: 'attention', stage: 'finalizing', progress: 100, message: 'Análise concluída com avisos' }
  if (session.status === 'canceled') return { status: 'canceled', progress: session.progress?.progress ?? 0, message: session.message }
  if (session.status === 'device_disconnected' || session.status === 'device_changed') return { status: 'disconnected', progress: session.progress?.progress ?? 0, message: session.message }
  if (session.status === 'failed') return { status: 'failed', progress: session.progress?.progress ?? 0, message: session.message }
  return null
}

function DashboardPage({ dispositivo, scanSession, onOpenScanner, onNavigate }) {
  const [analysisType, setAnalysisType] = useState('Rápida')
  const scan = dashboardScanState(scanSession)
  const resultado = scanSession?.result || null

  function iniciarScan() {
    onOpenScanner?.(MODOS[analysisType])
  }

  const armazenamento = dispositivo.status === 'connected' ? dispositivo.storage : null
  const memoria = dispositivo.status === 'connected' ? dispositivo.memory : null
  const bateria = dispositivo.status === 'connected' ? dispositivo.battery : null
  const health = resultado?.health

  const systemSummary = [
    {
      icon: MemoryStick,
      label: 'Memória RAM',
      value: memoria?.availableGb != null ? `${memoria.availableGb} GB livres de ${memoria.totalGb} GB` : dispositivo.status === 'connected' ? 'Não disponível' : 'Dispositivo não conectado',
      tone: 'positive',
    },
    {
      icon: HardDrive,
      label: 'Armazenamento',
      value: armazenamento?.usedGb != null ? `${armazenamento.usedGb} GB / ${armazenamento.totalGb} GB` : dispositivo.status === 'connected' ? 'Não disponível' : 'Dispositivo não conectado',
      tone: 'positive',
    },
    {
      icon: Smartphone,
      label: 'Android',
      value: dispositivo.status === 'connected' ? `Android ${dispositivo.androidVersion || '--'}` : 'Dispositivo não conectado',
    },
  ]

  const healthItems = [
    { icon: ShieldCheck, label: 'Risco de segurança', status: Number.isFinite(resultado?.securityRisk?.score) ? `${resultado.securityRisk.score}/100` : 'Não analisado', tone: 'slate' },
    { icon: Settings2, label: 'Sistema', status: dispositivo.status === 'connected' ? `Android ${dispositivo.androidVersion || '--'}` : '--', tone: 'slate' },
    { icon: BatteryCharging, label: 'Bateria', status: bateria?.level != null ? `${bateria.level}%` : '--', tone: bateria?.level >= 50 ? 'green' : 'yellow' },
    { icon: HardDrive, label: 'Armazenamento', status: armazenamento?.freeGb != null ? `${armazenamento.freeGb} GB livres` : '--', tone: 'blue' },
  ]

  const apps = resultado?.apps?.items || []
  const findings = Array.isArray(resultado?.security?.findings) ? resultado.security.findings : []
  const confirmedThreats = Array.isArray(resultado?.security?.confirmedThreats) ? resultado.security.confirmedThreats : []
  const lastScanLabel = resultado?.finishedAt
    ? scanSession?.persistence?.status === 'saved'
      ? `Último scan salvo: ${new Date(resultado.finishedAt).toLocaleString('pt-BR')}`
      : scanSession?.persistence?.status === 'error'
        ? 'Scan concluído localmente; histórico indisponível'
        : `Último scan: ${new Date(resultado.finishedAt).toLocaleString('pt-BR')}`
    : 'Nenhum scan realizado nesta sessão'

  return (
    <div className="dashboard-reference">
      <header className="dashboard-heading">
        <div><h1>Dashboard</h1><p>Visão geral do dispositivo e da saúde do sistema</p></div>
        <div className="dashboard-overview">
          <div className="overview-device"><DeviceCard estado={dispositivo} /><ChevronDown size={16} className="overview-chevron" /></div>
          <div className="overview-stat overview-battery"><BatteryCharging size={28} /><div><span>Bateria</span><strong>{bateria?.level != null ? `${bateria.level}%` : '--'}</strong></div></div>
          <div className="overview-stat overview-storage"><StorageRing percentual={armazenamento?.usagePercent} /><div><span>Armazenamento</span><strong>{armazenamento?.usedGb != null ? `${armazenamento.usedGb} GB` : '--'} <small>/ {armazenamento?.totalGb != null ? `${armazenamento.totalGb} GB` : '--'}</small></strong></div></div>
        </div>
      </header>

      <main className="dashboard-grid">
        <div className="dashboard-column dashboard-left">
          <section className="dashboard-panel health-panel">
            <div className="panel-heading"><h2>Saúde do Sistema</h2><HelpCircle size={16} /></div>
            <div className="health-overview">
              <div className="health-gauge" style={{ background: `conic-gradient(var(--blue) 0 ${health?.score ?? 0}%, #20334c ${health?.score ?? 0}% 100%)` }}>
                <div className="health-gauge-inner">
                  <strong>{health?.score != null ? `${health.score}%` : '--'}</strong>
                  <span>{health?.label || 'Aguardando diagnóstico'}</span>
                </div>
              </div>
              <div className="health-copy">
                <p>{health?.explanation || 'Execute o Scanner Inteligente para calcular a saúde real do dispositivo.'}</p>
                {health?.available && health.score >= 85 && (
                  <span className="healthy-badge"><CircleCheck size={14} /> Tudo funcionando bem</span>
                )}
              </div>
            </div>
            <div className="health-items">{healthItems.map(({ icon: Icon, label, status, tone }) => <div className="health-item" key={label}><Icon size={20} className={`tone-${tone}`} /><span>{label}</span><strong>{status}</strong></div>)}</div>
          </section>

          <section className="dashboard-panel threats-panel">
            <div className="panel-heading"><h2>Ameaças Recentes</h2></div>
            <p style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 0' }}>
              {!resultado
                ? 'Execute o Scanner para consultar os sinais técnicos disponíveis.'
                : confirmedThreats.length > 0
                  ? `${confirmedThreats.length} ameaça(s) confirmada(s) pelas evidências registradas.`
                  : findings.length > 0
                    ? `${findings.length} achado(s) técnico(s) aguardando revisão.`
                    : 'Nenhum achado para revisão; isso não certifica ausência de ameaças.'}
            </p>
          </section>
        </div>

        <div className="dashboard-column dashboard-center">
          <section className="dashboard-panel scanner-panel"><div className="panel-heading"><h2>Scanner Inteligente</h2><span className="recommended-badge">Recomendado</span></div><div className="scanner-radar"><div className="radar-ring ring-one" /><div className="radar-ring ring-two" /><div className="radar-ring ring-three" /><div className="radar-cross" /><div className="scanner-shield"><Shield size={58} /><Search size={27} /></div></div><span className="analysis-label">Tipos de análise</span><div className="analysis-options">{['Rápida', 'Completa', 'Personalizada'].map((type) => <button key={type} className={analysisType === type ? 'selected' : ''} onClick={() => setAnalysisType(type)}>{type}</button>)}</div><button className="start-scan-button" onClick={iniciarScan} disabled={dispositivo.status !== 'connected' || scan?.status === 'running'}><Play size={17} fill="currentColor" /> {scan?.status === 'running' ? 'Analisando...' : 'Abrir Scanner'}</button><span className="last-scan">{lastScanLabel}</span></section>
          <section className="dashboard-panel quick-panel"><div className="panel-heading"><h2>Ações Rápidas</h2></div><div className="quick-actions">{quickActions.map(({ icon: Icon, label, tone, available, target }) => <button className="quick-action" key={label} disabled={available === false} title={available === false ? 'Recurso ainda não disponível nesta versão.' : undefined} onClick={() => { if (target === 'scanner') onOpenScanner?.('quick'); if (target === 'devices') onNavigate?.('Dispositivos') }}><Icon size={30} className={`tone-${tone}`} /><span>{label.split('\n').map((line) => <span key={line}>{line}</span>)}</span></button>)}</div></section>
        </div>

        <div className="dashboard-column dashboard-right">
          <section className="dashboard-panel apps-panel">
            <div className="panel-heading"><h2>Aplicativos do Dispositivo {resultado?.apps && <b className="app-count">{resultado.apps.total}</b>}</h2></div>
            <div className="apps-head"><span>Aplicativo</span><span>Status</span></div>
            <div className="app-list">
              {apps.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 0' }}>Execute o Scanner para listar os aplicativos instalados.</p>}
              {apps.slice(0, 7).map((app) => (
                <div className="app-row" key={app.packageName}>
                  <span className="app-logo app-safe"><AppWindow size={14} /></span>
                  <div className="app-name"><strong>{app.packageName}</strong><small>{app.type === 'user' ? 'Aplicativo do usuário' : 'Aplicativo de sistema'}</small></div>
                  <div className="app-status"><span>{app.statusLabel}</span></div>
                </div>
              ))}
            </div>
          </section>
          <section className="dashboard-panel system-panel"><div className="panel-heading"><h2>Resumo do Sistema</h2></div><div className="system-list">{systemSummary.map(({ icon: Icon, label, value, tone }) => <div className="system-row" key={label}><span><Icon size={15} />{label}</span><strong className={tone}>{value}</strong></div>)}</div></section>
        </div>
      </main>

      <AnalysisCenter
        deviceStatus={dispositivo.status === 'connected' ? 'connected' : 'disconnected'}
        scan={scan}
        onStartScan={iniciarScan}
        onViewDetails={() => onOpenScanner?.(MODOS[analysisType])}
        onFixProblems={() => onNavigate?.('Ameaças')}
      />
    </div>
  )
}

export default DashboardPage
