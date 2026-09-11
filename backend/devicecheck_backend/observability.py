"""Eventos operacionais sem bodies, URLs, identificadores ou texto de exceções."""
from datetime import datetime, timezone
import json
import logging
import re

from django.db import DatabaseError


EVENTS = frozenset({
    'backend_started', 'database_failure', 'diagnostic_saved',
    'diagnostic_rejected', 'payment_failure', 'webhook_rejected',
    'webhook_not_processed', 'request_throttled', 'throttle_cache_failure',
    'google_auth_started', 'google_auth_success', 'google_auth_failed',
})
logger = logging.getLogger('diagpro.operations')
SAFE_ERROR_TYPE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,79}$')


class SafeJsonFormatter(logging.Formatter):
    def format(self, record):
        event = record.msg if isinstance(record.msg, str) and record.msg in EVENTS else 'server_event'
        # Inclui falhas de banco reportadas pelo próprio Django. Nunca usa str(exc).
        if record.exc_info and isinstance(record.exc_info[1], DatabaseError):
            event = 'database_failure'
        result = {
            'timestamp': datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            'level': record.levelname,
            'event': event,
        }
        status = getattr(record, 'status_code', None)
        if type(status) is int and 100 <= status <= 599:
            result['status'] = status
        error_type = getattr(record, 'error_type', None)
        if isinstance(error_type, str) and SAFE_ERROR_TYPE.fullmatch(error_type):
            result['error_type'] = error_type
        return json.dumps(result, ensure_ascii=True)


class OperationalEventsMiddleware:
    """Observa respostas; não altera autenticação, pagamento ou persistência."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        event = None
        if response.status_code == 429:
            event = 'request_throttled'
        elif request.method == 'POST':
            if request.path == '/api/diagnosticos/':
                if response.status_code == 201:
                    event = 'diagnostic_saved'
                elif response.status_code >= 400:
                    event = 'diagnostic_rejected'
            elif request.path == '/api/assinatura/checkout/' and response.status_code >= 400:
                event = 'payment_failure'
            elif request.path == '/api/pagamentos/mercadopago/webhook/':
                if response.status_code >= 400:
                    event = 'webhook_rejected'
                elif isinstance(getattr(response, 'data', None), dict) and response.data.get('processed') is False:
                    event = 'webhook_not_processed'
        if event:
            level = logging.WARNING if response.status_code >= 400 else logging.INFO
            logger.log(level, event, extra={'status_code': response.status_code})
        return response
