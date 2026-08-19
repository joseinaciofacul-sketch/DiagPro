import { useState, useEffect } from 'react'
import {
  LayoutDashboard, ScanLine, Smartphone, Stethoscope, ShieldAlert,
  History, FileText, Users, Settings, Search, Bell, Sun, ChevronDown,
  Shield, Gauge, BatteryFull, HardDrive, Cog, Wifi, Usb, Battery,
  CloudUpload, Play, CheckCircle2, HelpCircle, Building2
} from 'lucide-react'
import './Dashboard.css'

const menuItems = [
  { icon: LayoutDashboard, label: 'Dashboard', active: true },
  { icon: ScanLine, label: 'Scanner' },
  { icon: Smartphone, label: 'Dispositivos' },
  { icon: Stethoscope, label: 'Diagnósticos' },
  { icon: ShieldAlert, label: 'Ameaças' },
  { icon: History, label: 'Histórico' },
  { icon: FileText, label: 'Relatórios' },
  { icon: Users, label: 'Clientes' },
  { icon: Settings, label: 'Configurações' },
]

const stats = [
  { icon: ScanLine, value: 248, label: 'Diagnósticos', change: '+18%', trend: 'up', color: '#3b82f6' },
  { icon: ShieldAlert, value: 17, label: 'Ameaças detectadas', change: '-8%', trend: 'down', color: '#a855f7' },
  { icon: CheckCircle2, value: 231, label: 'Dispositivos seguros', change: '+22%', trend: 'up', color: '#22c55e' },
  { icon: FileText, value: 12, label: 'Relatórios gerados', change: '+15%', trend: 'up', color: '#f59e0b' },
]

const modules = [
  { icon: Shield, title: 'Segurança', desc: 'Verifica ameaças, malware e vulnerabilidades', status: 'Protegido', statusColor: '#22c55e' },
  { icon: Gauge, title: 'Performance', desc: 'Analisa desempenho e otimizações possíveis', status: 'Analisado', statusColor: '#3b82f6' },
  { icon: BatteryFull, title: 'Bateria', desc: 'Verifica saúde e consumo de bateria', status: 'Analisado', statusColor: '#3b82f6' },
  { icon: HardDrive, title: 'Armazenamento', desc: 'Analisa espaço e integridade do armazenamento', status: 'Analisado', statusColor: '#3b82f6' },
  { icon: Cog, title: 'Sistema', desc: 'Verifica sistema, atualizações e configurações', status: 'Analisado', statusColor: '#3b82f6' },
  { icon: Wifi, title: 'Rede', desc: 'Testa conexões Wi-Fi, Bluetooth e rede móvel', status: 'Pendente', statusColor: '#f59e0b' },
]

const threats = [
  { name: 'Trojan.Android.HiddenAds', risk: 'Risco alto', level: 'high', action: 'Remover' },
  { name: 'Adware.MobiDash', risk: 'Risco médio', level: 'medium', action: 'Resolver' },
  { name: 'PUA.Heuristic.Generic', risk: 'Risco baixo', level: 'low', action: 'Resolver' },
]

const activities = [
  { text: 'Diagnóstico concluído - Galaxy S24', time: '10:24' },
  { text: 'Ameaça removida - Trojan.Android.HiddenAds', time: '10:24' },
  { text: 'Backup criado - Galaxy S24', time: '10:20' },
  { text: 'Relatório gerado - Galaxy S24', time: '10:18' },
  { text: 'Novo dispositivo conectado - iPhone 15', time: '10:15' },
]

const scoreHistory = [78, 82, 85, 80, 88, 90, 92]
const scoreDates = ['12/05', '13/05', '14/05', '15/05', '16/05', '17/05', '18/05']

