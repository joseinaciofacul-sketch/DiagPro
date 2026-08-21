import { useMemo, useState } from 'react'
import { Building2, ClipboardList, Info, Laptop, ScanLine, Users } from 'lucide-react'
import './ManagementPage.css'

const managementTabs = [
  { id: 'devices', label: 'Dispositivos', icon: Laptop },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'diagnostics', label: 'Diagnósticos', icon: ClipboardList },
]

function getDeviceName(device) {
  const manufacturer = device?.manufacturer || device?.fabricante || ''
  const model = device?.model || device?.modelo || device?.name || device?.nome || ''
  return [manufacturer, model].filter(Boolean).join(' ') || 'Dispositivo sem identificação'
}

function getClientName(client) {
  return client?.name || client?.nome || client?.fullName || 'Cliente sem nome'
}

function getDiagnosticName(diagnostic) {
  return diagnostic?.name || diagnostic?.nome || diagnostic?.title || diagnostic?.titulo || 'Diagnóstico sem identificação'
}

function getDiagnosticMeta(diagnostic) {
  return [
    diagnostic?.status || diagnostic?.estado,
    diagnostic?.createdAt || diagnostic?.created_at || diagnostic?.data,
  ].filter(Boolean).join(' · ')
}

function searchText(item, tab) {
  if (tab === 'devices') {
    return [getDeviceName(item), item?.serial, item?.status, item?.estado].filter(Boolean).join(' ')
  }
  if (tab === 'clients') {
    return [getClientName(item), item?.email, item?.phone, item?.telefone].filter(Boolean).join(' ')
  }
  return [getDiagnosticName(item), getDiagnosticMeta(item)].filter(Boolean).join(' ')
}

function ManagementPage({ devices, clients, diagnostics, lastScan, onNavigate }) {
  const [activeTab, setActiveTab] = useState('devices')
  const [query, setQuery] = useState('')

  const sourceLists = {
    devices: Array.isArray(devices) ? devices : [],
    clients: Array.isArray(clients) ? clients : [],
    diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
  }
  const sourceList = sourceLists[activeTab]
  const entries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
    if (!normalizedQuery) return sourceList

    return sourceList.filter((item) => searchText(item, activeTab).toLocaleLowerCase('pt-BR').includes(normalizedQuery))
  }, [activeTab, query, sourceList])

  const activeTabLabel = managementTabs.find((tab) => tab.id === activeTab)?.label || 'Registros'

  return (
    <section className="dp-management-page" aria-labelledby="dp-management-title">
      <div className="dp-management-header">
        <div>
          <h1 id="dp-management-title">Visão gerencial</h1>
          <p>Consulte apenas os registros que forem fornecidos por serviços reais da operação.</p>
        </div>
        <button className="dp-management-primary-action" type="button" onClick={() => onNavigate?.('Scanner')}>
          <ScanLine size={17} /> Novo diagnóstico
        </button>
      </div>

      <div className="dp-management-service-note">
        <Info size={18} />
        <div>
          <strong>Dados operacionais ainda não persistidos.</strong>
          <span>O backend Django não está conectado; por isso, dispositivos, clientes e histórico só aparecem quando recebidos por props de uma integração real.</span>
        </div>
      </div>

      <div className="dp-management-summary-grid">
        <div className="dp-management-summary-card">
          <div className="dp-management-summary-icon"><Laptop size={19} /></div>
          <div><span>Dispositivos recebidos</span><strong>{sourceLists.devices.length}</strong></div>
        </div>
        <div className="dp-management-summary-card">
          <div className="dp-management-summary-icon"><Users size={19} /></div>
          <div><span>Clientes recebidos</span><strong>{sourceLists.clients.length}</strong></div>
        </div>
        <div className="dp-management-summary-card">
          <div className="dp-management-summary-icon"><ClipboardList size={19} /></div>
          <div><span>Diagnósticos recebidos</span><strong>{sourceLists.diagnostics.length}</strong></div>
        </div>
      </div>

      {lastScan && (
        <div className="dp-management-session-note">
          <ScanLine size={18} />
          <span>Há uma coleta disponível apenas nesta sessão. Use o scanner ou conecte a persistência para incorporá-la ao histórico.</span>
        </div>
      )}

      <div className="dp-management-card">
        <div className="dp-management-card-heading">
          <div>
            <h2>Registros da operação</h2>
            <p>Use as abas e a busca para revisar dados recebidos.</p>
          </div>
          <label className="dp-management-search">
            <span className="dp-management-visually-hidden">Buscar registros</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Buscar em ${activeTabLabel.toLocaleLowerCase('pt-BR')}`} />
          </label>
        </div>

        <div className="dp-management-tabs" role="tablist" aria-label="Categorias de registros">
          {managementTabs.map((tab) => {
            const Icon = tab.icon
            const count = sourceLists[tab.id].length
            return (
              <button
                className={`dp-management-tab ${activeTab === tab.id ? 'dp-management-tab-active' : ''}`}
                key={tab.id}
                id={`dp-management-tab-${tab.id}`}
                role="tab"
                type="button"
                aria-selected={activeTab === tab.id}
                onClick={() => { setActiveTab(tab.id); setQuery('') }}
              >
                <Icon size={16} /> {tab.label} <span>{count}</span>
              </button>
            )
          })}
        </div>

        <div className="dp-management-panel" role="tabpanel" aria-labelledby={`dp-management-tab-${activeTab}`}>
          {entries.length > 0 ? (
            <ul className="dp-management-list">
              {entries.map((item, index) => {
                const isDevice = activeTab === 'devices'
                const isClient = activeTab === 'clients'
                const title = isDevice ? getDeviceName(item) : isClient ? getClientName(item) : getDiagnosticName(item)
                const details = isDevice
                  ? [item?.serial, item?.status || item?.estado].filter(Boolean).join(' · ')
                  : isClient
                    ? [item?.email, item?.phone || item?.telefone].filter(Boolean).join(' · ')
                    : getDiagnosticMeta(item)
                const Icon = isDevice ? Laptop : isClient ? Users : ClipboardList

                return (
                  <li className="dp-management-item" key={item?.id || item?.uuid || `${title}-${index}`}>
                    <div className="dp-management-item-icon"><Icon size={18} /></div>
                    <div>
                      <strong>{title}</strong>
                      {details && <span>{details}</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="dp-management-empty-state">
              <Building2 size={36} aria-hidden="true" />
              <h2>{sourceList.length ? `Nenhum resultado em ${activeTabLabel.toLocaleLowerCase('pt-BR')}` : `Nenhum registro de ${activeTabLabel.toLocaleLowerCase('pt-BR')}`}</h2>
              <p>
                {sourceList.length
                  ? 'Altere a busca para visualizar os registros recebidos.'
                  : 'Esta área permanece vazia até que uma API Django ou outro conector forneça dados reais.'}
              </p>
              {activeTab === 'devices' && <button className="dp-management-secondary-action" type="button" onClick={() => onNavigate?.('Scanner')}><ScanLine size={16} /> Abrir scanner</button>}
              {activeTab === 'clients' && <button className="dp-management-secondary-action" type="button" onClick={() => onNavigate?.('Clientes')}><Users size={16} /> Abrir clientes</button>}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default ManagementPage
