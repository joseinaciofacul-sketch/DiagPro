"""SimpleJWT-compatible views with explicit abuse protection."""
from django.db import DatabaseError
from rest_framework import status
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from devicecheck_backend.observability import logger

from .throttling import LoginAccountRateThrottle, LoginIPRateThrottle, RefreshIPRateThrottle


class ThrottledTokenObtainPairView(TokenObtainPairView):
    throttle_classes = [LoginIPRateThrottle, LoginAccountRateThrottle]

    def post(self, request, *args, **kwargs):
        try:
            return super().post(request, *args, **kwargs)
        except DatabaseError as exc:
            logger.error(
                'database_failure',
                exc_info=True,
                extra={'error_type': type(exc).__name__, 'status_code': 503},
            )
            return Response(
                {'detail': 'Serviço de autenticação temporariamente indisponível.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )


class ThrottledTokenRefreshView(TokenRefreshView):
    throttle_classes = [RefreshIPRateThrottle]
