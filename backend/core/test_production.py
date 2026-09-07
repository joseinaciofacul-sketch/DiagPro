"""Configuração e respostas de produção; nenhuma integração externa real."""
import json
import logging
import os
from pathlib import Path
import runpy
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.db import OperationalError
from django.http import HttpResponse
from django.test import Client, RequestFactory, SimpleTestCase, override_settings
from django.urls import path
from rest_framework.response import Response

from devicecheck_backend.health import health
from devicecheck_backend.observability import SafeJsonFormatter, OperationalEventsMiddleware


def broken_view(request):
    raise OperationalError('private-database-password-and-local-path')


urlpatterns = [path('broken/', broken_view)]


class ProductionSettingsTests(SimpleTestCase):
    def configuration(self, **values):
        environment = {'DJANGO_SECRET_KEY': 'test-only-not-a-real-secret', **values}
        settings_file = Path(__file__).resolve().parents[1] / 'devicecheck_backend/settings.py'
        with patch.dict(os.environ, environment, clear=True), patch('dotenv.load_dotenv'):
            return runpy.run_path(str(settings_file))

    def test_debug_defaults_off_and_cors_closed(self):
        config = self.configuration()
        self.assertFalse(config['DEBUG'])
        self.assertEqual(config['CORS_ALLOWED_ORIGINS'], [])
        self.assertFalse(config['CORS_ALLOW_ALL_ORIGINS'])
        self.assertFalse(config['CORS_ALLOW_CREDENTIALS'])
        self.assertTrue(config['SESSION_COOKIE_SECURE'])
        self.assertTrue(config['CSRF_COOKIE_SECURE'])

    def test_secret_required(self):
        with self.assertRaisesRegex(ImproperlyConfigured, 'DJANGO_SECRET_KEY'):
            self.configuration(DJANGO_SECRET_KEY='')

    def test_legacy_secret_and_precedence(self):
        self.assertEqual(self.configuration(DJANGO_SECRET_KEY='', SECRET_KEY='legacy')['SECRET_KEY'], 'legacy')
        self.assertEqual(self.configuration(DJANGO_SECRET_KEY='new', SECRET_KEY='legacy')['SECRET_KEY'], 'new')

    def test_explicit_development(self):
        config = self.configuration(DJANGO_DEBUG='true')
        self.assertTrue(config['DEBUG'])
        self.assertFalse(config['SESSION_COOKIE_SECURE'])
        self.assertIn('http://localhost:5173', config['CORS_ALLOWED_ORIGINS'])
        self.assertFalse(config['SECURE_SSL_REDIRECT'])

    def test_invalid_boolean_fails(self):
        with self.assertRaises(ImproperlyConfigured):
            self.configuration(DJANGO_DEBUG='typo')

    def test_production_rejects_empty_and_wildcard_hosts(self):
        for hosts in ('', '*', 'localhost,*'):
            with self.subTest(hosts=hosts), self.assertRaises(ImproperlyConfigured):
                self.configuration(DJANGO_ALLOWED_HOSTS=hosts)

    def test_database_url_priority_and_encoded_password(self):
        config = self.configuration(
            DATABASE_URL='postgresql://test:p%40ss@localhost:5433/beta?sslmode=require',
            DB_NAME='ignored', DB_CONN_MAX_AGE='60',
        )['DATABASES']['default']
        self.assertEqual(config['NAME'], 'beta')
        self.assertEqual(config['PASSWORD'], 'p@ss')
        self.assertEqual(config['PORT'], 5433)
        self.assertEqual(config['OPTIONS']['sslmode'], 'require')
        self.assertEqual(config['CONN_MAX_AGE'], 60)
        self.assertTrue(config['CONN_HEALTH_CHECKS'])

    def test_legacy_database_and_ssl_override(self):
        config = self.configuration(DB_NAME='local', DB_USER='test', DB_PASSWORD='local-only',
                                    DB_HOST='127.0.0.1', DB_PORT='5432', DB_SSLMODE='verify-full',
                                    DB_SSLROOTCERT='/private/ca.pem')['DATABASES']['default']
        self.assertEqual(config['NAME'], 'local')
        self.assertEqual(config['OPTIONS']['sslmode'], 'verify-full')
        self.assertEqual(config['OPTIONS']['sslrootcert'], '/private/ca.pem')
        self.assertEqual(config['OPTIONS']['connect_timeout'], 5)

    def test_invalid_database_never_echoes_secret(self):
        for url in ('invalid://user:sensitive-marker@localhost/db', 'sqlite:///test.db',
                    'postgresql://user:sensitive-marker@localhost:invalid/db'):
            with self.subTest(url=url), self.assertRaises(ImproperlyConfigured) as error:
                self.configuration(DATABASE_URL=url)
            self.assertNotIn('sensitive-marker', str(error.exception))

    def test_proxy_trust_is_opt_in(self):
        self.assertNotIn('SECURE_PROXY_SSL_HEADER', self.configuration())
        config = self.configuration(DJANGO_TRUST_PROXY_SSL_HEADER='true',
                                    DJANGO_SECURE_SSL_REDIRECT='true', DJANGO_SECURE_HSTS_SECONDS='3600')
        self.assertEqual(config['SECURE_PROXY_SSL_HEADER'], ('HTTP_X_FORWARDED_PROTO', 'https'))
        self.assertTrue(config['SECURE_SSL_REDIRECT'])
        self.assertEqual(config['SECURE_HSTS_SECONDS'], 3600)


