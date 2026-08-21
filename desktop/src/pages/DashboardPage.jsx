import { useState } from 'react'
import {
  AlertTriangle, AppWindow, BatteryCharging, ChevronDown, CircleCheck,
  Clock3, Cpu, DatabaseBackup, Gauge, HardDrive, HelpCircle,
  History, MemoryStick, Play, Rocket, Search, Settings2, Shield, ShieldCheck,
  Smartphone, Sparkles, Trash2, Wifi
} from 'lucide-react'
import useDeviceStatus from '../hooks/useDeviceStatus.js'
import DeviceCard from '../components/DeviceCard.jsx'
import './DashboardPage.css'

const healthItems = [
  { icon: ShieldCheck, label: 'Segurança', status: 'Excelente', tone: 'blue' },
  { icon: Gauge, label: 'Desempenho', status: 'Excelente', tone: 'cyan' },
  { icon: Settings2, label: 'Sistema', status: 'Excelente', tone: 'slate' },
  { icon: BatteryCharging, label: 'Bateria', status: 'Bom', tone: 'green' },
  { icon: HardDrive, label: 'Armazenamento', status: 'Excelente', tone: 'blue' },
]

const applications = [
  { icon: '◉', name: 'WhatsApp Messenger', package: 'com.whatsapp', status: 'Seguro', tone: 'safe' },
  { icon: '◎', name: 'Instagram', package: 'com.instagram.android', status: 'Seguro', tone: 'safe' },
  { icon: '◉', name: 'Chrome', package: 'com.android.chrome', status: 'Seguro', tone: 'safe' },
  { icon: 'f', name: 'Facebook', package: 'com.facebook.katana', status: 'Atenção', tone: 'warning' },
  { icon: '✦', name: 'Phone Cleaner Pro', package: 'com.cleaner.pro', status: 'Risco', tone: 'danger' },
  { icon: '◈', name: 'Super Battery Saver', package: 'com.battery.saver', status: 'Risco', tone: 'danger' },
  { icon: '♪', name: 'TikTok', package: 'com.tiktok.app.musically', status: 'Seguro', tone: 'safe' },
]

const threats = [
  { icon: Shield, name: 'Super Battery Saver', package: 'com.super.battery.saver', risk: 'Risco elevado', time: 'Hoje, 10:32', tone: 'danger' },
  { icon: Shield, name: 'Phone Cleaner Pro', package: 'com.cleaner.pro', risk: 'Risco médio', time: 'Hoje, 10:31', tone: 'warning' },
  { icon: Shield, name: 'Unknown.Trojan.Mobi', package: 'arquivo suspeito', risk: 'Risco elevado', time: 'Hoje, 10:28', tone: 'danger' },
]

const quickActions = [
  { icon: Sparkles, label: 'Limpeza\nProfunda', tone: 'blue' },
  { icon: Rocket, label: 'Otimização\nde Sistema', tone: 'green' },
  { icon: BatteryCharging, label: 'Verificação\nde Bateria', tone: 'yellow' },
  { icon: AppWindow, label: 'Gerenciar\nApps', tone: 'purple' },
  { icon: DatabaseBackup, label: 'Backup de\nDados', tone: 'cyan' },
]

const systemSummary = [
  { icon: Cpu, label: 'CPU', value: '45°C', tone: 'positive' },
  { icon: MemoryStick, label: 'Memória RAM', value: '6.2 GB / 16 GB', tone: 'positive' },
  { icon: HardDrive, label: 'Armazenamento', value: '128 GB / 256 GB', tone: 'positive' },
  { icon: Wifi, label: 'Rede', value: 'Conectado (Wi-Fi)', tone: 'positive' },
  { icon: Smartphone, label: 'Android', value: 'Android 14 (One UI 6.1)' },
  { icon: Clock3, label: 'Tempo ligado', value: '2h 45m' },
]

function StorageRing() {
  return <div className="dp-storage-ring"><strong>64%</strong></div>
}

