"""Public OAuth endpoints; possession secrets bind completion to the desktop flow."""
import re
import secrets
import uuid
import time
import math
from urllib.parse import urlencode

from django.conf import settings
from django.core.cache import caches
from django.http import HttpResponse
from django.db import DatabaseError
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from devicecheck_backend.observability import logger

from .google_oauth import (
    GOOGLE_AUTHORIZATION_ENDPOINT,
    GoogleAccountDisabled,
    GoogleAccountLinkRequired,
    GoogleEmailUnverified,
    GoogleOAuthError,
    GoogleOAuthUnavailable,
    exchange_and_verify_google_code,
    pkce_challenge,
    resolve_google_user,
    token_hash,
    token_urlsafe,
)
from .throttling import ProtectedLoginRateThrottle, _is_known_cache_failure


FLOW_ID = re.compile(r'^[0-9a-f]{32}$')


class GoogleOAuthStartThrottle(ProtectedLoginRateThrottle):
    scope = 'google_oauth_start'


class GoogleOAuthCallbackThrottle(ProtectedLoginRateThrottle):
    scope = 'google_oauth_callback'


class GoogleOAuthCompleteThrottle(ProtectedLoginRateThrottle):
    scope = 'google_oauth_complete'


def oauth_cache():
    return caches[settings.DIAGPRO_OAUTH_CACHE_ALIAS]


def flow_key(flow_id):
    return f'google-oauth-flow:{flow_id}'


def used_key(flow_id):
    return f'google-oauth-used:{flow_id}'


def safe_cache(operation, *args, **kwargs):
    try:
        return getattr(oauth_cache(), operation)(*args, **kwargs)
    except Exception as exc:
        if not _is_known_cache_failure(exc):
            raise
        logger.warning(
            'google_auth_failed',
            extra={'error_type': type(exc).__name__, 'status_code': 503},
        )
        raise GoogleOAuthUnavailable from None


def oauth_configured():
    return all((
        settings.GOOGLE_CLIENT_ID,
        settings.GOOGLE_CLIENT_SECRET,
        settings.GOOGLE_OAUTH_REDIRECT_URI,
    ))


def oauth_error(code, message, http_status):
    response = Response({'code': code, 'detail': message}, status=http_status)
    response['Cache-Control'] = 'no-store'
    return response


