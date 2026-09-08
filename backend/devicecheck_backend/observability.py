"""Eventos operacionais sem bodies, URLs, identificadores ou texto de exceções."""
from datetime import datetime, timezone
import json
import logging

from django.db import DatabaseError


EVENTS = frozenset({
    'backend_started', 'database_failure', 'diagnostic_saved',
    'diagnostic_rejected', 'payment_failure', 'webhook_rejected',
    'webhook_not_processed', 'request_throttled',
})
logger = logging.getLogger('diagpro.operations')


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
