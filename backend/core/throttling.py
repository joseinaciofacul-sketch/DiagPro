"""Configurable DRF throttles backed by the dedicated throttle cache."""
from hashlib import sha256

from django.conf import settings
from django.core.cache import caches
from rest_framework.throttling import ScopedRateThrottle, SimpleRateThrottle

from devicecheck_backend.observability import logger


def _throttle_cache():
    return caches[settings.DIAGPRO_THROTTLE_CACHE_ALIAS]


class HealthThrottleCacheUnavailable(Exception):
    """Marks a failure raised specifically by a health throttle cache call."""

    def __init__(self, error_type):
        self.error_type = error_type
        super().__init__('health throttle cache unavailable')


class HealthThrottleCache:
    """Narrowly translates cache I/O failures without hiding throttle bugs."""

    def __init__(self, backend):
        self.backend = backend

    def get(self, *args, **kwargs):
        try:
            return self.backend.get(*args, **kwargs)
        except Exception as exc:
            raise HealthThrottleCacheUnavailable(type(exc).__name__) from exc

    def set(self, *args, **kwargs):
        try:
            return self.backend.set(*args, **kwargs)
        except Exception as exc:
            raise HealthThrottleCacheUnavailable(type(exc).__name__) from exc


class DiagProScopedRateThrottle(ScopedRateThrottle):
    """Use an explicit operation scope, then fall back to read or write."""

    def allow_request(self, request, view):
        # CORS preflight and metadata negotiation must not consume operation quota.
        if request.method == 'OPTIONS':
            return True

        scope_resolver = getattr(view, 'get_throttle_scope', None)
        scope = scope_resolver(request) if callable(scope_resolver) else None
        self.scope = scope or getattr(view, self.scope_attr, None)
        if not self.scope:
            self.scope = 'read' if request.method in {'GET', 'HEAD'} else 'write'

        self.cache = _throttle_cache()
        self.THROTTLE_RATES = settings.DIAGPRO_THROTTLE_RATES
        self.rate = self.get_rate()
        self.num_requests, self.duration = self.parse_rate(self.rate)
        return SimpleRateThrottle.allow_request(self, request, view)


class ConfiguredIPRateThrottle(SimpleRateThrottle):
    """Rate limit an unauthenticated surface by the proxy-aware client IP."""

    def __init__(self):
        self.THROTTLE_RATES = settings.DIAGPRO_THROTTLE_RATES
        super().__init__()

    def allow_request(self, request, view):
        if request.method == 'OPTIONS':
            return True
        self.cache = _throttle_cache()
        return super().allow_request(request, view)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class LoginIPRateThrottle(ConfiguredIPRateThrottle):
    scope = 'auth_ip'


class LoginAccountRateThrottle(ConfiguredIPRateThrottle):
    """Add a privacy-preserving account bucket to the login IP bucket."""

    scope = 'auth_account'

    def get_cache_key(self, request, view):
        username = request.data.get('username') if hasattr(request.data, 'get') else None
        if not isinstance(username, str) or not username.strip():
            return None
        digest = sha256(username.strip().casefold().encode('utf-8')).hexdigest()
        return self.cache_format % {'scope': self.scope, 'ident': digest}


class RefreshIPRateThrottle(ConfiguredIPRateThrottle):
    scope = 'refresh'


class WebhookIPRateThrottle(ConfiguredIPRateThrottle):
    scope = 'webhook'


class HealthIPRateThrottle(ConfiguredIPRateThrottle):
    """Fail open only for health probes when the shared cache is unavailable."""

    scope = 'health'

    def allow_request(self, request, view):
        if request.method == 'OPTIONS':
            return True

        self.cache = HealthThrottleCache(_throttle_cache())
        try:
            return SimpleRateThrottle.allow_request(self, request, view)
        except HealthThrottleCacheUnavailable as exc:
            # Readiness must still report database health during a temporary Redis
            # outage. Other endpoints keep the normal cache error behavior.
            logger.warning(
                'throttle_cache_failure',
                exc_info=True,
                extra={'error_type': exc.error_type},
            )
            return True
