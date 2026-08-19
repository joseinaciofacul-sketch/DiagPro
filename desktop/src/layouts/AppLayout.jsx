import {
  LayoutDashboard, ScanLine, Smartphone, Stethoscope, ShieldAlert,
  History, FileText, Users, Settings, Search, Bell, Sun, ChevronDown,
  Shield, HelpCircle, Building2
} from 'lucide-react'
import './AppLayout.css'

const menuItems = [
  { icon: LayoutDashboard, label: 'Dashboard' },
  { icon: ScanLine, label: 'Scanner' },
  { icon: Smartphone, label: 'Dispositivos' },
  { icon: Stethoscope, label: 'Diagnósticos' },
  { icon: ShieldAlert, label: 'Ameaças' },
  { icon: History, label: 'Histórico' },
  { icon: FileText, label: 'Relatórios' },
  { icon: Users, label: 'Clientes' },
  { icon: Settings, label: 'Configurações' },
]

function AppLayout({ username, onLogout, activePage, onNavigate, children }) {
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
            <div
              key={item.label}
              className={`dp-nav-item ${activePage === item.label ? 'active' : ''}`}
              onClick={() => onNavigate(item.label)}
            >
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
          {children}
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

export default AppLayout
