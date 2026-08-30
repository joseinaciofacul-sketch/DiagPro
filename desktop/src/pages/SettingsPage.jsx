import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Building2, CheckCircle2, CircleUserRound, EyeOff, KeyRound,
  Loader2, LogOut, RefreshCw, Save, ScanLine, ShieldCheck, SlidersHorizontal,
  Smartphone, Usb,
} from 'lucide-react'
import {
  changeCurrentPassword, createCurrentCompany, getCurrentUser, listCurrentCompanies,
  updateCurrentCompany, updateCurrentUser,
} from '../services/settings.js'
import { getDefaultScanMode, saveDefaultScanMode } from '../utils/preferences.js'
import './SettingsPage.css'

const TABS = [
  { id: 'account', label: 'Minha conta', icon: CircleUserRound },
  { id: 'company', label: 'Empresa / assistência', icon: Building2 },
  { id: 'diagnostic', label: 'Diagnóstico', icon: ScanLine },
  { id: 'adb', label: 'ADB e dispositivo', icon: Usb },
  { id: 'preferences', label: 'Preferências', icon: SlidersHorizontal },
  { id: 'security', label: 'Segurança e sessão', icon: ShieldCheck },
]

const SCAN_MODES = [
  { id: 'quick', label: 'Rápido', description: 'Aplicativos, segurança, bateria e armazenamento.' },
  { id: 'complete', label: 'Completo', description: 'Executa todos os módulos disponíveis.' },
  { id: 'custom', label: 'Personalizado', description: 'Abre o Scanner com seleção personalizada.' },
]

const EMPTY_COMPANY = { nome: '', cnpj: '', email: '', telefone: '', endereco: '' }
const EMPTY_PASSWORD = { current_password: '', new_password: '', confirm_new_password: '' }

function normalizeList(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  throw new Error('A API retornou um formato inválido.')
}

function formUser(user) {
  return {
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    email: user?.email || '',
  }
}

function formCompany(company) {
  return {
    nome: company?.nome || '',
    cnpj: company?.cnpj || '',
    email: company?.email || '',
    telefone: company?.telefone || '',
    endereco: company?.endereco || '',
  }
}

function errorMessage(error, fallback) {
  if (error?.status === 401) return 'Sua sessão expirou. Entre novamente para continuar.'
  const details = error?.details
  if (details && typeof details === 'object') {
    const value = Object.values(details).flat().find((item) => typeof item === 'string')
    if (value) return value
  }
  return fallback
}

