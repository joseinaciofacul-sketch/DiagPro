import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ChevronRight, Clock3, Edit3, Loader2, Mail, Phone,
  Plus, RefreshCw, Search, Smartphone, UserPlus, Users, X,
} from 'lucide-react'
import { criarCliente, editarCliente, listarClientes, obterCliente } from '../services/clients.js'
import './ClientsPage.css'

const EMPTY_VALUE = '--'
const MODE_LABELS = { quick: 'Rápida', complete: 'Completa', custom: 'Personalizada' }
const EMPTY_FORM = { nome: '', telefone: '', email: '', documento: '', observacoes: '' }

function showValue(value) {
  return value === null || value === undefined || value === '' ? EMPTY_VALUE : String(value)
}

function formatDate(value) {
  if (!value) return EMPTY_VALUE
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? EMPTY_VALUE : date.toLocaleString('pt-BR')
}

function normalizeList(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  throw new Error('Formato de clientes inválido.')
}

function ClientsPage({ accessToken }) {
  const [clients, setClients] = useState([])
  const [listState, setListState] = useState({ status: 'loading', message: '' })
  const [query, setQuery] = useState('')
  const [formModal, setFormModal] = useState({ open: false, mode: 'create', clientId: null })
  const [form, setForm] = useState(EMPTY_FORM)
  const [formState, setFormState] = useState({ saving: false, message: '' })
  const [detail, setDetail] = useState({ status: 'closed', data: null, message: '' })

  const loadClients = useCallback(async () => {
    setListState({ status: 'loading', message: '' })
    try {
      const data = normalizeList(await listarClientes({ accessToken }))
      setClients(data)
      setListState({ status: 'ready', message: '' })
    } catch (error) {
      setListState({
        status: error?.status === 401 ? 'auth-error' : 'error',
        message: error?.status === 401
          ? 'Sua sessão expirou. Entre novamente para consultar os clientes.'
          : 'Não foi possível carregar os clientes.',
      })
    }
  }, [accessToken])

  useEffect(() => { loadClients() }, [loadClients])

  const filteredClients = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('pt-BR')
    if (!search) return clients
    return clients.filter((client) => [client.nome, client.telefone, client.email, client.documento]
      .filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(search))
  }, [clients, query])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setFormState({ saving: false, message: '' })
    setFormModal({ open: true, mode: 'create', clientId: null })
  }

  const openEdit = (client) => {
    setForm({
      nome: client.nome || '', telefone: client.telefone || '', email: client.email || '',
      documento: client.documento || '', observacoes: client.observacoes || '',
    })
    setFormState({ saving: false, message: '' })
    setFormModal({ open: true, mode: 'edit', clientId: client.id })
  }

  const closeForm = () => {
    if (formState.saving) return
    setFormModal({ open: false, mode: 'create', clientId: null })
  }

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFormState((current) => ({ ...current, message: '' }))
  }

  const submitForm = async (event) => {
    event.preventDefault()
    if (!form.nome.trim()) {
      setFormState({ saving: false, message: 'Informe o nome do cliente.' })
      return
    }

    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]))
    setFormState({ saving: true, message: '' })
    try {
      const saved = formModal.mode === 'create'
        ? await criarCliente(payload, { accessToken })
        : await editarCliente(formModal.clientId, payload, { accessToken })
      setFormModal({ open: false, mode: 'create', clientId: null })
      await loadClients()
      if (detail.data?.id === saved.id) setDetail({ status: 'ready', data: saved, message: '' })
    } catch (error) {
      setFormState({
        saving: false,
        message: error?.status === 401
          ? 'Sua sessão expirou. Entre novamente para salvar.'
          : 'Não foi possível salvar o cliente. Revise os dados e tente novamente.',
      })
    }
  }

  const openDetail = useCallback(async (id) => {
    setDetail({ status: 'loading', data: null, message: '' })
    try {
      setDetail({ status: 'ready', data: await obterCliente(id, { accessToken }), message: '' })
    } catch (error) {
      setDetail({
        status: 'error',
        data: null,
        message: error?.status === 401
          ? 'Sua sessão expirou. Entre novamente para consultar este cliente.'
          : error?.status === 404 ? 'Este cliente não está disponível.' : 'Não foi possível carregar o cliente.',
      })
    }
  }, [accessToken])

  const closeDetail = () => setDetail({ status: 'closed', data: null, message: '' })
  const selected = detail.data

  return (
    <section className="dp-clients-page" aria-labelledby="dp-clients-title">
      <header className="dp-clients-header">
        <div><h1 id="dp-clients-title">Clientes</h1><p>Organize clientes e consulte o histórico real de atendimentos.</p></div>
        <div className="dp-clients-header-actions">
          <button className="dp-clients-refresh" type="button" onClick={loadClients} disabled={listState.status === 'loading'}><RefreshCw size={16} className={listState.status === 'loading' ? 'spin' : ''} /> Atualizar</button>
          <button className="dp-clients-primary-action" type="button" onClick={openCreate}><UserPlus size={17} /> Novo cliente</button>
        </div>
      </header>

      {listState.status === 'ready' && clients.length > 0 && <label className="dp-clients-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, telefone, e-mail ou documento" /></label>}

      <div className="dp-clients-card">
        <div className="dp-clients-card-heading"><div><h2>Base de clientes</h2>{listState.status === 'ready' && clients.length > 0 && <p>{filteredClients.length} cliente{filteredClients.length === 1 ? '' : 's'} exibido{filteredClients.length === 1 ? '' : 's'}</p>}</div></div>

        {listState.status === 'loading' && <div className="dp-clients-state"><Loader2 size={29} className="spin" /><strong>Carregando clientes...</strong></div>}
        {(listState.status === 'error' || listState.status === 'auth-error') && <div className="dp-clients-state error"><AlertTriangle size={31} /><strong>{listState.status === 'auth-error' ? 'Autenticação necessária' : 'Erro ao carregar clientes'}</strong><p>{listState.message}</p><button onClick={loadClients}>Tentar novamente</button></div>}
        {listState.status === 'ready' && clients.length === 0 && <div className="dp-clients-state"><Users size={36} /><strong>Nenhum cliente cadastrado</strong><p>Cadastre um cliente para começar a organizar os atendimentos.</p><button className="primary" onClick={openCreate}><Plus size={15} /> Novo cliente</button></div>}
        {listState.status === 'ready' && clients.length > 0 && filteredClients.length === 0 && <div className="dp-clients-state"><Search size={34} /><strong>Nenhum cliente encontrado</strong><p>Ajuste a busca para consultar outros registros.</p></div>}

        {listState.status === 'ready' && filteredClients.length > 0 && <div className="dp-clients-list">{filteredClients.map((client) => (
          <button className="dp-clients-item" type="button" key={client.id} onClick={() => openDetail(client.id)}>
            <div className="dp-clients-avatar">{client.nome?.charAt(0)?.toLocaleUpperCase('pt-BR') || '?'}</div>
            <div className="dp-clients-item-main"><strong>{client.nome}</strong><span>{client.telefone || 'Telefone não informado'}</span><small>{client.email || 'E-mail não informado'}</small></div>
            <div className="dp-clients-item-value"><span>Diagnósticos</span><strong>{showValue(client.diagnosticos_count)}</strong></div>
            <div className="dp-clients-item-value"><span>Último atendimento</span><strong>{formatDate(client.ultimo_atendimento)}</strong></div>
            <ChevronRight size={18} />
          </button>
        ))}</div>}
      </div>

      {formModal.open && <div className="dp-clients-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm() }}>
        <form className="dp-clients-form-modal" onSubmit={submitForm} role="dialog" aria-modal="true" aria-labelledby="dp-client-form-title">
          <button className="dp-clients-modal-close" type="button" onClick={closeForm} disabled={formState.saving} aria-label="Fechar"><X size={19} /></button>
          <h2 id="dp-client-form-title">{formModal.mode === 'create' ? 'Novo cliente' : 'Editar cliente'}</h2>
          <p>Preencha somente os dados reais disponíveis.</p>
          <div className="dp-clients-form-grid">
            <label><span>Nome *</span><input value={form.nome} onChange={(event) => updateField('nome', event.target.value)} autoFocus /></label>
            <label><span>Telefone</span><input value={form.telefone} onChange={(event) => updateField('telefone', event.target.value)} /></label>
            <label><span>E-mail</span><input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} /></label>
            <label><span>Documento</span><input value={form.documento} onChange={(event) => updateField('documento', event.target.value)} /></label>
            <label className="wide"><span>Observações</span><textarea value={form.observacoes} onChange={(event) => updateField('observacoes', event.target.value)} rows="3" /></label>
          </div>
          {formState.message && <p className="dp-clients-form-error" role="alert">{formState.message}</p>}
          <div className="dp-clients-modal-actions"><button className="dp-clients-secondary-action" type="button" onClick={closeForm} disabled={formState.saving}>Cancelar</button><button className="dp-clients-primary-action" type="submit" disabled={formState.saving}>{formState.saving ? <Loader2 size={15} className="spin" /> : null}{formState.saving ? 'Salvando...' : 'Salvar cliente'}</button></div>
        </form>
      </div>}

      {detail.status !== 'closed' && <div className="dp-clients-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail() }}>
        <section className="dp-client-detail-modal" role="dialog" aria-modal="true" aria-labelledby="dp-client-detail-title">
          <header><div className="dp-clients-avatar large">{selected?.nome?.charAt(0)?.toLocaleUpperCase('pt-BR') || '?'}</div><div><h2 id="dp-client-detail-title">{selected?.nome || 'Detalhes do cliente'}</h2><p>{selected ? `${selected.diagnosticos_count ?? 0} diagnóstico${selected.diagnosticos_count === 1 ? '' : 's'}` : 'Consultando cadastro...'}</p></div><button onClick={closeDetail} aria-label="Fechar"><X size={20} /></button></header>
          {detail.status === 'loading' && <div className="dp-client-detail-state"><Loader2 size={28} className="spin" /> Carregando cliente...</div>}
          {detail.status === 'error' && <div className="dp-client-detail-state error"><AlertTriangle size={28} /><strong>Cliente indisponível</strong><p>{detail.message}</p></div>}
          {detail.status === 'ready' && selected && <div className="dp-client-detail-content">
            <section><div className="dp-client-section-title"><h3>Dados</h3><button onClick={() => openEdit(selected)}><Edit3 size={14} /> Editar</button></div><div className="dp-client-data-grid"><div><span>Nome</span><strong>{showValue(selected.nome)}</strong></div><div><span>Telefone</span><strong>{showValue(selected.telefone)}</strong></div><div><span>E-mail</span><strong>{showValue(selected.email)}</strong></div><div><span>Documento</span><strong>{showValue(selected.documento)}</strong></div><div className="wide"><span>Observações</span><strong>{showValue(selected.observacoes)}</strong></div></div></section>
            <section><div className="dp-client-section-title"><h3>Histórico</h3></div>{Array.isArray(selected.diagnosticos) && selected.diagnosticos.length > 0 ? <div className="dp-client-history">{selected.diagnosticos.map((diagnostic) => <div key={diagnostic.id}><Clock3 size={16} /><div><strong>Diagnóstico #{diagnostic.id}</strong><span>{[diagnostic.fabricante, diagnostic.modelo].filter(Boolean).join(' ') || 'Dispositivo não informado'} · {diagnostic.serial || EMPTY_VALUE}</span></div><div><span>{formatDate(diagnostic.finalizado_em)}</span><small>{MODE_LABELS[diagnostic.modo] || showValue(diagnostic.modo)} · Health Score: {diagnostic.health_available === true && diagnostic.health_score != null ? `${diagnostic.health_score}/100` : EMPTY_VALUE}</small></div></div>)}</div> : <p className="dp-client-no-history">Este cliente ainda não possui diagnósticos vinculados.</p>}</section>
          </div>}
        </section>
      </div>}
    </section>
  )
}

export default ClientsPage
