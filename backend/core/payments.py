from datetime import timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import hmac
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import Licenca, Pagamento


MERCADO_PAGO_API_URL = 'https://api.mercadopago.com'
PAYMENT_STATUS_MAP = {
    'approved': 'approved',
    'pending': 'pending',
    'in_process': 'pending',
    'authorized': 'pending',
    'rejected': 'rejected',
    'cancelled': 'canceled',
    'canceled': 'canceled',
    'expired': 'canceled',
    'refunded': 'refunded',
    'charged_back': 'charged_back',
}


class PaymentIntegrationError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


class PaymentConfigurationError(PaymentIntegrationError):
    pass


class InvalidWebhookSignature(PaymentIntegrationError):
    pass


class PaymentReconciliationError(PaymentIntegrationError):
    pass


def _setting(name, default=''):
    return getattr(settings, name, default)


def _is_https_url(value):
    if not isinstance(value, str):
        return False
    parsed = urlparse(value or '')
    return parsed.scheme == 'https' and bool(parsed.netloc)


def is_mercado_pago_checkout_url(value):
    if not isinstance(value, str):
        return False
    parsed = urlparse(value or '')
    hostname = (parsed.hostname or '').lower()
    allowed = (
        hostname in {'mercadopago.com', 'mercadopago.com.br'}
        or hostname.endswith('.mercadopago.com')
        or hostname.endswith('.mercadopago.com.br')
    )
    return parsed.scheme == 'https' and allowed


def _checkout_configuration():
    access_token = _setting('MERCADO_PAGO_ACCESS_TOKEN')
    if not access_token:
        raise PaymentConfigurationError(
            'payment_provider_not_configured',
            'O Mercado Pago ainda não está configurado no backend.',
        )

    urls = {
        'success': _setting('MERCADO_PAGO_SUCCESS_URL'),
        'failure': _setting('MERCADO_PAGO_FAILURE_URL'),
        'pending': _setting('MERCADO_PAGO_PENDING_URL'),
        'webhook': _setting('MERCADO_PAGO_WEBHOOK_URL'),
    }
    if any(not _is_https_url(value) for value in urls.values()):
        raise PaymentConfigurationError(
            'payment_return_urls_not_configured',
            'As URLs HTTPS de retorno e webhook do Mercado Pago precisam ser configuradas.',
        )
    return access_token, urls


