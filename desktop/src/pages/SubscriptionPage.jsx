import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, BadgeCheck, CalendarDays, Check, ClipboardList, CreditCard,
  Gauge, Loader2, RefreshCw, Smartphone, Users, X,
} from 'lucide-react'
import { getCurrentSubscription, listAvailablePlans } from '../services/subscription.js'
import './SubscriptionPage.css'

const STATUS_LABELS = {
  active: 'Ativa',
  trial: 'Período de teste',
  past_due: 'Pagamento pendente',
  canceled: 'Cancelada',
  expired: 'Expirada',
}

const RESOURCE_LABELS = [
  ['scanner_completo', 'Scanner completo'],
  ['remediacao', 'Remediação'],
  ['relatorios', 'Relatórios'],
  ['visao_gerencial', 'Visão gerencial'],
]

function normalizeList(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  throw new Error('A API retornou um formato inválido para os planos.')
}

function formatDate(value) {
  if (!value) return 'Não informado'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Data inválida' : date.toLocaleString('pt-BR')
}

function formatMonth(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function formatPrice(plan) {
  if (plan?.preco_mensal === null || plan?.preco_mensal === undefined || plan?.preco_mensal === '') {
    return 'Preço sob consulta'
  }
  const amount = Number(plan.preco_mensal)
  if (!Number.isFinite(amount)) return 'Preço não disponível'
  if (!plan.moeda) return `${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} — moeda não informada`
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: plan.moeda }).format(amount)
  } catch {
    return `${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${plan.moeda}`
  }
}

function limitValue(value) {
  return value === null || value === undefined ? 'Ilimitado' : value
}

function PlanLimits({ plan }) {
  return <div className="dp-subscription-limits"><div><Users size={16} /><span>Usuários</span><strong>{limitValue(plan.max_usuarios)}</strong></div><div><Smartphone size={16} /><span>Dispositivos</span><strong>{limitValue(plan.max_dispositivos)}</strong></div><div><ClipboardList size={16} /><span>Diagnósticos/mês</span><strong>{limitValue(plan.max_diagnosticos_mes)}</strong></div></div>
}

function PlanResources({ plan }) {
  return <ul className="dp-subscription-resources">{RESOURCE_LABELS.map(([field, label]) => <li className={plan[field] ? 'included' : 'not-included'} key={field}>{plan[field] ? <Check size={14} /> : <X size={14} />}<span>{label}</span><small>{plan[field] ? 'Incluído' : 'Não incluído'}</small></li>)}</ul>
}

