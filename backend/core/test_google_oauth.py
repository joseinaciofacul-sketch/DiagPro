from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import caches
from django.test import override_settings
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from .google_oauth import (
    GoogleEmailUnverified,
    GoogleOAuthRejected,
    GoogleOAuthUnavailable,
    exchange_and_verify_google_code,
)
from .models import ExternalIdentity


OAUTH_SETTINGS = {
    'GOOGLE_CLIENT_ID': 'client-id.apps.googleusercontent.com',
    'GOOGLE_CLIENT_SECRET': 'test-only-client-secret',
    'GOOGLE_OAUTH_REDIRECT_URI': 'https://api.example.test/api/auth/google/callback/',
    'GOOGLE_OAUTH_FLOW_TTL_SECONDS': 300,
}


@override_settings(**OAUTH_SETTINGS)
class GoogleOAuthTests(APITestCase):
    def setUp(self):
        caches['throttle'].clear()

    def start_flow(self):
        response = self.client.post('/api/auth/google/start/', {}, format='json')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        query = parse_qs(urlparse(payload['authorizationUrl']).query)
        return payload, query['state'][0], query

    def receive_callback(self, state, code='provider-code'):
        return self.client.get('/api/auth/google/callback/', {'state': state, 'code': code})

    @staticmethod
    def identity(subject='google-subject-1', email='new-user@example.test'):
        return {'subject': subject, 'email': email, 'name': 'New User'}

    def complete(self, payload):
        return self.client.post('/api/auth/google/complete/', {
            'flowId': payload['flowId'],
            'pollToken': payload['pollToken'],
            'codeVerifier': payload['codeVerifier'],
        }, format='json')

    def test_start_creates_state_nonce_and_pkce(self):
        payload, _state, query = self.start_flow()
        self.assertEqual(query['response_type'], ['code'])
        self.assertEqual(query['code_challenge_method'], ['S256'])
        self.assertEqual(set(query['scope'][0].split()), {'openid', 'email', 'profile'})
        self.assertTrue(query['nonce'][0])
        self.assertNotIn('clientSecret', payload)

    def test_valid_state_is_accepted_and_reuse_is_rejected(self):
        _payload, state, _query = self.start_flow()
        self.assertEqual(self.receive_callback(state).status_code, 200)
        self.assertEqual(self.receive_callback(state).status_code, 409)

    def test_invalid_state_is_rejected_without_accepting_code(self):
        _payload, state, _query = self.start_flow()
        response = self.receive_callback(f'{state}tampered')
        self.assertEqual(response.status_code, 400)
        self.assertNotContains(response, 'provider-code', status_code=400)

    def test_pending_flow_returns_202(self):
        payload, _state, _query = self.start_flow()
        self.assertEqual(self.complete(payload).status_code, 202)

    def test_start_secrets_are_not_cacheable(self):
        response = self.client.post('/api/auth/google/start/', {}, format='json')
        self.assertEqual(response['Cache-Control'], 'no-store')

    def test_non_object_and_non_ascii_payloads_are_rejected(self):
        self.assertEqual(self.client.post('/api/auth/google/complete/', [], format='json').status_code, 400)
        payload, _state, _query = self.start_flow()
        payload['codeVerifier'] = 'é' * 86
        self.assertEqual(self.complete(payload).status_code, 400)

    def test_callback_does_not_extend_absolute_expiration(self):
        with patch('core.google_auth_views.time.time', return_value=1000):
            payload, state, _query = self.start_flow()
        with patch('core.google_auth_views.time.time', return_value=1299):
            self.assertEqual(self.receive_callback(state).status_code, 200)
        with patch('core.google_auth_views.time.time', return_value=1301):
            self.assertEqual(self.complete(payload).status_code, 410)

    @patch('core.google_auth_views.exchange_and_verify_google_code')
    def test_failed_exchange_cannot_be_replayed(self, exchange):
        exchange.side_effect = GoogleOAuthUnavailable
        payload, state, _query = self.start_flow()
        self.receive_callback(state)
        self.assertEqual(self.complete(payload).status_code, 503)
        self.assertEqual(self.complete(payload).status_code, 409)
        self.assertEqual(exchange.call_count, 1)

    @patch('core.google_auth_views.resolve_google_user')
    @patch('core.google_auth_views.exchange_and_verify_google_code')
    def test_database_failure_is_safe(self, exchange, resolve):
        from django.db import OperationalError
        exchange.return_value = self.identity()
        resolve.side_effect = OperationalError('test-only-sensitive-detail')
        payload, state, _query = self.start_flow()
        self.receive_callback(state)
        response = self.complete(payload)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('test-only-sensitive-detail', response.content.decode())

    def test_callback_atomic_claim_blocks_competing_callback(self):
        payload, state, _query = self.start_flow()
        caches['throttle'].add(f"google-oauth-callback:{payload['flowId']}", True, timeout=300)
        self.assertEqual(self.receive_callback(state).status_code, 409)

    def test_parallel_completion_does_not_release_another_request_lock(self):
        payload, state, _query = self.start_flow()
        self.receive_callback(state)
        lock_key = f"google-oauth-finalize:{payload['flowId']}"
        caches['throttle'].add(lock_key, True, timeout=30)
        self.assertEqual(self.complete(payload).status_code, 202)
        self.assertIs(caches['throttle'].get(lock_key), True)

    @patch('core.google_auth_views.exchange_and_verify_google_code')
    def test_new_user_gets_diagpro_access_and_refresh_tokens(self, exchange):
        exchange.return_value = self.identity()
        payload, state, _query = self.start_flow()
        self.receive_callback(state)
        response = self.complete(payload)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        user = get_user_model().objects.get(email='new-user@example.test')
        self.assertEqual(int(AccessToken(body['access'])['user_id']), user.pk)
        self.assertTrue(body['refresh'])
        self.assertFalse(user.has_usable_password())
        self.assertTrue(ExternalIdentity.objects.filter(user=user, provider_user_id='google-subject-1').exists())

    @patch('core.google_auth_views.exchange_and_verify_google_code')
    def test_linked_identity_reuses_existing_user(self, exchange):
        User = get_user_model()
        user = User.objects.create_user(username='linked', email='linked@example.test')
        ExternalIdentity.objects.create(user=user, provider='google', provider_user_id='known-subject')
        exchange.return_value = self.identity('known-subject', 'changed@example.test')
        payload, state, _query = self.start_flow()
        self.receive_callback(state)
        response = self.complete(payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['username'], 'linked')
        self.assertEqual(User.objects.count(), 1)

    @patch('core.google_auth_views.exchange_and_verify_google_code')
    def test_equal_email_does_not_auto_link_existing_password_account(self, exchange):
        get_user_model().objects.create_user(username='existing', email='same@example.test', password='safe-test-password')
        exchange.return_value = self.identity('different-subject', 'same@example.test')
        payload, state, _query = self.start_flow()
        self.receive_callback(state)
        response = self.complete(payload)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'account_link_required')
        self.assertEqual(ExternalIdentity.objects.count(), 0)

    @patch('core.google_auth_views.exchange_and_verify_google_code')
    def test_unverified_email_is_rejected(self, exchange):
        exchange.side_effect = GoogleEmailUnverified
        payload, state, _query = self.start_flow()
        self.receive_callback(state)
        response = self.complete(payload)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'email_not_verified')

    @patch('core.google_auth_views.exchange_and_verify_google_code')
    def test_invalid_token_and_nonce_are_rejected(self, exchange):
        invalid_nonce = GoogleOAuthRejected()
        invalid_nonce.code = 'invalid_nonce'
        exchange.side_effect = invalid_nonce
        payload, state, _query = self.start_flow()
        self.receive_callback(state)
        response = self.complete(payload)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'invalid_nonce')
        self.assertNotContains(response, 'provider-code', status_code=400)

    @patch('core.google_auth_views.exchange_and_verify_google_code')
    def test_invalid_google_token_is_rejected(self, exchange):
        exchange.side_effect = GoogleOAuthRejected
        payload, state, _query = self.start_flow()
        self.receive_callback(state)
        response = self.complete(payload)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'invalid_google_token')

    def test_canceled_provider_flow_is_reported_safely(self):
        payload, state, _query = self.start_flow()
        callback = self.client.get('/api/auth/google/callback/', {'state': state, 'error': 'access_denied'})
        self.assertEqual(callback.status_code, 200)
        response = self.complete(payload)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'login_canceled')

    def test_expired_callback_returns_410(self):
        payload, state, _query = self.start_flow()
        caches['throttle'].delete(f"google-oauth-flow:{payload['flowId']}")
        self.assertEqual(self.receive_callback(state).status_code, 410)

    @patch('core.google_auth_views.exchange_and_verify_google_code')
    def test_completed_flow_cannot_be_replayed(self, exchange):
        exchange.return_value = self.identity()
        payload, state, _query = self.start_flow()
        self.receive_callback(state)
        self.assertEqual(self.complete(payload).status_code, 200)
        self.assertEqual(self.complete(payload).status_code, 409)
        self.assertEqual(exchange.call_count, 1)

    @override_settings(DIAGPRO_THROTTLE_RATES={
        'google_oauth_start': '1/min',
        'google_oauth_callback': '60/min',
        'google_oauth_complete': '120/min',
    })
    def test_start_is_throttled_by_ip(self):
        self.assertEqual(self.client.post('/api/auth/google/start/', {}, format='json').status_code, 200)
        self.assertEqual(self.client.post('/api/auth/google/start/', {}, format='json').status_code, 429)

    @override_settings(GOOGLE_CLIENT_SECRET='')
    def test_missing_configuration_does_not_expose_details(self):
        response = self.client.post('/api/auth/google/start/', {}, format='json')
        self.assertEqual(response.status_code, 503)
        body = response.content.decode().casefold()
        self.assertNotIn('client-id', body)
        self.assertNotIn('secret', body)


