import {
  Activity,
  Check,
  CheckCircle2,
  Cpu,
  FileSearch,
  Play,
  Search,
  Shield,
  Smartphone,
  TriangleAlert,
} from 'lucide-react'

import './AnalysisCenter.css'

const STEPS = [
  { id: 'device', label: 'Dispositivo', icon: Smartphone },
  { id: 'system', label: 'Sistema', icon: Cpu },
  { id: 'apps', label: 'Aplicativos', icon: Search },
  { id: 'security', label: 'Segurança', icon: Shield },
  { id: 'finalizing', label: 'Finalização', icon: CheckCircle2 },
]

const STAGE_ORDER = { device: 0, system: 1, apps: 2, security: 3, finalizing: 4 }

function AnalysisCenter({
  deviceStatus = 'disconnected',
  scan = null,
  onStartScan,
  onViewDetails,
  onFixProblems,
}) {
  const connected = deviceStatus === 'connected'
  const scanStatus = scan?.status || 'idle'
  const running = scanStatus === 'running'
  const complete = scanStatus === 'complete'
  const attention = scanStatus === 'attention'
  const interrupted = ['canceled', 'failed', 'disconnected'].includes(scanStatus)
  const progress = typeof scan?.progress === 'number' ? Math.min(100, Math.max(0, scan.progress)) : 0
  const currentStage = scan?.stage || null
  const currentIndex = currentStage && STAGE_ORDER[currentStage] != null ? STAGE_ORDER[currentStage] : -1

  function getStepState(index) {
    if (complete || attention) return 'completed'
    if (!running && !interrupted) return 'pending'
    if (index < currentIndex) return 'completed'
    if (index === currentIndex) return interrupted ? 'interrupted' : 'active'
    return 'pending'
  }

  const idleWithoutDevice = !connected && scanStatus === 'idle'
  const terminalTitle = scanStatus === 'canceled'
    ? 'Análise cancelada'
    : scanStatus === 'disconnected'
      ? 'Análise interrompida'
      : 'Não foi possível concluir a análise'

  return (
    <section className={`analysis-center analysis-center--${scanStatus}`} aria-label="Central de Análise">
      <div className="analysis-center__glow" />
      <div className="analysis-center__grid" />
      <div className="analysis-center__wave" />

      <header className="analysis-center__header">
        <div>
          <span className="analysis-center__eyebrow"><Activity size={13} /> INTELIGÊNCIA DO SISTEMA</span>
          <h2>Central de Análise</h2>
        </div>
        {running && <span className="analysis-center__status analysis-center__status--running"><span className="analysis-center__status-dot" /> Análise em andamento</span>}
        {complete && <span className="analysis-center__status analysis-center__status--success"><Check size={13} /> Diagnóstico concluído</span>}
        {attention && <span className="analysis-center__status analysis-center__status--warning"><TriangleAlert size={13} /> Concluído com avisos</span>}
        {scanStatus === 'canceled' && <span className="analysis-center__status analysis-center__status--warning"><TriangleAlert size={13} /> Análise cancelada</span>}
        {scanStatus === 'disconnected' && <span className="analysis-center__status analysis-center__status--warning"><TriangleAlert size={13} /> Dispositivo desconectado</span>}
        {scanStatus === 'failed' && <span className="analysis-center__status analysis-center__status--error"><TriangleAlert size={13} /> Falha na análise</span>}
        {idleWithoutDevice && <span className="analysis-center__status">Aguardando dispositivo</span>}
      </header>

      {idleWithoutDevice ? (
        <div className="analysis-idle">
          <div className="analysis-orb"><div className="analysis-orb__ring analysis-orb__ring--1" /><div className="analysis-orb__ring analysis-orb__ring--2" /><div className="analysis-orb__ring analysis-orb__ring--3" /><div className="analysis-orb__core"><FileSearch size={28} /></div></div>
          <div className="analysis-idle__content"><strong>Sistema pronto para diagnóstico</strong><span>Conecte um dispositivo Android via USB para iniciar uma análise.</span></div>
        </div>
      ) : (
        <>
          <div className="analysis-center__body">
            <div className="analysis-flow">
              {STEPS.map((step, index) => {
                const Icon = step.icon
                const state = getStepState(index)
                return <div className="analysis-step-wrapper" key={step.id}><div className={`analysis-step analysis-step--${state}`}><div className="analysis-step__icon">{state === 'completed' ? <Check size={15} /> : <Icon size={16} />}</div><div className="analysis-step__copy"><strong>{step.label}</strong><span>{state === 'completed' ? 'Concluído' : state === 'active' ? 'Em andamento' : state === 'interrupted' ? 'Interrompido' : 'Pendente'}</span></div></div>{index < STEPS.length - 1 && <div className={`analysis-connector ${getStepState(index + 1) !== 'pending' ? 'analysis-connector--active' : ''}`} />}</div>
              })}
            </div>
            <div className="analysis-live"><div className="analysis-live__scanner"><div className="analysis-live__radar"><div className="analysis-live__radar-ring" /><div className="analysis-live__radar-ring analysis-live__radar-ring--2" /><div className="analysis-live__radar-core" /></div></div><div className="analysis-live__content"><strong>{running ? scan?.message || 'Analisando dispositivo...' : complete ? 'Diagnóstico concluído' : attention ? 'Análise concluída com avisos de coleta' : interrupted ? terminalTitle : 'Pronto para iniciar'}</strong><span>{running && scan?.details ? scan.details : complete ? 'Revise os resultados antes de finalizar o atendimento.' : attention ? 'O resultado foi preservado; consulte os avisos técnicos nos detalhes.' : interrupted ? scan?.message || 'Inicie uma nova análise quando o dispositivo estiver pronto.' : 'Selecione um modo de análise e inicie o scan.'}</span>{(running || complete || attention || interrupted) && <div className="analysis-progress"><div className="analysis-progress__head"><span>Progresso da análise</span><strong>{progress}%</strong></div><div className="analysis-progress__track"><div className="analysis-progress__value" style={{ width: `${progress}%` }}>{running && <span className="analysis-progress__beam" />}</div></div></div>}{running && <div className="analysis-metrics">{scan?.checkedItems != null && <span><strong>{scan.checkedItems}</strong> itens verificados</span>}{scan?.alertCount != null && <span><strong>{scan.alertCount}</strong> alertas</span>}{scan?.elapsed && <span>{scan.elapsed}</span>}</div>}</div></div>
          </div>
          <footer className="analysis-center__footer">
            {!running && !complete && !attention && connected && <button type="button" className="analysis-button analysis-button--primary" onClick={onStartScan}><Play size={16} /> Iniciar análise</button>}
            {(complete || attention) && <><button type="button" className="analysis-button" onClick={onViewDetails}>Ver detalhes</button>{attention && <button type="button" className="analysis-button analysis-button--warning" onClick={onFixProblems}><Shield size={15} /> Corrigir problemas</button>}</>}
          </footer>
        </>
      )}
    </section>
  )
}

export default AnalysisCenter