function DashboardPage() {
  const dispositivo = useDeviceStatus()
  const [analysisType, setAnalysisType] = useState('Rápida')

  return (
    <div className="dashboard-reference">
      <header className="dashboard-heading">
        <div><h1>Dashboard</h1><p>Visão geral do dispositivo e da saúde do sistema</p></div>
        <div className="dashboard-overview">
          <div className="overview-device"><DeviceCard estado={dispositivo} /><ChevronDown size={16} className="overview-chevron" /></div>
          <div className="overview-stat overview-battery"><BatteryCharging size={28} /><div><span>Bateria</span><strong>84% <small>Carregando</small></strong></div></div>
          <div className="overview-stat overview-storage"><StorageRing /><div><span>Armazenamento</span><strong>128 GB <small>/ 256 GB</small></strong></div></div>
        </div>
      </header>

      <main className="dashboard-grid">
        <div className="dashboard-column dashboard-left">
          <section className="dashboard-panel health-panel"><div className="panel-heading"><h2>Saúde do Sistema</h2><HelpCircle size={16} /></div><div className="health-overview"><div className="health-gauge"><div className="health-gauge-inner"><strong>92%</strong><span>Excelente</span></div></div><div className="health-copy"><p>Seu dispositivo está com ótima saúde. Continue realizando scans regularmente.</p><span className="healthy-badge"><CircleCheck size={14} /> Tudo funcionando bem</span></div></div><div className="health-items">{healthItems.map(({ icon: Icon, label, status, tone }) => <div className="health-item" key={label}><Icon size={20} className={`tone-${tone}`} /><span>{label}</span><strong>{status}</strong></div>)}</div></section>
          <section className="dashboard-panel threats-panel"><div className="panel-heading"><h2>Ameaças Recentes <b className="danger-count">3</b></h2><button className="text-button">Ver todas</button></div>{threats.map(({ icon: Icon, name, package: packageName, risk, time, tone }) => <div className="threat-row" key={name}><span className={`threat-icon ${tone}`}><Icon size={16} /></span><div className="threat-name"><strong>{name}</strong><small>{packageName}</small></div><div className={`threat-risk ${tone}`}><strong>{risk}</strong><small>{time}</small></div><button className="remove-button">Remover</button></div>)}<button className="remove-all-button"><Trash2 size={15} /> Remover todas as ameaças</button></section>
        </div>

        <div className="dashboard-column dashboard-center">
          <section className="dashboard-panel scanner-panel"><div className="panel-heading"><h2>Scanner Inteligente</h2><span className="recommended-badge">Recomendado</span></div><div className="scanner-radar"><div className="radar-ring ring-one" /><div className="radar-ring ring-two" /><div className="radar-ring ring-three" /><div className="radar-cross" /><div className="scanner-shield"><Shield size={58} /><Search size={27} /></div></div><span className="analysis-label">Tipos de análise</span><div className="analysis-options">{['Rápida', 'Completa', 'Personalizada'].map((type) => <button key={type} className={analysisType === type ? 'selected' : ''} onClick={() => setAnalysisType(type)}>{type}</button>)}</div><button className="start-scan-button"><Play size={17} fill="currentColor" /> Iniciar Scan</button><span className="last-scan">Último scan: Hoje, 10:58</span><button className="scan-history"><History size={14} /> Histórico de scans</button></section>
          <section className="dashboard-panel quick-panel"><div className="panel-heading"><h2>Ações Rápidas</h2></div><div className="quick-actions">{quickActions.map(({ icon: Icon, label, tone }) => <button className="quick-action" key={label}><Icon size={30} className={`tone-${tone}`} /><span>{label.split('\n').map((line) => <span key={line}>{line}</span>)}</span></button>)}</div></section>
        </div>

        <div className="dashboard-column dashboard-right">
          <section className="dashboard-panel apps-panel"><div className="panel-heading"><h2>Aplicativos do Dispositivo <b className="app-count">12</b></h2><button className="more-button">⋮</button></div><div className="apps-head"><span>Aplicativo</span><span>Status</span></div><div className="app-list">{applications.map((app) => <div className="app-row" key={app.name}><span className={`app-logo app-${app.tone}`}>{app.icon}</span><div className="app-name"><strong>{app.name}</strong><small>{app.package}</small></div><div className={`app-status ${app.tone}`}><span>{app.tone === 'safe' ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}</span>{app.status}</div>{app.tone === 'warning' && <button className="details-button">Detalhes</button>}{app.tone === 'danger' && <button className="remove-button">Remover</button>}</div>)}</div><button className="all-apps-button">Ver todos os aplicativos (12) <ChevronDown size={15} /></button></section>
          <section className="dashboard-panel system-panel"><div className="panel-heading"><h2>Resumo do Sistema</h2></div><div className="system-list">{systemSummary.map(({ icon: Icon, label, value, tone }) => <div className="system-row" key={label}><span><Icon size={15} />{label}</span><strong className={tone}>{value}</strong></div>)}</div></section>
        </div>
      </main>
    </div>
  )
}

export default DashboardPage