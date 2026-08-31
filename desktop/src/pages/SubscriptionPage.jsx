import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, BadgeCheck, CalendarDays, Check, ClipboardList, CreditCard,
  ExternalLink, Gauge, Loader2, RefreshCw, Smartphone, Users, X,
} from 'lucide-react'
import {
  createSubscriptionCheckout,
  getCurrentSubscription,
  listAvailablePlans,
} from '../services/subscription.js'
import './SubscriptionPage.css'

const STATUS_LABELS = {
  active: 'Ativa',
  trial: 'Período de teste',
  past_due: 'Pagamento pendente',
  canceled: 'Cancelada',
  expired: 'Expirada',
}

const PAYMENT_STATUS = {
  checkout_created: ['Checkout criado', 'Aguardando a conclusão do pagamento no Mercado Pago.', 'pending'],
  pending: ['Pagamento pendente', 'O pagamento ainda não foi aprovado e não libera novos diagnósticos.', 'pending'],
  approved: ['Pagamento confirmado', 'O backend confirmou o pagamento e atualizou a assinatura.', 'approved'],
  rejected: ['Pagamento recusado', 'O Mercado Pago informou que o pagamento foi recusado.', 'rejected'],
  canceled: ['Pagamento cancelado', 'O pagamento foi cancelado e não ativou a assinatura.', 'rejected'],
  refunded: ['Pagamento reembolsado', 'O pagamento foi reembolsado e não mantém a assinatura ativa.', 'rejected'],
  charged_back: ['Pagamento contestado', 'O pagamento foi contestado e a assinatura relacionada foi bloqueada.', 'rejected'],
  invalid: ['Pagamento não conciliado', 'Os dados recebidos não corresponderam à cobrança criada pelo DiagPro.', 'rejected'],
  failed: ['Falha ao iniciar pagamento', 'Não foi possível concluir a comunicação com o provedor.', 'rejected'],
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

function checkoutEligible(plan) {
  const price = Number(plan?.preco_mensal)
  return Number.isFinite(price) && price > 0 && typeof plan?.moeda === 'string' && plan.moeda.length === 3
}

function PlanLimits({ plan }) {
  return <div className="dp-subscription-limits"><div><Users size={16} /><span>Usuários</span><strong>{limitValue(plan.max_usuarios)}</strong></div><div><Smartphone size={16} /><span>Dispositivos</span><strong>{limitValue(plan.max_dispositivos)}</strong></div><div><ClipboardList size={16} /><span>Diagnósticos/mês</span><strong>{limitValue(plan.max_diagnosticos_mes)}</strong></div></div>
}

function PlanResources({ plan }) {
  return <ul className="dp-subscription-resources">{RESOURCE_LABELS.map(([field, label]) => <li className={plan[field] ? 'included' : 'not-included'} key={field}>{plan[field] ? <Check size={14} /> : <X size={14} />}<span>{label}</span><small>{plan[field] ? 'Incluído' : 'Não incluído'}</small></li>)}</ul>
}

function PaymentState({ payment }) {
  if (!payment) return null
  const [title, description, tone] = PAYMENT_STATUS[payment.status] || [
    'Status em processamento',
    'Atualize a página para consultar o estado confirmado pelo backend.',
    'pending',
  ]
  return <section className={`dp-subscription-payment ${tone}`}><div><CreditCard size={19} /><span><strong>{title}</strong><small>{description}</small></span></div><dl><div><dt>Plano</dt><dd>{payment.plano?.nome || 'Não informado'}</dd></div><div><dt>Valor esperado</dt><dd>{formatPrice({ preco_mensal: payment.valor_esperado, moeda: payment.moeda })}</dd></div><div><dt>Última atualização</dt><dd>{formatDate(payment.atualizado_em)}</dd></div><div><dt>Ambiente</dt><dd>{payment.sandbox ? 'Teste / sandbox' : 'Produção'}</dd></div></dl></section>
}

function SubscriptionPage({ accessToken }) {
  const [subscription, setSubscription] = useState(null)
  const [usage, setUsage] = useState(null)
  const [capability, setCapability] = useState(null)
  const [latestPayment, setLatestPayment] = useState(null)
  const [plans, setPlans] = useState([])
  const [loadState, setLoadState] = useState({ status: 'loading', message: '' })
  const [checkoutState, setCheckoutState] = useState({ status: 'idle', planId: null, message: '' })

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
      setLatestPayment(subscriptionResponse?.pagamento_recente || null)
      setPlans(normalizeList(plansResponse))
      setLoadState({ status: 'ready', message: '' })
    } catch (error) {
      setSubscription(null)
      setUsage(null)
      setCapability(null)
      setLatestPayment(null)
      setPlans([])
      setLoadState({
        status: error?.status === 401 ? 'auth-error' : 'error',
        message: error?.status === 401
          ? 'Sua sessão expirou. Entre novamente para consultar sua assinatura.'
          : 'Não foi possível carregar os dados de plano e assinatura.',
      })
    }
  }, [accessToken])

  useEffect(() => { void loadData() }, [loadData])

  async function startCheckout(selectedPlan) {
    if (!checkoutEligible(selectedPlan) || checkoutState.status === 'creating') return
    setCheckoutState({ status: 'creating', planId: selectedPlan.id, message: '' })
    try {
      const checkout = await createSubscriptionCheckout(selectedPlan.id, { accessToken })
      if (!window.diagpro?.openExternalCheckout) {
        throw new Error('A abertura segura do checkout não está disponível neste aplicativo.')
      }
      const opened = await window.diagpro.openExternalCheckout(checkout.checkout_url)
      if (!opened?.ok) throw new Error(opened?.message || 'Não foi possível abrir o checkout externo.')
      setCheckoutState({
        status: 'opened',
        planId: selectedPlan.id,
        message: 'Checkout aberto no navegador. O plano será ativado somente após a confirmação do webhook.',
      })
      await loadData()
    } catch (error) {
      setCheckoutState({
        status: 'error',
        planId: selectedPlan.id,
        message: error?.message || 'Não foi possível iniciar o pagamento.',
      })
    }
  }

  const status = subscription?.status_efetivo
  const plan = subscription?.plano
  const monthLabel = formatMonth(usage?.periodo_inicio)

  return <section className="dp-subscription-page" aria-labelledby="dp-subscription-title">
    <header className="dp-subscription-header"><div><h1 id="dp-subscription-title">Plano e assinatura</h1><p>Consulte sua licença e inicie pagamentos protegidos pelo backend.</p></div><button type="button" onClick={loadData} disabled={loadState.status === 'loading'}><RefreshCw size={16} className={loadState.status === 'loading' ? 'spin' : ''} /> Atualizar</button></header>

    {loadState.status === 'loading' && <div className="dp-subscription-state"><Loader2 size={31} className="spin" /><strong>Carregando assinatura...</strong><p>Consultando os registros reais vinculados à sua conta.</p></div>}
    {(loadState.status === 'error' || loadState.status === 'auth-error') && <div className="dp-subscription-state error"><AlertTriangle size={32} /><strong>{loadState.status === 'auth-error' ? 'Autenticação necessária' : 'Erro ao carregar assinatura'}</strong><p>{loadState.message}</p><button type="button" onClick={loadData}>Tentar novamente</button></div>}

    {loadState.status === 'ready' && <>
      {checkoutState.status === 'opened' && <div className="dp-subscription-checkout-feedback opened"><ExternalLink size={16} /><span>{checkoutState.message}</span></div>}
      {checkoutState.status === 'error' && <div className="dp-subscription-checkout-feedback error"><AlertTriangle size={16} /><span>{checkoutState.message}</span></div>}

      <section className={`dp-subscription-current ${subscription?.valida ? 'valid' : 'invalid'}`}>
        <div className="dp-subscription-card-heading"><div className="dp-subscription-heading-icon"><CreditCard size={20} /></div><div><span>Plano atual</span><h2>{subscription ? plan?.nome || 'Assinatura sem plano configurado' : 'Nenhum plano ativo'}</h2>{subscription && plan?.descricao && <p>{plan.descricao}</p>}{!subscription && <p>Nenhuma assinatura foi atribuída à sua conta. Escolha abaixo um plano com checkout disponível.</p>}</div>{subscription && <span className={`dp-subscription-status status-${status || 'unknown'}`}>{STATUS_LABELS[status] || 'Status não definido'}</span>}</div>
        {subscription && <div className="dp-subscription-meta"><div><BadgeCheck size={17} /><span>Status efetivo</span><strong>{STATUS_LABELS[status] || 'Não definido'}</strong></div><div><CalendarDays size={17} /><span>Início</span><strong>{formatDate(subscription.inicio)}</strong></div><div><CalendarDays size={17} /><span>Vencimento</span><strong>{formatDate(subscription.fim)}</strong></div><div><RefreshCw size={17} /><span>Renovação automática</span><strong>{subscription.renovacao_automatica ? 'Ativa' : 'Inativa'}</strong></div></div>}
        {subscription && !subscription.valida && <div className="dp-subscription-warning"><AlertTriangle size={16} /><span>Esta assinatura não está válida para uso. Status efetivo: {STATUS_LABELS[status] || 'não definido'}.</span></div>}
        {subscription?.valida && capability?.allowed === false && <div className="dp-subscription-warning"><AlertTriangle size={16} /><span>{capability.message}{capability.code === 'monthly_diagnostic_limit_reached' ? ` Uso atual: ${capability.usage} de ${capability.limit}.` : ''}</span></div>}
        {plan && <><PlanLimits plan={plan} /><PlanResources plan={plan} /></>}
      </section>

      <PaymentState payment={latestPayment} />

      {subscription && plan && usage && <section className="dp-subscription-usage"><div className="dp-subscription-section-title"><Gauge size={18} /><div><h2>Uso atual</h2><p>{monthLabel ? `Medições reais de ${monthLabel}.` : 'Medições reais disponíveis.'}</p></div></div><div className="dp-subscription-usage-grid"><div><ClipboardList size={18} /><span>Diagnósticos no mês</span><strong>{usage.diagnosticos_mes}{plan.max_diagnosticos_mes !== null ? ` / ${plan.max_diagnosticos_mes}` : ''}</strong><small>{plan.max_diagnosticos_mes === null ? 'Limite ilimitado' : 'Registros persistidos no mês civil atual'}</small></div><div><Smartphone size={18} /><span>Dispositivos identificados</span><strong>{usage.dispositivos_identificados}{plan.max_dispositivos !== null ? ` / ${plan.max_dispositivos}` : ''}</strong><small>{plan.max_dispositivos === null ? 'Limite ilimitado' : 'Seriais únicos já diagnosticados'}</small></div><div><Users size={18} /><span>Uso de usuários</span><strong>Não mensurado</strong><small>Não existe gestão de membros nesta versão.</small></div></div></section>}

      <section className="dp-subscription-plans"><div className="dp-subscription-section-title"><CreditCard size={18} /><div><h2>Planos disponíveis</h2><p>Preço e moeda são sempre carregados e validados pelo backend.</p></div></div>{plans.length === 0 ? <div className="dp-subscription-plans-empty"><CreditCard size={28} /><strong>Nenhum plano disponível</strong><p>A administração ainda não cadastrou planos ativos.</p></div> : <div className="dp-subscription-plan-grid">{plans.map((availablePlan) => {
        const eligible = checkoutEligible(availablePlan)
        const creating = checkoutState.status === 'creating' && checkoutState.planId === availablePlan.id
        return <article key={availablePlan.id}><header><div><h3>{availablePlan.nome}</h3>{availablePlan.descricao && <p>{availablePlan.descricao}</p>}</div><strong>{formatPrice(availablePlan)}</strong></header><PlanLimits plan={availablePlan} /><PlanResources plan={availablePlan} />{plan?.id === availablePlan.id && <div className="dp-subscription-current-plan"><BadgeCheck size={14} /> Plano atribuído à sua assinatura</div>}<div className="dp-subscription-checkout-action"><button type="button" disabled={!eligible || checkoutState.status === 'creating'} onClick={() => startCheckout(availablePlan)}>{creating ? <Loader2 size={15} className="spin" /> : <ExternalLink size={15} />}{creating ? 'Criando checkout...' : plan?.id === availablePlan.id ? 'Renovar pelo Mercado Pago' : 'Contratar pelo Mercado Pago'}</button>{!eligible && <small>Checkout indisponível: preço ou moeda não configurados.</small>}</div></article>
      })}</div>}</section>
    </>}
  </section>
}

export default SubscriptionPage