function Feedback({ state }) {
  if (!state?.message) return null
  return <div className={`dp-settings-feedback ${state.type}`} role="status">{state.type === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{state.message}</div>
}

function Field({ label, children, hint }) {
  return <label className="dp-settings-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function deviceStatusLabel(status) {
  return {
    connected: 'Conectado',
    waiting: 'Nenhum dispositivo conectado',
    unauthorized: 'Não autorizado',
    offline: 'Offline',
    multiple: 'Múltiplos dispositivos detectados',
    error: 'Erro na comunicação',
  }[status] || 'Estado não reconhecido'
}

function SettingsPage({ accessToken, onLogout }) {
  const [activeTab, setActiveTab] = useState('account')
  const [loadState, setLoadState] = useState({ status: 'loading', message: '' })
  const [user, setUser] = useState(null)
  const [userForm, setUserForm] = useState(formUser())
  const [company, setCompany] = useState(null)
  const [companyForm, setCompanyForm] = useState(EMPTY_COMPANY)
  const [accountSave, setAccountSave] = useState({ saving: false, type: '', message: '' })
  const [companySave, setCompanySave] = useState({ saving: false, type: '', message: '' })
  const [defaultMode, setDefaultMode] = useState(() => getDefaultScanMode())
  const [preferenceFeedback, setPreferenceFeedback] = useState({ type: '', message: '' })
  const [adbState, setAdbState] = useState({ status: 'idle', data: null, message: '' })
  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD)
  const [passwordState, setPasswordState] = useState({ saving: false, type: '', message: '' })

  const loadSettings = useCallback(async () => {
    setLoadState({ status: 'loading', message: '' })
    try {
      const [currentUser, companiesResponse] = await Promise.all([
        getCurrentUser({ accessToken }),
        listCurrentCompanies({ accessToken }),
      ])
      const companies = normalizeList(companiesResponse)
      const currentCompany = companies[0] || null
      setUser(currentUser)
      setUserForm(formUser(currentUser))
      setCompany(currentCompany)
      setCompanyForm(formCompany(currentCompany))
      setLoadState({ status: 'ready', message: '' })
    } catch (error) {
      setLoadState({
        status: error?.status === 401 ? 'auth-error' : 'error',
        message: errorMessage(error, 'Não foi possível carregar as configurações.'),
      })
    }
  }, [accessToken])

  useEffect(() => { loadSettings() }, [loadSettings])

  async function saveAccount(event) {
    event.preventDefault()
    setAccountSave({ saving: true, type: '', message: '' })
    try {
      const updated = await updateCurrentUser(userForm, { accessToken })
      setUser(updated)
      setUserForm(formUser(updated))
      setAccountSave({ saving: false, type: 'success', message: 'Dados da conta atualizados.' })
    } catch (error) {
      setAccountSave({ saving: false, type: 'error', message: errorMessage(error, 'Não foi possível atualizar a conta.') })
    }
  }

  async function saveCompany(event) {
    event.preventDefault()
    setCompanySave({ saving: true, type: '', message: '' })
    const payload = {
      ...companyForm,
      nome: companyForm.nome.trim(),
      cnpj: companyForm.cnpj.trim() || null,
      email: companyForm.email.trim(),
      telefone: companyForm.telefone.trim(),
      endereco: companyForm.endereco.trim(),
    }
    try {
      const updated = company
        ? await updateCurrentCompany(company.id, payload, { accessToken })
        : await createCurrentCompany(payload, { accessToken })
      setCompany(updated)
      setCompanyForm(formCompany(updated))
      setCompanySave({ saving: false, type: 'success', message: 'Dados da assistência salvos.' })
    } catch (error) {
      setCompanySave({ saving: false, type: 'error', message: errorMessage(error, 'Não foi possível salvar a assistência.') })
    }
  }

  function saveDiagnosticPreference() {
    try {
      saveDefaultScanMode(defaultMode)
      setPreferenceFeedback({ type: 'success', message: 'Modo padrão salvo neste computador.' })
    } catch (error) {
      setPreferenceFeedback({ type: 'error', message: error.message })
    }
  }

  async function checkAdb() {
    setAdbState({ status: 'checking', data: null, message: '' })
    if (typeof window.diagpro?.checkAdb !== 'function') {
      setAdbState({ status: 'error', data: null, message: 'A verificação ADB está disponível somente no aplicativo desktop.' })
      return
    }
    try {
      const result = await window.diagpro.checkAdb()
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível verificar o ADB.')
      setAdbState({ status: 'ready', data: result.data, message: '' })
    } catch (error) {
      setAdbState({ status: 'error', data: null, message: error.message || 'Não foi possível verificar o ADB.' })
    }
  }

  async function changePassword(event) {
    event.preventDefault()
    setPasswordState({ saving: true, type: '', message: '' })
    try {
      await changeCurrentPassword(passwordForm, { accessToken })
      setPasswordForm(EMPTY_PASSWORD)
      setPasswordState({ saving: false, type: 'success', message: 'Senha alterada. Encerrando esta sessão por segurança...' })
      window.setTimeout(() => onLogout?.(), 1000)
    } catch (error) {
      setPasswordState({ saving: false, type: 'error', message: errorMessage(error, 'Não foi possível alterar a senha.') })
    }
  }

  function renderAccount() {
    return <section className="dp-settings-panel" aria-labelledby="settings-account-title"><header><div className="dp-settings-section-icon"><CircleUserRound size={20} /></div><div><h2 id="settings-account-title">Minha conta</h2><p>Dados do usuário autenticado no DiagPro.</p></div></header><form onSubmit={saveAccount}><div className="dp-settings-form-grid"><Field label="Usuário" hint="O nome de usuário não pode ser alterado nesta tela."><input value={user?.username || ''} readOnly /></Field><Field label="Acesso administrativo"><input value={user?.is_staff ? 'Sim' : 'Não'} readOnly /></Field><Field label="Nome"><input maxLength="150" value={userForm.first_name} onChange={(event) => setUserForm((current) => ({ ...current, first_name: event.target.value }))} /></Field><Field label="Sobrenome"><input maxLength="150" value={userForm.last_name} onChange={(event) => setUserForm((current) => ({ ...current, last_name: event.target.value }))} /></Field><Field label="E-mail"><input type="email" maxLength="254" value={userForm.email} onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))} /></Field></div><Feedback state={accountSave} /><div className="dp-settings-actions"><button className="primary" type="submit" disabled={accountSave.saving}>{accountSave.saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}{accountSave.saving ? 'Salvando...' : 'Salvar conta'}</button></div></form></section>
  }

  function renderCompany() {
    return <section className="dp-settings-panel" aria-labelledby="settings-company-title"><header><div className="dp-settings-section-icon"><Building2 size={20} /></div><div><h2 id="settings-company-title">Empresa / assistência</h2><p>{company ? 'Identidade da assistência vinculada à sua conta.' : 'Nenhuma assistência está configurada. Preencha somente os dados reais disponíveis.'}</p></div></header><form onSubmit={saveCompany}><div className="dp-settings-form-grid"><Field label="Nome da assistência"><input required maxLength="150" value={companyForm.nome} onChange={(event) => setCompanyForm((current) => ({ ...current, nome: event.target.value }))} /></Field><Field label="CNPJ" hint="Opcional. Quando informado, deve conter 14 dígitos."><input maxLength="18" value={companyForm.cnpj} onChange={(event) => setCompanyForm((current) => ({ ...current, cnpj: event.target.value }))} /></Field><Field label="E-mail"><input type="email" maxLength="254" value={companyForm.email} onChange={(event) => setCompanyForm((current) => ({ ...current, email: event.target.value }))} /></Field><Field label="Telefone"><input maxLength="20" value={companyForm.telefone} onChange={(event) => setCompanyForm((current) => ({ ...current, telefone: event.target.value }))} /></Field><Field label="Endereço"><input maxLength="255" value={companyForm.endereco} onChange={(event) => setCompanyForm((current) => ({ ...current, endereco: event.target.value }))} /></Field></div><div className="dp-settings-info"><Building2 size={16} /><span>O nome salvo fica disponível no backend para futura identificação da assistência nos relatórios. Nenhum logo ou dado é preenchido automaticamente.</span></div><Feedback state={companySave} /><div className="dp-settings-actions"><button className="primary" type="submit" disabled={companySave.saving}>{companySave.saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}{companySave.saving ? 'Salvando...' : company ? 'Salvar assistência' : 'Cadastrar assistência'}</button></div></form></section>
  }

  function renderDiagnostic() {
    return <section className="dp-settings-panel" aria-labelledby="settings-diagnostic-title"><header><div className="dp-settings-section-icon"><ScanLine size={20} /></div><div><h2 id="settings-diagnostic-title">Diagnóstico</h2><p>Preferência local aplicada quando uma nova tela do Scanner é aberta.</p></div></header><div className="dp-settings-mode-list" role="radiogroup" aria-label="Modo padrão do Scanner">{SCAN_MODES.map((mode) => <label className={defaultMode === mode.id ? 'selected' : ''} key={mode.id}><input type="radio" name="default-scan-mode" value={mode.id} checked={defaultMode === mode.id} onChange={() => { setDefaultMode(mode.id); setPreferenceFeedback({ type: '', message: '' }) }} /><span><strong>{mode.label}</strong><small>{mode.description}</small></span></label>)}</div><Feedback state={preferenceFeedback} /><div className="dp-settings-actions"><button className="primary" type="button" onClick={saveDiagnosticPreference}><Save size={15} /> Salvar modo padrão</button></div></section>
  }

  function renderAdb() {
    const adb = adbState.data?.adb
    const device = adbState.data?.device
    return <section className="dp-settings-panel" aria-labelledby="settings-adb-title"><header><div className="dp-settings-section-icon"><Usb size={20} /></div><div><h2 id="settings-adb-title">ADB e dispositivo</h2><p>Verificação executada pelo mesmo mecanismo usado no diagnóstico.</p></div></header>{adbState.status === 'idle' && <div className="dp-settings-empty"><Usb size={28} /><strong>ADB ainda não verificado</strong><p>Execute a verificação para consultar disponibilidade, versão e dispositivo conectado.</p></div>}{adbState.status === 'checking' && <div className="dp-settings-empty"><Loader2 size={28} className="spin" /><strong>Verificando ADB...</strong><p>Consultando o executável e o estado real dos dispositivos.</p></div>}{adbState.status === 'error' && <div className="dp-settings-empty error"><AlertTriangle size={29} /><strong>Falha na verificação</strong><p>{adbState.message}</p></div>}{adbState.status === 'ready' && <div className="dp-settings-adb-result"><div className="dp-settings-status-grid"><div><span>ADB disponível</span><strong>{adb?.available === true ? 'Sim' : 'Não'}</strong></div><div><span>Versão</span><strong>{adb?.version || 'Não informada'}</strong></div><div><span>Executável utilizado</span><code>{adb?.executable || 'Não informado'}</code></div><div><span>Dispositivo</span><strong>{deviceStatusLabel(device?.status)}</strong></div></div>{device?.status === 'connected' && <div className="dp-settings-device"><Smartphone size={30} /><div><strong>{[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Modelo não informado'}</strong><code>{device.serial}</code><span>{device.androidVersion ? `Android ${device.androidVersion}` : 'Versão Android não informada'}</span></div></div>}{device?.message && <div className="dp-settings-info warning"><AlertTriangle size={16} /><span>{device.message}</span></div>}</div>}<div className="dp-settings-info"><EyeOff size={16} /><span>O caminho é detectado automaticamente pelo DiagPro e não é editável nesta tela.</span></div><div className="dp-settings-actions"><button className="primary" type="button" onClick={checkAdb} disabled={adbState.status === 'checking'}>{adbState.status === 'checking' ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}{adbState.status === 'checking' ? 'Verificando...' : 'Verificar ADB'}</button></div></section>
  }

  function renderPreferences() {
    return <section className="dp-settings-panel" aria-labelledby="settings-preferences-title"><header><div className="dp-settings-section-icon"><SlidersHorizontal size={20} /></div><div><h2 id="settings-preferences-title">Preferências</h2><p>Opções gerais disponíveis nesta instalação.</p></div></header><div className="dp-settings-empty"><SlidersHorizontal size={28} /><strong>Nenhuma preferência visual configurável</strong><p>O DiagPro ainda não possui alternância de tema implementada. O modo padrão do Scanner pode ser configurado na seção Diagnóstico.</p></div></section>
  }

  function renderSecurity() {
    return <section className="dp-settings-panel" aria-labelledby="settings-security-title"><header><div className="dp-settings-section-icon"><KeyRound size={20} /></div><div><h2 id="settings-security-title">Segurança e sessão</h2><p>Altere sua senha ou encerre a sessão neste computador.</p></div></header><form onSubmit={changePassword}><div className="dp-settings-form-grid single"><Field label="Senha atual"><input type="password" autoComplete="current-password" required value={passwordForm.current_password} onChange={(event) => setPasswordForm((current) => ({ ...current, current_password: event.target.value }))} /></Field><Field label="Nova senha"><input type="password" autoComplete="new-password" required value={passwordForm.new_password} onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))} /></Field><Field label="Confirmar nova senha"><input type="password" autoComplete="new-password" required value={passwordForm.confirm_new_password} onChange={(event) => setPasswordForm((current) => ({ ...current, confirm_new_password: event.target.value }))} /></Field></div><div className="dp-settings-info"><ShieldCheck size={16} /><span>A senha é enviada somente ao backend autenticado e processada pelo Django. Após a alteração, esta sessão será encerrada.</span></div><Feedback state={passwordState} /><div className="dp-settings-actions"><button className="primary" type="submit" disabled={passwordState.saving}>{passwordState.saving ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}{passwordState.saving ? 'Alterando...' : 'Alterar senha'}</button></div></form><div className="dp-settings-session"><div><LogOut size={18} /><span><strong>Sessão neste computador</strong><small>Remove os tokens locais e retorna para a tela de acesso.</small></span></div><button type="button" onClick={onLogout}><LogOut size={15} /> Sair da conta</button></div></section>
  }

  const panels = { account: renderAccount, company: renderCompany, diagnostic: renderDiagnostic, adb: renderAdb, preferences: renderPreferences, security: renderSecurity }

  return <section className="dp-settings-page" aria-labelledby="dp-settings-title"><header className="dp-settings-heading"><h1 id="dp-settings-title">Configurações</h1><p>Gerencie sua conta, assistência e preferências reais do DiagPro.</p></header>{loadState.status === 'loading' && <div className="dp-settings-page-state"><Loader2 size={31} className="spin" /><strong>Carregando configurações...</strong><p>Consultando sua conta e assistência no backend.</p></div>}{(loadState.status === 'error' || loadState.status === 'auth-error') && <div className="dp-settings-page-state error"><AlertTriangle size={32} /><strong>{loadState.status === 'auth-error' ? 'Autenticação necessária' : 'Erro ao carregar configurações'}</strong><p>{loadState.message}</p><button type="button" onClick={loadSettings}>Tentar novamente</button></div>}{loadState.status === 'ready' && <div className="dp-settings-layout"><nav className="dp-settings-tabs" aria-label="Seções de configurações">{TABS.map((tab) => { const Icon = tab.icon; return <button className={activeTab === tab.id ? 'active' : ''} type="button" key={tab.id} onClick={() => setActiveTab(tab.id)}><Icon size={17} /><span>{tab.label}</span></button> })}</nav><div className="dp-settings-content">{panels[activeTab]()}</div></div>}</section>
}

export default SettingsPage