function Dashboard({ username, onLogout }) {
  const [dispositivo, setDispositivo] = useState({ conectado: false })

  useEffect(() => {
    async function verificar() {
      if (window.diagpro) {
        const resultado = await window.diagpro.detectarDispositivo()
        setDispositivo(resultado)
      }
    }
    verificar()
    const intervalo = setInterval(verificar, 3000)
    return () => clearInterval(intervalo)
  }, [])

  return (
    <div className="dp-layout">
      <aside className="dp-sidebar">
        <div className="dp-logo">
          <img src="/logo.png" alt="DiagPro" className="dp-logo-icon" />
          <div>
            <div className="dp-logo-title">Diag<span>Pro</span></div>
            <div className="dp-logo-sub">Diagnóstico profissional de dispositivos</div>
          </div>
        </div>

        <nav className="dp-nav">
          {menuItems.map((item) => (
            <div key={item.label} className={`dp-nav-item ${item.active ? 'active' : ''}`}>
              <item.icon size={18} />
              <span>{item.label}</span>
            </div>
          ))}
        </nav>

        <div className="dp-sidebar-bottom">
          <div className="dp-plan-card">
            <div className="dp-plan-head">
              <Building2 size={16} />
              <span>Plano Empresarial</span>
              <span className="dp-badge-active">Ativo</span>
            </div>
            <p>Licença válida até 18/05/2026<br />Dispositivos ilimitados</p>
          </div>
          <div className="dp-plan-card">
            <div className="dp-plan-head">
              <Shield size={16} />
              <span>Sistema protegido</span>
            </div>
            <p>Última verificação: 10:24<br />Todos os módulos atualizados</p>
          </div>
          <button className="dp-help-link" onClick={onLogout}>
            <HelpCircle size={16} /> Sair
          </button>
        </div>
      </aside>

      <div className="dp-main">
        <header className="dp-topbar">
          <div className="dp-search">
            <Search size={16} />
            <input placeholder="Buscar dispositivo, cliente, relatório..." />
            <kbd>Ctrl + K</kbd>
          </div>
          <div className="dp-topbar-right">
            <button className="dp-icon-btn dp-notif">
              <Bell size={18} />
              <span className="dp-notif-badge">3</span>
            </button>
            <button className="dp-icon-btn"><Sun size={18} /></button>
            <div className="dp-user">
              <div className="dp-avatar" />
              <div>
                <div className="dp-user-name">{username || 'Assistência Tech'}</div>
                <div className="dp-user-role">Administrador</div>
              </div>
              <ChevronDown size={16} />
            </div>
          </div>
        </header>

        <div className="dp-content">
          <div className="dp-content-grid">
            <div className="dp-content-main">
              <div className="dp-greeting-row">
                <div>
                  <h1>Boa noite, {username || 'Assistência Tech'}! 👋</h1>
                  <p>Aqui está o resumo dos seus diagnósticos e da sua operação.</p>
                </div>
                <button className="dp-primary-btn">+ Novo diagnóstico</button>
              </div>

              <div className="dp-stats-grid">
                {stats.map((s) => (
                  <div className="dp-stat-card" key={s.label}>
                    <div className="dp-stat-icon" style={{ background: `${s.color}22`, color: s.color }}>
                      <s.icon size={20} />
                    </div>
                    <div className="dp-stat-value">{s.value}</div>
                    <div className="dp-stat-label">{s.label}</div>
                    <div className={`dp-stat-change ${s.trend}`}>
                      {s.trend === 'up' ? '↑' : '↓'} {s.change} vs semana passada
                    </div>
                  </div>
                ))}
              </div>

              <div className="dp-card dp-device-card">
                <div className="dp-card-title">DISPOSITIVO CONECTADO</div>
                {dispositivo.conectado ? (
                  <div className="dp-device-body">
                    <div className="dp-device-visual">
                      <Smartphone size={64} />
                    </div>
                    <div className="dp-device-info">
                      <h2>{dispositivo.fabricante} {dispositivo.modelo}</h2>
                      <div className="dp-device-tags">
                        <span><Smartphone size={14} /> Android {dispositivo.versaoAndroid}</span>
                        <span><Usb size={14} /> USB conectado</span>
                      </div>
                      <div className="dp-device-tags">
                        <span><Battery size={14} /> Bateria: {dispositivo.bateria}%</span>
                      </div>
                      <button className="dp-primary-btn dp-start-btn">
                        <Play size={16} /> Iniciar diagnóstico
                      </button>
                    </div>
                    <div className="dp-device-quickinfo">
                      <div className="dp-quickinfo-title">INFORMAÇÕES RÁPIDAS</div>
                      <div><span>Modelo</span><strong>{dispositivo.modelo}</strong></div>
                      <div><span>SDK Android</span><strong>{dispositivo.sdk}</strong></div>
                      <div><span>Serial</span><strong>{dispositivo.serial}</strong></div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '30px 0', textAlign: 'center', color: '#64748b' }}>
                    <Usb size={32} style={{ marginBottom: 10, opacity: 0.5 }} />
                    <p>Nenhum dispositivo conectado. Conecte um Android via USB com a depuração USB ativada.</p>
                  </div>
                )}
              </div>

              <div className="dp-card">
                <div className="dp-card-title-row">
                  <div className="dp-card-title">MÓDULOS DE DIAGNÓSTICO</div>
                  <a href="#">Ver todas &gt;</a>
                </div>
                <div className="dp-modules-grid">
                  {modules.map((m) => (
                    <div className="dp-module-card" key={m.title}>
                      <div className="dp-module-icon"><m.icon size={20} /></div>
                      <div className="dp-module-title">{m.title}</div>
                      <div className="dp-module-desc">{m.desc}</div>
                      <div className="dp-module-status" style={{ color: m.statusColor }}>✓ {m.status}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="dp-content-side">
              <div className="dp-card">
                <div className="dp-card-title-row">
                  <div className="dp-card-title">HEALTH SCORE</div>
                  <a href="#">Ver detalhes &gt;</a>
                </div>
                <div className="dp-score-gauge">
                  <svg viewBox="0 0 200 120" className="dp-gauge-svg">
                    <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#1e293b" strokeWidth="16" strokeLinecap="round" />
                    <path
                      d="M 20 100 A 80 80 0 0 1 180 100"
                      fill="none"
                      stroke="url(#gaugeGradient)"
                      strokeWidth="16"
                      strokeLinecap="round"
                      strokeDasharray="251.2"
                      strokeDashoffset={251.2 * (1 - 92 / 100)}
                    />
                    <defs>
                      <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#22d3ee" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="dp-gauge-center">
                    <div className="dp-gauge-value">92</div>
                    <div className="dp-gauge-max">/100</div>
                  </div>
                </div>
                <div className="dp-score-label">Excelente</div>
                <p className="dp-score-desc">Seu dispositivo está em excelente estado.</p>
                <svg viewBox="0 0 280 80" className="dp-linechart">
                  <polyline
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="2"
                    points={scoreHistory.map((v, i) => `${(i / (scoreHistory.length - 1)) * 280},${80 - (v / 100) * 80}`).join(' ')}
                  />
                </svg>
                <div className="dp-chart-dates">
                  {scoreDates.map((d) => <span key={d}>{d}</span>)}
                </div>
              </div>

              <div className="dp-card">
                <div className="dp-card-title-row">
                  <div className="dp-card-title">AMEAÇAS RECENTES</div>
                  <a href="#">Ver todas &gt;</a>
                </div>
                {threats.map((t) => (
                  <div className={`dp-threat-item level-${t.level}`} key={t.name}>
                    <ShieldAlert size={18} />
                    <div className="dp-threat-info">
                      <div className="dp-threat-name">{t.name}</div>
                      <div className="dp-threat-risk">{t.risk}</div>
                    </div>
                    <button className={`dp-threat-btn level-${t.level}`}>{t.action}</button>
                  </div>
                ))}
                <button className="dp-view-all-btn">Ver todas as ameaças</button>
              </div>

              <div className="dp-card">
                <div className="dp-card-title-row">
                  <div className="dp-card-title">ATIVIDADES RECENTES</div>
                  <a href="#">Ver todas &gt;</a>
                </div>
                {activities.map((a, i) => (
                  <div className="dp-activity-item" key={i}>
                    <CheckCircle2 size={16} />
                    <span>{a.text}</span>
                    <span className="dp-activity-time">{a.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer className="dp-footer">
          <span>🟢 Servidor: Online</span>
          <span>🟢 API: Conectada</span>
          <span>Versão: 2.1.0</span>
          <span>© 2026 DiagPro. Todos os direitos reservados.</span>
        </footer>
      </div>
    </div>
  )
}

export default Dashboard