function SubscriptionPage({ accessToken }) {
  const [subscription, setSubscription] = useState(null)
  const [usage, setUsage] = useState(null)
  const [capability, setCapability] = useState(null)
  const [plans, setPlans] = useState([])
  const [loadState, setLoadState] = useState({ status: 'loading', message: '' })

  const loadData = useCallback(async () => {
    setLoadState({ status: 'loading', message: '' })
    try {
      const [subscriptionResponse, plansResponse] = await Promise.all([
        getCurrentSubscription({ accessToken }),
        listAvailablePlans({ accessToken }),
      ])
      setSubscription(subscriptionResponse?.assinatura || null)
      setUsage(subscriptionResponse?.uso || null)
      setCapability(subscriptionResponse?.capacidade_diagnostico || null)
      setPlans(normalizeList(plansResponse))
      setLoadState({ status: 'ready', message: '' })
    } catch (error) {
      setSubscription(null)
      setUsage(null)
      setCapability(null)
      setPlans([])
      setLoadState({
        status: error?.status === 401 ? 'auth-error' : 'error',
        message: error?.status === 401
          ? 'Sua sessão expirou. Entre novamente para consultar sua assinatura.'
          : 'Não foi possível carregar os dados de plano e assinatura.',
      })
    }
  }, [accessToken])

  useEffect(() => { loadData() }, [loadData])

  const status = subscription?.status_efetivo
  const plan = subscription?.plano
  const monthLabel = formatMonth(usage?.periodo_inicio)

  return <section className="dp-subscription-page" aria-labelledby="dp-subscription-title"><header className="dp-subscription-header"><div><h1 id="dp-subscription-title">Plano e assinatura</h1><p>Consulte a licença atribuída à sua conta e os planos cadastrados.</p></div><button type="button" onClick={loadData} disabled={loadState.status === 'loading'}><RefreshCw size={16} className={loadState.status === 'loading' ? 'spin' : ''} /> Atualizar</button></header>{loadState.status === 'loading' && <div className="dp-subscription-state"><Loader2 size={31} className="spin" /><strong>Carregando assinatura...</strong><p>Consultando os registros reais vinculados à sua conta.</p></div>}{(loadState.status === 'error' || loadState.status === 'auth-error') && <div className="dp-subscription-state error"><AlertTriangle size={32} /><strong>{loadState.status === 'auth-error' ? 'Autenticação necessária' : 'Erro ao carregar assinatura'}</strong><p>{loadState.message}</p><button type="button" onClick={loadData}>Tentar novamente</button></div>}{loadState.status === 'ready' && <><section className={`dp-subscription-current ${subscription?.valida ? 'valid' : 'invalid'}`}><div className="dp-subscription-card-heading"><div className="dp-subscription-heading-icon"><CreditCard size={20} /></div><div><span>Plano atual</span><h2>{subscription ? plan?.nome || 'Assinatura sem plano configurado' : 'Nenhum plano ativo'}</h2>{subscription && plan?.descricao && <p>{plan.descricao}</p>}{!subscription && <p>Nenhuma assinatura foi atribuída à sua conta. A atribuição pode ser feita pela administração do DiagPro.</p>}</div>{subscription && <span className={`dp-subscription-status status-${status || 'unknown'}`}>{STATUS_LABELS[status] || 'Status não definido'}</span>}</div>{subscription && <div className="dp-subscription-meta"><div><BadgeCheck size={17} /><span>Status efetivo</span><strong>{STATUS_LABELS[status] || 'Não definido'}</strong></div><div><CalendarDays size={17} /><span>Início</span><strong>{formatDate(subscription.inicio)}</strong></div><div><CalendarDays size={17} /><span>Vencimento</span><strong>{formatDate(subscription.fim)}</strong></div><div><RefreshCw size={17} /><span>Renovação automática</span><strong>{subscription.renovacao_automatica ? 'Ativa' : 'Inativa'}</strong></div></div>}{subscription && !subscription.valida && <div className="dp-subscription-warning"><AlertTriangle size={16} /><span>Esta assinatura não está válida para uso. Status efetivo: {STATUS_LABELS[status] || 'não definido'}.</span></div>}{subscription?.valida && capability?.allowed === false && <div className="dp-subscription-warning"><AlertTriangle size={16} /><span>{capability.message}{capability.code === 'monthly_diagnostic_limit_reached' ? ` Uso atual: ${capability.usage} de ${capability.limit}.` : ''}</span></div>}{plan && <><PlanLimits plan={plan} /><PlanResources plan={plan} /></>}</section>{subscription && plan && usage && <section className="dp-subscription-usage"><div className="dp-subscription-section-title"><Gauge size={18} /><div><h2>Uso atual</h2><p>{monthLabel ? `Medições reais de ${monthLabel}.` : 'Medições reais disponíveis.'}</p></div></div><div className="dp-subscription-usage-grid"><div><ClipboardList size={18} /><span>Diagnósticos no mês</span><strong>{usage.diagnosticos_mes}{plan.max_diagnosticos_mes !== null ? ` / ${plan.max_diagnosticos_mes}` : ''}</strong><small>{plan.max_diagnosticos_mes === null ? 'Limite ilimitado' : 'Registros persistidos no mês civil atual'}</small></div><div><Smartphone size={18} /><span>Dispositivos identificados</span><strong>{usage.dispositivos_identificados}{plan.max_dispositivos !== null ? ` / ${plan.max_dispositivos}` : ''}</strong><small>{plan.max_dispositivos === null ? 'Limite ilimitado' : 'Seriais únicos já diagnosticados'}</small></div><div><Users size={18} /><span>Uso de usuários</span><strong>Não mensurado</strong><small>Não existe gestão de membros nesta versão.</small></div></div></section>}<section className="dp-subscription-plans"><div className="dp-subscription-section-title"><CreditCard size={18} /><div><h2>Planos disponíveis</h2><p>Planos ativos cadastrados pela administração. A troca automática ainda não está disponível.</p></div></div>{plans.length === 0 ? <div className="dp-subscription-plans-empty"><CreditCard size={28} /><strong>Nenhum plano disponível</strong><p>A administração ainda não cadastrou planos ativos.</p></div> : <div className="dp-subscription-plan-grid">{plans.map((availablePlan) => <article key={availablePlan.id}><header><div><h3>{availablePlan.nome}</h3>{availablePlan.descricao && <p>{availablePlan.descricao}</p>}</div><strong>{formatPrice(availablePlan)}</strong></header><PlanLimits plan={availablePlan} /><PlanResources plan={availablePlan} />{plan?.id === availablePlan.id && <div className="dp-subscription-current-plan"><BadgeCheck size={14} /> Plano atribuído à sua assinatura</div>}</article>)}</div>}</section></>}</section>
}

export default SubscriptionPage