@override_settings(DEBUG=False, SECURE_SSL_REDIRECT=False, DIAGPRO_HEALTHCHECK_DATABASE=False)
class ProductionHttpTests(SimpleTestCase):
    def test_health_public_minimal_no_cache(self):
        response = self.client.get('/health/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})
        self.assertIn('no-store', response['Cache-Control'])

    def test_health_head_and_method_rejection(self):
        self.assertEqual(self.client.head('/health/').status_code, 200)
        self.assertEqual(self.client.post('/health/').status_code, 405)

    @override_settings(DIAGPRO_HEALTHCHECK_DATABASE=True)
    def test_health_database_query(self):
        with patch('devicecheck_backend.health.connection') as database:
            response = self.client.get('/health/')
        self.assertEqual(response.status_code, 200)
        database.cursor.return_value.__enter__.return_value.execute.assert_called_once_with('SELECT 1')

    @override_settings(DIAGPRO_HEALTHCHECK_DATABASE=True)
    def test_health_database_failure_is_generic(self):
        with patch('devicecheck_backend.health.connection') as database:
            database.cursor.side_effect = OperationalError('secret-local-path')
            response = self.client.get('/health/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'status': 'unavailable'})

    @override_settings(CORS_ALLOWED_ORIGINS=['null', 'https://frontend.example.test'])
    def test_cors_preflight_explicit_origins(self):
        for origin in ('null', 'https://frontend.example.test'):
            response = self.client.options('/api/token/', HTTP_ORIGIN=origin,
                                          HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
                                          HTTP_ACCESS_CONTROL_REQUEST_HEADERS='authorization,content-type')
            self.assertEqual(response['Access-Control-Allow-Origin'], origin)
            self.assertIn('authorization', response['Access-Control-Allow-Headers'])
            self.assertNotIn('Access-Control-Allow-Credentials', response)

    @override_settings(CORS_ALLOWED_ORIGINS=['null'])
    def test_other_origin_and_admin_do_not_get_cors(self):
        response = self.client.options('/api/token/', HTTP_ORIGIN='https://untrusted.example.test',
                                      HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST')
        self.assertNotIn('Access-Control-Allow-Origin', response)
        self.assertNotIn('Access-Control-Allow-Origin', self.client.get('/admin/', HTTP_ORIGIN='null'))

    def test_api_still_requires_jwt(self):
        self.assertEqual(self.client.get('/api/diagnosticos/').status_code, 401)

    def test_admin_keeps_csrf(self):
        self.assertEqual(Client(enforce_csrf_checks=True).post('/admin/login/', {}).status_code, 403)

    @override_settings(MERCADO_PAGO_WEBHOOK_SECRET='test-only')
    def test_webhook_without_jwt_or_csrf_still_requires_hmac(self):
        response = Client(enforce_csrf_checks=True).post(
            '/api/pagamentos/mercadopago/webhook/?data.id=1',
            data={'type': 'payment'}, content_type='application/json',
        )
        self.assertEqual(response.status_code, 401)

    @override_settings(ROOT_URLCONF=__name__)
    def test_unhandled_error_does_not_expose_details(self):
        response = Client(raise_request_exception=False).get('/broken/')
        self.assertEqual(response.status_code, 500)
        self.assertNotContains(response, 'private-database', status_code=500)
        self.assertNotContains(response, 'Traceback', status_code=500)

    @override_settings(SECURE_SSL_REDIRECT=True, SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO', 'https'))
    def test_proxy_https_and_redirect(self):
        self.assertEqual(self.client.get('/health/').status_code, 301)
        self.assertEqual(self.client.get('/health/', HTTP_X_FORWARDED_PROTO='https').status_code, 200)


class SafeLoggingTests(SimpleTestCase):
    def test_formatter_discards_body_secrets_and_exception_text(self):
        record = logging.LogRecord('django.request', logging.ERROR, '/private/path', 1,
                                   'password=%s', ('sensitive-marker',),
                                   (OperationalError, OperationalError('sensitive-marker'), None))
        record.request = {'Authorization': 'Bearer sensitive-marker'}
        record.status_code = 500
        output = SafeJsonFormatter().format(record)
        self.assertNotIn('sensitive-marker', output)
        self.assertNotIn('/private/path', output)
        self.assertEqual(json.loads(output)['event'], 'database_failure')

    def test_diagnostic_and_payment_events_do_not_change_responses(self):
        for path_value, status_value, event in (
            ('/api/diagnosticos/', 201, 'diagnostic_saved'),
            ('/api/diagnosticos/', 403, 'diagnostic_rejected'),
            ('/api/assinatura/checkout/', 502, 'payment_failure'),
            ('/api/pagamentos/mercadopago/webhook/', 401, 'webhook_rejected'),
        ):
            response = HttpResponse(status=status_value)
            middleware = OperationalEventsMiddleware(lambda request: response)
            with self.assertLogs('diagpro.operations', level='INFO') as output:
                self.assertIs(middleware(RequestFactory().post(path_value)), response)
            self.assertEqual(output.records[0].msg, event)

    def test_reconciliation_not_processed_is_recorded_without_payload(self):
        response = Response({'processed': False, 'code': 'test', 'private': 'sensitive-marker'})
        middleware = OperationalEventsMiddleware(lambda request: response)
        with self.assertLogs('diagpro.operations', level='INFO') as output:
            middleware(RequestFactory().post('/api/pagamentos/mercadopago/webhook/'))
        self.assertEqual(output.records[0].msg, 'webhook_not_processed')
        self.assertNotIn('sensitive-marker', SafeJsonFormatter().format(output.records[0]))
