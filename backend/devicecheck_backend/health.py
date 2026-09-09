"""Readiness público sem configuração ou identificação interna na resposta."""
from django.conf import settings
from django.db import connection, DatabaseError
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny

from core.throttling import HealthIPRateThrottle
from .observability import logger


@never_cache
@api_view(['GET', 'HEAD'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([HealthIPRateThrottle])
def health(request):
    if settings.DIAGPRO_HEALTHCHECK_DATABASE:
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
                cursor.fetchone()
        except DatabaseError as exc:
            logger.error(
                'database_failure',
                exc_info=True,
                extra={'error_type': type(exc).__name__},
            )
            return JsonResponse({'status': 'unavailable'}, status=503)
    return JsonResponse({'status': 'ok'})
