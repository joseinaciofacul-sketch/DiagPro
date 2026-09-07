"""Readiness público sem configuração ou identificação interna na resposta."""
from django.conf import settings
from django.db import connection, DatabaseError
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe

from .observability import logger


@never_cache
@require_safe
def health(request):
    if settings.DIAGPRO_HEALTHCHECK_DATABASE:
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
                cursor.fetchone()
        except DatabaseError:
            logger.error('database_failure')
            return JsonResponse({'status': 'unavailable'}, status=503)
    return JsonResponse({'status': 'ok'})
