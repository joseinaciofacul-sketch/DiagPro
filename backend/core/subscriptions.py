from django.utils import timezone

from .models import Diagnostico, Licenca


ALLOWED_DIAGNOSTIC_STATUSES = {'active', 'trial'}


def get_user_subscription(user):
    subscription = (
        Licenca.objects
        .filter(usuario=user)
        .select_related('plano')
        .first()
    )
    if subscription is not None:
        return subscription
    return (
        Licenca.objects
        .filter(usuario__isnull=True, empresa__usuario=user)
        .select_related('plano')
        .first()
    )


def current_month_start(at=None):
    current = at or timezone.now()
    return current.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def monthly_diagnostic_usage(user, at=None):
    current = at or timezone.now()
    return Diagnostico.objects.filter(
        usuario=user,
        criado_em__gte=current_month_start(current),
        criado_em__lte=current,
    ).count()


def subscription_usage(user, at=None):
    current = at or timezone.now()
    return {
        'periodo_inicio': current_month_start(current),
        'diagnosticos_mes': monthly_diagnostic_usage(user, current),
        'dispositivos_identificados': (
            Diagnostico.objects
            .filter(usuario=user)
            .exclude(serial='')
            .values('serial')
            .distinct()
            .count()
        ),
        'usuarios': None,
    }


def diagnostic_capability(user, subscription=None, at=None):
    if subscription is None:
        subscription = get_user_subscription(user)
    if subscription is None:
        return {
            'allowed': False,
            'code': 'subscription_required',
            'message': 'É necessário um plano ativo para iniciar novos diagnósticos.',
            'status': None,
            'usage': None,
            'limit': None,
        }

    effective_status = subscription.status_efetivo
    blocked = {
        'expired': ('subscription_expired', 'A assinatura está vencida e não permite novos diagnósticos.'),
        'canceled': ('subscription_canceled', 'A assinatura está cancelada e não permite novos diagnósticos.'),
        'past_due': ('subscription_past_due', 'A assinatura possui pagamento pendente e não permite novos diagnósticos.'),
    }
    if effective_status not in ALLOWED_DIAGNOSTIC_STATUSES:
        code, message = blocked.get(effective_status, (
            'subscription_not_eligible',
            'A assinatura atual não permite iniciar novos diagnósticos.',
        ))
        return {
            'allowed': False,
            'code': code,
            'message': message,
            'status': effective_status,
            'usage': None,
            'limit': subscription.plano.max_diagnosticos_mes if subscription.plano_id else None,
        }

    if subscription.plano_id is None:
        return {
            'allowed': False,
            'code': 'subscription_plan_missing',
            'message': 'A assinatura não possui um plano configurado para novos diagnósticos.',
            'status': effective_status,
            'usage': None,
            'limit': None,
        }

    usage = monthly_diagnostic_usage(user, at)
    limit = subscription.plano.max_diagnosticos_mes
    if limit is not None and usage >= limit:
        return {
            'allowed': False,
            'code': 'monthly_diagnostic_limit_reached',
            'message': 'O limite mensal de diagnósticos do plano foi atingido.',
            'status': effective_status,
            'usage': usage,
            'limit': limit,
        }

    return {
        'allowed': True,
        'code': 'diagnostic_allowed',
        'message': 'A assinatura permite iniciar um novo diagnóstico.',
        'status': effective_status,
        'usage': usage,
        'limit': limit,
    }