class MercadoPagoClient:
    def __init__(self, access_token=None):
        self.access_token = access_token or _setting('MERCADO_PAGO_ACCESS_TOKEN')
        self.timeout = int(_setting('MERCADO_PAGO_TIMEOUT_SECONDS', 10))
        if not self.access_token:
            raise PaymentConfigurationError(
                'payment_provider_not_configured',
                'O Mercado Pago ainda não está configurado no backend.',
            )

    def _request(self, method, path, payload=None):
        body = json.dumps(payload).encode('utf-8') if payload is not None else None
        request = Request(
            f'{MERCADO_PAGO_API_URL}{path}',
            data=body,
            method=method,
            headers={
                'Authorization': f'Bearer {self.access_token}',
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode('utf-8'))
        except HTTPError as error:
            raise PaymentIntegrationError(
                'mercado_pago_http_error',
                'O Mercado Pago recusou a solicitação do backend.',
            ) from error
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            raise PaymentIntegrationError(
                'mercado_pago_unavailable',
                'Não foi possível comunicar com o Mercado Pago.',
            ) from error

    def create_preference(self, payload):
        return self._request('POST', '/checkout/preferences', payload)

    def get_payment(self, payment_id):
        return self._request('GET', f'/v1/payments/{payment_id}')


def create_checkout_preference(payment, user, client=None):
    access_token, urls = _checkout_configuration()
    client = client or MercadoPagoClient(access_token)
    payload = {
        'items': [{
            'id': str(payment.plano_id),
            'title': f'DiagPro - {payment.plano.nome}',
            'description': payment.plano.descricao or 'Plano mensal DiagPro',
            'quantity': 1,
            'currency_id': payment.moeda,
            'unit_price': float(payment.valor_esperado),
        }],
        'external_reference': str(payment.external_reference),
        'back_urls': {
            'success': urls['success'],
            'failure': urls['failure'],
            'pending': urls['pending'],
        },
        'notification_url': urls['webhook'],
        'auto_return': 'approved',
        'metadata': {
            'diagpro_payment_id': payment.id,
            'diagpro_plan_id': payment.plano_id,
        },
    }
    if user.email:
        payload['payer'] = {'email': user.email}

    response = client.create_preference(payload)
    if not isinstance(response, dict):
        raise PaymentIntegrationError(
            'invalid_checkout_response',
            'O Mercado Pago não retornou um checkout seguro e válido.',
        )
    preference_id = str(response.get('id') or '')
    url_field = 'sandbox_init_point' if payment.sandbox else 'init_point'
    checkout_url = response.get(url_field) or ''
    if not preference_id or not is_mercado_pago_checkout_url(checkout_url):
        raise PaymentIntegrationError(
            'invalid_checkout_response',
            'O Mercado Pago não retornou um checkout seguro e válido.',
        )
    return preference_id, checkout_url


def validate_webhook_signature(*, x_signature, x_request_id, data_id):
    secret = _setting('MERCADO_PAGO_WEBHOOK_SECRET')
    if not secret:
        raise PaymentConfigurationError(
            'payment_webhook_not_configured',
            'A assinatura secreta do webhook não está configurada.',
        )
    if not x_signature or not x_request_id or not data_id:
        raise InvalidWebhookSignature('invalid_webhook_signature', 'Webhook sem assinatura válida.')

    parts = {}
    for item in x_signature.split(','):
        key, separator, value = item.strip().partition('=')
        if separator:
            parts[key] = value
    timestamp = parts.get('ts')
    received_signature = parts.get('v1')
    if not timestamp or not received_signature:
        raise InvalidWebhookSignature('invalid_webhook_signature', 'Webhook sem assinatura válida.')

    normalized_data_id = str(data_id).lower()
    manifest = f'id:{normalized_data_id};request-id:{x_request_id};ts:{timestamp};'
    expected_signature = hmac.new(
        secret.encode('utf-8'),
        manifest.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_signature, received_signature):
        raise InvalidWebhookSignature('invalid_webhook_signature', 'A assinatura do webhook é inválida.')


def _decimal_amount(value):
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as error:
        raise PaymentReconciliationError('payment_amount_invalid', 'O pagamento não possui valor válido.') from error
    if not amount.is_finite():
        raise PaymentReconciliationError('payment_amount_invalid', 'O pagamento não possui valor válido.')
    return amount


def _approved_at(remote_payment, fallback):
    value = remote_payment.get('date_approved')
    parsed = parse_datetime(value) if isinstance(value, str) else None
    if parsed is None:
        return fallback
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _locked_user_license(user):
    get_user_model().objects.select_for_update().only('pk').get(pk=user.pk)
    license_record = (
        Licenca.objects
        .select_for_update()
        .filter(usuario=user)
        .first()
    )
    if license_record is not None:
        return license_record
    return (
        Licenca.objects
        .select_for_update()
        .filter(usuario__isnull=True, empresa__usuario=user)
        .first()
    )


def _license_duration():
    duration_days = int(_setting('MERCADO_PAGO_LICENSE_DURATION_DAYS', 30))
    if duration_days <= 0:
        raise PaymentConfigurationError(
            'payment_license_duration_invalid',
            'A duração comercial da licença precisa ser maior que zero.',
        )
    return timedelta(days=duration_days)


def _activate_license(payment, now):
    license_record = _locked_user_license(payment.usuario)
    if payment.ativado_em is not None:
        return license_record

    if license_record is None:
        license_record = Licenca(
            usuario=payment.usuario,
            plano=payment.plano,
            status='active',
            fim=now + _license_duration(),
        )
    else:
        if license_record.usuario_id is None:
            license_record.usuario = payment.usuario
        base_date = license_record.fim if license_record.fim and license_record.fim > now else now
        license_record.fim = base_date + _license_duration()
        license_record.plano = payment.plano
        license_record.status = 'active'

    license_record.provider = 'mercadopago'
    license_record.external_subscription_id = payment.external_payment_id or ''
    license_record.renovacao_automatica = False
    license_record.save()
    payment.ativado_em = now
    return license_record


def _set_non_active_license(payment, internal_status, now):
    license_record = _locked_user_license(payment.usuario)
    payment_identifier = payment.external_payment_id or ''
    if (
        license_record is not None
        and license_record.valida
        and license_record.external_subscription_id != payment_identifier
    ):
        return license_record

    if license_record is None:
        license_record = Licenca(
            usuario=payment.usuario,
            fim=now + _license_duration(),
        )
    elif license_record.usuario_id is None:
        license_record.usuario = payment.usuario

    license_record.plano = payment.plano
    license_record.status = internal_status
    license_record.provider = 'mercadopago'
    license_record.external_subscription_id = payment_identifier
    if not license_record.fim or license_record.fim <= now:
        license_record.fim = now + _license_duration()
    license_record.renovacao_automatica = False
    license_record.save()
    return license_record


def _revoke_license_for_payment(payment):
    license_record = _locked_user_license(payment.usuario)
    if (
        license_record is None
        or license_record.provider != 'mercadopago'
        or license_record.external_subscription_id != (payment.external_payment_id or '')
    ):
        return license_record
    license_record.status = 'canceled'
    license_record.save(update_fields=['status', 'atualizado_em'])
    return license_record


def _mark_invalid(payment, code, request_id):
    payment.status = 'invalid'
    payment.erro_codigo = code
    payment.webhook_count += 1
    payment.ultimo_webhook_request_id = request_id
    payment.save(update_fields=[
        'external_payment_id', 'status', 'provider_status', 'provider_status_detail',
        'erro_codigo', 'webhook_count', 'ultimo_webhook_request_id', 'atualizado_em',
    ])


@transaction.atomic
def reconcile_mercado_pago_payment(remote_payment, *, data_id, request_id):
    external_payment_id = str(remote_payment.get('id') or '')
    external_reference = str(remote_payment.get('external_reference') or '')
    if not external_payment_id or external_payment_id != str(data_id):
        raise PaymentReconciliationError('payment_id_mismatch', 'O pagamento consultado não corresponde ao webhook.')

    try:
        payment = (
            Pagamento.objects
            .select_for_update(of=('self',))
            .select_related('usuario', 'plano')
            .get(external_reference=external_reference)
        )
    except Pagamento.DoesNotExist as error:
        raise PaymentReconciliationError(
            'payment_reference_not_found',
            'A referência do pagamento não pertence a uma cobrança do DiagPro.',
        ) from error

    conflicting_payment = (
        Pagamento.objects
        .filter(external_payment_id=external_payment_id)
        .exclude(pk=payment.pk)
        .exists()
    )
    if conflicting_payment:
        _mark_invalid(payment, 'external_payment_conflict', request_id)
        return payment, None, False

    if payment.ativado_em and payment.external_payment_id not in (None, '', external_payment_id):
        payment.webhook_count += 1
        payment.ultimo_webhook_request_id = request_id
        payment.save(update_fields=['webhook_count', 'ultimo_webhook_request_id', 'atualizado_em'])
        return payment, None, False

    payment.external_payment_id = external_payment_id
    payment.provider_status = str(remote_payment.get('status') or '').lower()
    payment.provider_status_detail = str(remote_payment.get('status_detail') or '')[:180]
    remote_live_mode = remote_payment.get('live_mode')
    if not isinstance(remote_live_mode, bool) or remote_live_mode == payment.sandbox:
        _mark_invalid(payment, 'payment_environment_mismatch', request_id)
        return payment, None, False

    try:
        remote_amount = _decimal_amount(remote_payment.get('transaction_amount'))
    except PaymentReconciliationError:
        _mark_invalid(payment, 'payment_amount_invalid', request_id)
        return payment, None, False
    if remote_amount != payment.valor_esperado:
        _mark_invalid(payment, 'payment_amount_mismatch', request_id)
        return payment, None, False

    remote_currency = str(remote_payment.get('currency_id') or '').upper()
    if remote_currency != payment.moeda:
        _mark_invalid(payment, 'payment_currency_mismatch', request_id)
        return payment, None, False

    provider_status = payment.provider_status
    internal_status = PAYMENT_STATUS_MAP.get(provider_status, 'invalid')
    now = timezone.now()
    payment.status = internal_status
    payment.erro_codigo = '' if internal_status != 'invalid' else 'unsupported_payment_status'
    payment.webhook_count += 1
    payment.ultimo_webhook_request_id = request_id
    activated = False
    license_record = None

    if internal_status == 'approved':
        payment.pago_em = _approved_at(remote_payment, now)
        activated = payment.ativado_em is None
        license_record = _activate_license(payment, now)
    elif internal_status == 'pending':
        license_record = _set_non_active_license(payment, 'past_due', now)
    elif internal_status in {'rejected', 'canceled'}:
        license_record = _set_non_active_license(payment, 'canceled', now)
    elif internal_status in {'refunded', 'charged_back'}:
        license_record = _revoke_license_for_payment(payment)

    payment.save()
    return payment, license_record, activated


def process_mercado_pago_webhook(*, data_id, request_id, client=None):
    if not str(data_id).isdigit():
        raise PaymentReconciliationError(
            'payment_id_invalid',
            'O identificador do pagamento recebido é inválido.',
        )
    client = client or MercadoPagoClient()
    remote_payment = client.get_payment(str(data_id))
    if not isinstance(remote_payment, dict):
        raise PaymentIntegrationError(
            'invalid_payment_response',
            'O Mercado Pago retornou dados inválidos para o pagamento.',
        )
    return reconcile_mercado_pago_payment(remote_payment, data_id=str(data_id), request_id=request_id)
