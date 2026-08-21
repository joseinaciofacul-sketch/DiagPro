import { useMemo, useState } from 'react'
import { Mail, Phone, Plus, Search, Smartphone, UserPlus, Users, X } from 'lucide-react'
import './ClientsPage.css'

const clientFilters = [
  { id: 'todos', label: 'Todos' },
  { id: 'com-dispositivos', label: 'Com dispositivos' },
  { id: 'sem-dispositivos', label: 'Sem dispositivos' },
]

function getClientName(client) {
  return client?.name || client?.nome || client?.fullName || 'Cliente sem nome'
}

function getClientDeviceCount(client) {
  if (typeof client?.deviceCount === 'number') return client.deviceCount
  if (typeof client?.devicesCount === 'number') return client.devicesCount
  if (Array.isArray(client?.devices)) return client.devices.length
  return null
}

function ClientsPage({ clients, username, onNavigate, onCreateClient }) {
  const [activeFilter, setActiveFilter] = useState('todos')
  const [query, setQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '' })
  const [formMessage, setFormMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const clientList = Array.isArray(clients) ? clients : []
  const filteredClients = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')

    return clientList.filter((client) => {
      const deviceCount = getClientDeviceCount(client)
      const matchesFilter = activeFilter === 'todos'
        || (activeFilter === 'com-dispositivos' && deviceCount !== null && deviceCount > 0)
        || (activeFilter === 'sem-dispositivos' && deviceCount === 0)
      const searchableText = [getClientName(client), client?.email, client?.telefone, client?.phone]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('pt-BR')

      return matchesFilter && (!normalizedQuery || searchableText.includes(normalizedQuery))
    })
  }, [activeFilter, clientList, query])

  function closeModal() {
    setIsModalOpen(false)
    setFormMessage('')
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setFormMessage('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.name.trim()) {
      setFormMessage('Informe o nome do cliente para continuar.')
      return
    }

    if (typeof onCreateClient !== 'function') {
      setFormMessage('O cadastro não pode ser salvo: a API Django de clientes ainda não está conectada.')
      return
    }

    setIsSubmitting(true)
    setFormMessage('')
    try {
      await onCreateClient({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
      })
      closeModal()
      setForm({ name: '', email: '', phone: '' })
    } catch {
      setFormMessage('Não foi possível cadastrar o cliente. Verifique a conexão com o serviço.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="dp-clients-page" aria-labelledby="dp-clients-title">
      <div className="dp-clients-header">
        <div>
          <h1 id="dp-clients-title">Clientes</h1>
          <p>{username ? `Base de atendimento de ${username}.` : 'Organize os clientes e os dispositivos associados.'}</p>
        </div>
        <button className="dp-clients-primary-action" type="button" onClick={() => setIsModalOpen(true)}>
          <UserPlus size={17} /> Novo cliente
        </button>
      </div>

      <div className="dp-clients-service-note">
        <Users size={18} />
        <p>Não há backend Django conectado. A listagem e o cadastro só exibem ou persistem dados quando uma integração real for fornecida.</p>
      </div>

      <div className="dp-clients-toolbar">
        <label className="dp-clients-search">
          <Search size={16} />
          <span className="dp-clients-visually-hidden">Buscar clientes</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome, e-mail ou telefone"
          />
        </label>
        <div className="dp-clients-filters" aria-label="Filtrar clientes">
          {clientFilters.map((filter) => (
            <button
              className={`dp-clients-filter ${activeFilter === filter.id ? 'dp-clients-filter-active' : ''}`}
              key={filter.id}
              type="button"
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dp-clients-card">
        <div className="dp-clients-card-heading">
          <div>
            <h2>Base de clientes</h2>
            <p>{filteredClients.length} registro{filteredClients.length === 1 ? '' : 's'} encontrado{filteredClients.length === 1 ? '' : 's'}</p>
          </div>
        </div>

        {filteredClients.length > 0 ? (
          <ul className="dp-clients-list">
            {filteredClients.map((client, index) => {
              const deviceCount = getClientDeviceCount(client)
              const email = client?.email || ''
              const phone = client?.phone || client?.telefone || ''
              const name = getClientName(client)

              return (
                <li className="dp-clients-item" key={client?.id || client?.uuid || `${name}-${index}`}>
                  <div className="dp-clients-avatar" aria-hidden="true">{name.charAt(0).toLocaleUpperCase('pt-BR')}</div>
                  <div className="dp-clients-item-main">
                    <strong>{name}</strong>
                    <div className="dp-clients-contact-list">
                      {email && <span><Mail size={13} /> {email}</span>}
                      {phone && <span><Phone size={13} /> {phone}</span>}
                    </div>
                  </div>
                  {deviceCount !== null && (
                    <span className="dp-clients-device-count"><Smartphone size={15} /> {deviceCount} dispositivo{deviceCount === 1 ? '' : 's'}</span>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="dp-clients-empty-state">
            <Users size={35} aria-hidden="true" />
            <h2>{clientList.length ? 'Nenhum cliente corresponde aos filtros' : 'Nenhum cliente disponível'}</h2>
            <p>
              {clientList.length
                ? 'Ajuste a busca ou os filtros para visualizar os registros recebidos.'
                : 'Conecte a API Django para carregar a base de clientes ou envie um cadastro por uma integração própria.'}
            </p>
            <div className="dp-clients-empty-actions">
              <button className="dp-clients-primary-action" type="button" onClick={() => setIsModalOpen(true)}><Plus size={16} /> Novo cliente</button>
              <button className="dp-clients-secondary-action" type="button" onClick={() => onNavigate?.('Scanner')}><Smartphone size={16} /> Ir para scanner</button>
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="dp-clients-modal-backdrop" role="presentation" onMouseDown={closeModal}>
          <form className="dp-clients-modal" aria-labelledby="dp-clients-modal-title" aria-modal="true" role="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={handleSubmit}>
            <button className="dp-clients-modal-close" type="button" aria-label="Fechar" onClick={closeModal}><X size={18} /></button>
            <h2 id="dp-clients-modal-title">Cadastrar cliente</h2>
            <p>Os dados só serão salvos se uma integração de cadastro for disponibilizada.</p>
            <label className="dp-clients-field">
              <span>Nome *</span>
              <input value={form.name} onChange={(event) => updateField('name', event.target.value)} autoFocus />
            </label>
            <label className="dp-clients-field">
              <span>E-mail</span>
              <input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} />
            </label>
            <label className="dp-clients-field">
              <span>Telefone</span>
              <input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} />
            </label>
            {formMessage && <p className="dp-clients-form-message" role="alert">{formMessage}</p>}
            <div className="dp-clients-modal-actions">
              <button className="dp-clients-secondary-action" type="button" onClick={closeModal}>Cancelar</button>
              <button className="dp-clients-primary-action" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Salvando...' : 'Salvar cliente'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}

export default ClientsPage