class GoogleOAuthStartView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [GoogleOAuthStartThrottle]

    def post(self, request):
        if not oauth_configured():
            return oauth_error(
                'google_not_configured',
                'Login com Google ainda não está disponível.',
                status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        flow_id = uuid.uuid4().hex
        state = f'{flow_id}.{token_urlsafe(32)}'
        nonce = token_urlsafe(32)
        poll_token = token_urlsafe(32)
        verifier = token_urlsafe(64)
        flow = {
            'state_hash': token_hash(state),
            'nonce': nonce,
            'poll_token_hash': token_hash(poll_token),
            'code_challenge': pkce_challenge(verifier),
            'status': 'pending',
            'expires_at': time.time() + settings.GOOGLE_OAUTH_FLOW_TTL_SECONDS,
        }
        try:
            safe_cache('set', flow_key(flow_id), flow, timeout=settings.GOOGLE_OAUTH_FLOW_TTL_SECONDS)
        except GoogleOAuthUnavailable:
            return oauth_error(
                'auth_temporarily_unavailable',
                'Serviço de autenticação temporariamente indisponível.',
                status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        query = urlencode({
            'client_id': settings.GOOGLE_CLIENT_ID,
            'redirect_uri': settings.GOOGLE_OAUTH_REDIRECT_URI,
            'response_type': 'code',
            'scope': 'openid email profile',
            'state': state,
            'nonce': nonce,
            'code_challenge': flow['code_challenge'],
            'code_challenge_method': 'S256',
            'prompt': 'select_account',
        })
        logger.info('google_auth_started')
        response = Response({
            'authorizationUrl': f'{GOOGLE_AUTHORIZATION_ENDPOINT}?{query}',
            'flowId': flow_id,
            'pollToken': poll_token,
            'codeVerifier': verifier,
            'expiresIn': settings.GOOGLE_OAUTH_FLOW_TTL_SECONDS,
        })
        response['Cache-Control'] = 'no-store'
        return response


class GoogleOAuthCallbackView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [GoogleOAuthCallbackThrottle]

    def get(self, request):
        state_value = request.query_params.get('state', '')
        flow_id = state_value.partition('.')[0]
        if not FLOW_ID.fullmatch(flow_id):
            return self.callback_page('Não foi possível validar esta autenticação.', 400)

        try:
            flow = safe_cache('get', flow_key(flow_id))
        except GoogleOAuthUnavailable:
            return self.callback_page('Serviço temporariamente indisponível. Tente novamente.', 503)
        if not flow or flow.get('expires_at', 0) <= time.time():
            return self.callback_page('Esta solicitação expirou. Volte ao DiagPro e tente novamente.', 410)
        if flow.get('status') != 'pending':
            return self.callback_page('Esta solicitação já foi utilizada.', 409)
        if not secrets.compare_digest(flow.get('state_hash', ''), token_hash(state_value)):
            logger.warning('google_auth_failed', extra={'error_type': 'InvalidState', 'status_code': 400})
            return self.callback_page('Não foi possível validar esta autenticação.', 400)

        try:
            # An atomic claim prevents concurrent callbacks from replacing the code.
            if not safe_cache('add', f'google-oauth-callback:{flow_id}', True,
                              timeout=settings.GOOGLE_OAUTH_FLOW_TTL_SECONDS + 60):
                return self.callback_page('Esta solicitação já foi utilizada.', 409)
        except GoogleOAuthUnavailable:
            return self.callback_page('Serviço temporariamente indisponível. Tente novamente.', 503)

        provider_error = request.query_params.get('error')
        code = request.query_params.get('code')
        if provider_error:
            flow.update({'status': 'canceled'})
        elif isinstance(code, str) and code:
            flow.update({'status': 'callback_received', 'authorization_code': code})
        else:
            flow.update({'status': 'failed'})
        try:
            remaining = math.ceil(flow['expires_at'] - time.time())
            if remaining <= 0:
                return self.callback_page('Esta solicitação expirou.', 410)
            safe_cache('set', flow_key(flow_id), flow, timeout=remaining)
        except GoogleOAuthUnavailable:
            return self.callback_page('Serviço temporariamente indisponível. Tente novamente.', 503)

        if provider_error:
            return self.callback_page('Login cancelado. Você pode fechar esta janela.', 200)
        if not code:
            return self.callback_page('O Google não concluiu a autenticação.', 400)
        return self.callback_page('Resposta recebida. Volte ao DiagPro para concluir a autenticação.', 200)

    @staticmethod
    def callback_page(message, status_code):
        escaped = (
            message.replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;')
        )
        response = HttpResponse(
            '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'
            '<title>DiagPro</title><style>body{font-family:Segoe UI,sans-serif;background:#09111f;color:#e5eef8;'
            'display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:520px;padding:32px;'
            'border:1px solid #29415e;border-radius:14px;background:#101c2c}p{color:#a8bdd2}</style>'
            f'</head><body><main><h1>DiagPro</h1><p>{escaped}</p></main></body></html>',
            status=status_code,
            content_type='text/html; charset=utf-8',
        )
        response['Cache-Control'] = 'no-store'
        response['Referrer-Policy'] = 'no-referrer'
        response['X-Frame-Options'] = 'DENY'
        return response


class GoogleOAuthCompleteView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [GoogleOAuthCompleteThrottle]

    def post(self, request):
        if not isinstance(request.data, dict):
            return oauth_error('invalid_request', 'Solicitação de autenticação inválida.', 400)
        flow_id = request.data.get('flowId')
        poll_token = request.data.get('pollToken')
        verifier = request.data.get('codeVerifier')
        if not isinstance(flow_id, str) or not FLOW_ID.fullmatch(flow_id):
            return oauth_error('invalid_request', 'Solicitação de autenticação inválida.', 400)
        if not all(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{43,128}', value) for value in (poll_token, verifier)):
            return oauth_error('invalid_request', 'Solicitação de autenticação inválida.', 400)

        try:
            if safe_cache('get', used_key(flow_id)):
                return oauth_error('flow_already_used', 'Esta autenticação já foi utilizada.', 409)
            flow = safe_cache('get', flow_key(flow_id))
        except GoogleOAuthUnavailable:
            return oauth_error('auth_temporarily_unavailable', 'Serviço de autenticação temporariamente indisponível.', 503)
        if not flow or flow.get('expires_at', 0) <= time.time():
            return oauth_error('flow_expired', 'O tempo para entrar com Google expirou.', 410)
        if not secrets.compare_digest(flow.get('poll_token_hash', ''), token_hash(poll_token)):
            return oauth_error('invalid_request', 'Solicitação de autenticação inválida.', 400)
        if not secrets.compare_digest(flow.get('code_challenge', ''), pkce_challenge(verifier)):
            return oauth_error('invalid_request', 'Solicitação de autenticação inválida.', 400)
        if flow.get('status') == 'pending':
            return Response({'status': 'pending'}, status=status.HTTP_202_ACCEPTED)
        if flow.get('status') == 'canceled':
            try:
                safe_cache('delete', flow_key(flow_id))
            except GoogleOAuthUnavailable:
                return oauth_error('auth_temporarily_unavailable', 'Serviço de autenticação temporariamente indisponível.', 503)
            return oauth_error('login_canceled', 'Login com Google cancelado.', 400)
        if flow.get('status') != 'callback_received' or not flow.get('authorization_code'):
            try:
                safe_cache('delete', flow_key(flow_id))
            except GoogleOAuthUnavailable:
                return oauth_error('auth_temporarily_unavailable', 'Serviço de autenticação temporariamente indisponível.', 503)
            return oauth_error('google_auth_failed', 'Não foi possível concluir o login com Google.', 400)

        lock_key = f'google-oauth-finalize:{flow_id}'
        lock_acquired = False
        try:
            lock_acquired = safe_cache('add', lock_key, True, timeout=settings.GOOGLE_OAUTH_FLOW_TTL_SECONDS + 60)
            if not lock_acquired:
                return Response({'status': 'pending'}, status=status.HTTP_202_ACCEPTED)
            # Claim before contacting Google. A failed exchange requires a new flow;
            # never release the claim and risk consuming the same flow twice.
            if not safe_cache('add', used_key(flow_id), True, timeout=settings.GOOGLE_OAUTH_FLOW_TTL_SECONDS + 60):
                return oauth_error('flow_already_used', 'Esta autenticação já foi utilizada.', 409)
            identity = exchange_and_verify_google_code(
                code=flow['authorization_code'],
                code_verifier=verifier,
                expected_nonce=flow['nonce'],
            )
            if flow['expires_at'] <= time.time():
                return oauth_error('flow_expired', 'O tempo para entrar com Google expirou.', 410)
            user, _created = resolve_google_user(identity)
            refresh = RefreshToken.for_user(user)
            safe_cache('set', used_key(flow_id), True, timeout=settings.GOOGLE_OAUTH_FLOW_TTL_SECONDS)
            safe_cache('delete', flow_key(flow_id))
            logger.info('google_auth_success')
            response = Response({
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'username': user.get_username(),
            })
            response['Cache-Control'] = 'no-store'
            return response
        except GoogleEmailUnverified:
            return self.failure(flow_id, 'email_not_verified', 'O e-mail da conta Google não foi verificado.', 403)
        except GoogleAccountLinkRequired:
            return self.failure(
                flow_id,
                'account_link_required',
                'Já existe uma conta com este e-mail. Entre com sua senha; o vínculo Google não é automático.',
                409,
            )
        except GoogleAccountDisabled:
            return self.failure(flow_id, 'account_not_authorized', 'Esta conta não está autorizada.', 403)
        except GoogleOAuthUnavailable:
            logger.warning('google_auth_failed', extra={'error_type': 'ProviderUnavailable', 'status_code': 503})
            return oauth_error('google_unavailable', 'O Google está temporariamente indisponível.', 503)
        except GoogleOAuthError as exc:
            return self.failure(flow_id, exc.code, 'Não foi possível validar a autenticação do Google.', 400)
        except DatabaseError as exc:
            logger.warning('google_auth_failed', extra={'error_type': type(exc).__name__, 'status_code': 503})
            return oauth_error('auth_temporarily_unavailable', 'Serviço de autenticação temporariamente indisponível.', 503)

    @staticmethod
    def failure(flow_id, code, message, http_status):
        try:
            safe_cache('set', used_key(flow_id), True, timeout=settings.GOOGLE_OAUTH_FLOW_TTL_SECONDS)
            safe_cache('delete', flow_key(flow_id))
        except GoogleOAuthUnavailable:
            pass
        logger.warning('google_auth_failed', extra={'error_type': code, 'status_code': http_status})
        return oauth_error(code, message, http_status)