@override_settings(**OAUTH_SETTINGS)
class GoogleTokenVerificationTests(APITestCase):
    @staticmethod
    def token_response():
        response = type('TokenResponse', (), {})()
        response.status_code = 200
        response.json = lambda: {'id_token': 'opaque-id-token'}
        return response

    @patch('core.google_oauth.id_token.verify_oauth2_token')
    @patch('core.google_oauth.requests.post')
    def test_official_verifier_receives_expected_audience_and_nonce_is_checked(self, post, verify):
        post.return_value = self.token_response()
        verify.return_value = {
            'iss': 'https://accounts.google.com',
            'sub': 'subject',
            'email': 'Verified@Example.test',
            'email_verified': True,
            'nonce': 'expected-nonce',
            'name': 'Verified User',
        }
        identity = exchange_and_verify_google_code(
            code='authorization-code', code_verifier='pkce-verifier', expected_nonce='expected-nonce',
        )
        self.assertEqual(identity['email'], 'verified@example.test')
        self.assertEqual(verify.call_args.args[2], OAUTH_SETTINGS['GOOGLE_CLIENT_ID'])
        sent = post.call_args.kwargs['data']
        self.assertFalse(post.call_args.kwargs['allow_redirects'])
        self.assertEqual(sent['code_verifier'], 'pkce-verifier')
        self.assertEqual(sent['redirect_uri'], OAUTH_SETTINGS['GOOGLE_OAUTH_REDIRECT_URI'])

    @patch('core.google_oauth.GoogleRequest.__call__')
    def test_certificate_request_is_bounded_and_does_not_follow_redirects(self, request):
        from .google_oauth import BoundedGoogleRequest
        BoundedGoogleRequest()(url='https://certs.example.test')
        self.assertEqual(request.call_args.kwargs['timeout'], 10)
        self.assertFalse(request.call_args.kwargs['allow_redirects'])

    @patch('core.google_oauth.id_token.verify_oauth2_token')
    @patch('core.google_oauth.requests.post')
    def test_invalid_issuer_is_rejected_after_signature_validation(self, post, verify):
        post.return_value = self.token_response()
        verify.return_value = {
            'iss': 'https://attacker.example', 'sub': 'subject', 'email': 'a@example.test',
            'email_verified': True, 'nonce': 'nonce',
        }
        with self.assertRaises(GoogleOAuthRejected):
            exchange_and_verify_google_code(code='code', code_verifier='verifier', expected_nonce='nonce')

    @patch('core.google_oauth.requests.post')
    def test_google_timeout_becomes_known_unavailable_error(self, post):
        import requests
        post.side_effect = requests.Timeout
        with self.assertRaises(GoogleOAuthUnavailable):
            exchange_and_verify_google_code(code='code', code_verifier='verifier', expected_nonce='nonce')

    @patch('core.google_oauth.requests.post')
    def test_google_server_error_becomes_known_unavailable_error(self, post):
        response = self.token_response()
        response.status_code = 503
        post.return_value = response
        with self.assertRaises(GoogleOAuthUnavailable):
            exchange_and_verify_google_code(code='code', code_verifier='verifier', expected_nonce='nonce')

    @patch('core.google_oauth.id_token.verify_oauth2_token')
    @patch('core.google_oauth.requests.post')
    def test_google_certificate_transport_failure_is_unavailable(self, post, verify):
        from google.auth.exceptions import TransportError
        post.return_value = self.token_response()
        verify.side_effect = TransportError('test-only transport failure')
        with self.assertRaises(GoogleOAuthUnavailable):
            exchange_and_verify_google_code(code='code', code_verifier='verifier', expected_nonce='nonce')
