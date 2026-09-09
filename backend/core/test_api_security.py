"""Cross-account isolation, server authority and abuse-protection tests."""
import hashlib
import hmac
import json
from datetime import timedelta
from ssl import SSLError
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import caches
from django.db import OperationalError
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from devicecheck_backend.observability import SafeJsonFormatter

from .models import (
    Analise, Cliente, Diagnostico, Dispositivo, Licenca, Plano, Relatorio,
    SecurityFinding,
)


FAST_PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

RedisErrorForTest = type('RedisError', (Exception,), {'__module__': 'redis.exceptions'})
RedisConnectionErrorForTest = type(
    'ConnectionError', (RedisErrorForTest,), {'__module__': 'redis.exceptions'},
)
RedisTimeoutErrorForTest = type(
    'TimeoutError', (RedisErrorForTest,), {'__module__': 'redis.exceptions'},
)
RedisAuthenticationErrorForTest = type(
    'AuthenticationError', (RedisErrorForTest,), {'__module__': 'redis.exceptions'},
)


@override_settings(PASSWORD_HASHERS=FAST_PASSWORD_HASHERS)
class LegacyOwnershipApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user_a = user_model.objects.create_user(username='owner-a', password='test-password')
        self.user_b = user_model.objects.create_user(username='owner-b', password='test-password')
        self.client_a = Cliente.objects.create(usuario=self.user_a, nome='Cliente A')
        self.client_b = Cliente.objects.create(usuario=self.user_b, nome='Cliente B')
        self.device_a = Dispositivo.objects.create(
            cliente=self.client_a, tipo='android', modelo='Device A', numero_serie='SHARED-SERIAL',
        )
        self.device_b = Dispositivo.objects.create(
            cliente=self.client_b, tipo='android', modelo='Device B', numero_serie='SHARED-SERIAL',
        )
        self.analysis_a = Analise.objects.create(
            dispositivo=self.device_a, tecnico=self.user_a, score_geral=10,
        )
        self.analysis_b = Analise.objects.create(
            dispositivo=self.device_b, tecnico=self.user_b, score_geral=20,
        )
        self.report_a = Relatorio.objects.create(analise=self.analysis_a)
        self.report_b = Relatorio.objects.create(analise=self.analysis_b)

    def authenticate(self, user):
        self.client.force_authenticate(user=user)

    def test_lists_are_isolated_in_both_directions(self):
        resources = (
            ('/api/dispositivos/', self.device_a.id, self.device_b.id),
            ('/api/analises/', self.analysis_a.id, self.analysis_b.id),
            ('/api/relatorios/', self.report_a.id, self.report_b.id),
        )
        for user, own_index, foreign_index in ((self.user_a, 1, 2), (self.user_b, 2, 1)):
            self.authenticate(user)
            for path, item_a, item_b in resources:
                with self.subTest(user=user.username, path=path):
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, status.HTTP_200_OK)
                    ids = {item['id'] for item in response.data}
                    items = (None, item_a, item_b)
                    self.assertIn(items[own_index], ids)
                    self.assertNotIn(items[foreign_index], ids)

    def test_detail_and_guessed_ids_do_not_reveal_foreign_objects(self):
        self.authenticate(self.user_a)
        for base_path, foreign_id in (
            ('/api/dispositivos/', self.device_b.id),
            ('/api/analises/', self.analysis_b.id),
            ('/api/relatorios/', self.report_b.id),
        ):
            with self.subTest(base_path=base_path):
                self.assertEqual(self.client.get(f'{base_path}{foreign_id}/').status_code, 404)
                self.assertEqual(self.client.get(f'{base_path}999999/').status_code, 404)

    def test_foreign_patch_put_and_delete_return_404_without_mutation(self):
        self.authenticate(self.user_a)
        cases = (
            ('/api/dispositivos/', self.device_b, {'modelo': 'Invadido'}, 'modelo'),
            ('/api/analises/', self.analysis_b, {'score_geral': 99}, 'score_geral'),
            ('/api/relatorios/', self.report_b, {'analise': self.analysis_a.id}, 'analise_id'),
        )
        for base_path, instance, payload, protected_attribute in cases:
            with self.subTest(base_path=base_path):
                before = getattr(instance, protected_attribute)
                self.assertEqual(
                    self.client.patch(f'{base_path}{instance.id}/', payload, format='json').status_code,
                    404,
                )
                self.assertEqual(
                    self.client.put(f'{base_path}{instance.id}/', payload, format='json').status_code,
                    404,
                )
                self.assertEqual(self.client.delete(f'{base_path}{instance.id}/').status_code, 404)
                instance.refresh_from_db()
                self.assertEqual(getattr(instance, protected_attribute), before)

    def test_cross_owner_parent_relations_are_rejected_on_create(self):
        self.authenticate(self.user_a)
        device_count = Dispositivo.objects.count()
        analysis_count = Analise.objects.count()
        report_count = Relatorio.objects.count()

        response = self.client.post('/api/dispositivos/', {
            'cliente': self.client_b.id, 'tipo': 'android', 'modelo': 'Foreign parent',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post('/api/analises/', {
            'dispositivo': self.device_b.id, 'score_geral': 50,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post('/api/relatorios/', {
            'analise': self.analysis_b.id,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.assertEqual(Dispositivo.objects.count(), device_count)
        self.assertEqual(Analise.objects.count(), analysis_count)
        self.assertEqual(Relatorio.objects.count(), report_count)

    def test_own_create_uses_server_authority_for_internal_fields(self):
        self.authenticate(self.user_a)
        device_response = self.client.post('/api/dispositivos/', {
            'cliente': self.client_a.id, 'tipo': 'android', 'modelo': 'New A',
        }, format='json')
        self.assertEqual(device_response.status_code, status.HTTP_201_CREATED, device_response.data)

        analysis_response = self.client.post('/api/analises/', {
            'dispositivo': device_response.data['id'],
            'tecnico': self.user_b.id,
            'score_geral': 35,
        }, format='json')
        self.assertEqual(analysis_response.status_code, status.HTTP_201_CREATED, analysis_response.data)
        created_analysis = Analise.objects.get(pk=analysis_response.data['id'])
        self.assertEqual(created_analysis.tecnico, self.user_a)

        supplied_token = uuid4()
        report_response = self.client.post('/api/relatorios/', {
            'analise': created_analysis.id,
            'qr_code_token': str(supplied_token),
            'arquivo_pdf': 'relatorios/injected.pdf',
        }, format='json')
        self.assertEqual(report_response.status_code, status.HTTP_201_CREATED, report_response.data)
        created_report = Relatorio.objects.get(pk=report_response.data['id'])
        self.assertNotEqual(created_report.qr_code_token, supplied_token)
        self.assertFalse(created_report.arquivo_pdf)

    def test_own_resources_cannot_be_reassigned_to_foreign_parents(self):
        self.authenticate(self.user_a)
        self.assertEqual(self.client.patch(
            f'/api/dispositivos/{self.device_a.id}/', {'cliente': self.client_b.id}, format='json',
        ).status_code, 400)
        self.assertEqual(self.client.patch(
            f'/api/analises/{self.analysis_a.id}/', {'dispositivo': self.device_b.id}, format='json',
        ).status_code, 400)
        self.assertEqual(self.client.patch(
            f'/api/relatorios/{self.report_a.id}/', {'analise': self.analysis_b.id}, format='json',
        ).status_code, 400)
        self.device_a.refresh_from_db()
        self.analysis_a.refresh_from_db()
        self.report_a.refresh_from_db()
        self.assertEqual(self.device_a.cliente, self.client_a)
        self.assertEqual(self.analysis_a.dispositivo, self.device_a)
        self.assertEqual(self.report_a.analise, self.analysis_a)

    def test_analysis_owner_is_device_owner_not_legacy_technician(self):
        legacy = Analise.objects.create(dispositivo=self.device_a, tecnico=self.user_b)
        self.authenticate(self.user_a)
        self.assertEqual(self.client.get(f'/api/analises/{legacy.id}/').status_code, 200)
        self.authenticate(self.user_b)
        self.assertEqual(self.client.get(f'/api/analises/{legacy.id}/').status_code, 404)

    def test_query_parameters_and_duplicate_serial_do_not_bypass_scope(self):
        self.authenticate(self.user_a)
        for path in (
            f'/api/dispositivos/?cliente={self.client_b.id}',
            f'/api/dispositivos/?numero_serie={self.device_b.numero_serie}',
            f'/api/analises/?dispositivo={self.device_b.id}',
            f'/api/relatorios/?analise={self.analysis_b.id}',
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertNotIn(
                    self.device_b.id if 'dispositivos' in path else
                    self.analysis_b.id if 'analises' in path else self.report_b.id,
                    {item['id'] for item in response.data},
                )

    def test_own_delete_contract_is_preserved(self):
        self.authenticate(self.user_a)
        device = Dispositivo.objects.create(cliente=self.client_a, tipo='android')
        analysis = Analise.objects.create(dispositivo=device, tecnico=self.user_a)
        report = Relatorio.objects.create(analise=analysis)
        self.assertEqual(self.client.delete(f'/api/relatorios/{report.id}/').status_code, 204)
        self.assertEqual(self.client.delete(f'/api/analises/{analysis.id}/').status_code, 204)
        self.assertEqual(self.client.delete(f'/api/dispositivos/{device.id}/').status_code, 204)

    def test_legacy_routes_require_authentication(self):
        self.client.force_authenticate(user=None)
        for path in ('/api/dispositivos/', '/api/analises/', '/api/relatorios/'):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_media_file_is_not_a_public_django_route(self):
        self.report_a.arquivo_pdf.name = 'relatorios/private-report.pdf'
        self.report_a.save(update_fields=['arquivo_pdf'])
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get('/media/relatorios/private-report.pdf').status_code, 404)


@override_settings(PASSWORD_HASHERS=FAST_PASSWORD_HASHERS)
class ExistingOwnershipRegressionTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user_a = user_model.objects.create_user(username='existing-a', password='test-password')
        self.user_b = user_model.objects.create_user(username='existing-b', password='test-password')
        self.client_a = Cliente.objects.create(usuario=self.user_a, nome='Existing A')
        self.client_b = Cliente.objects.create(usuario=self.user_b, nome='Existing B')
        now = timezone.now()
        shared_scan_id = uuid4()
        self.diagnostic_a = Diagnostico.objects.create(
            usuario=self.user_a, cliente=self.client_a, serial='SERIAL-A', scan_id=shared_scan_id,
            modo='quick', modulos=['system'], iniciado_em=now - timedelta(seconds=1),
            finalizado_em=now, health_available=False,
            resultado_tecnico={'status': 'completed', 'remediations': []},
        )
        self.diagnostic_b = Diagnostico.objects.create(
            usuario=self.user_b, cliente=self.client_b, serial='SERIAL-B', scan_id=shared_scan_id,
            modo='quick', modulos=['system'], iniciado_em=now - timedelta(seconds=1),
            finalizado_em=now, health_available=False,
            resultado_tecnico={'status': 'completed', 'remediations': []},
        )
        self.finding_b = SecurityFinding.objects.create(
            diagnostico=self.diagnostic_b, finding_id='finding-b', rule_id='rule.b',
            category='apps', subject_type='app', subject_id='com.example.b',
            title='B only', severity='low', evidence_confidence='high', evidence=[],
        )

    def authenticate(self, user):
        self.client.force_authenticate(user=user)

    def test_client_detail_defensively_excludes_inconsistent_foreign_diagnostic(self):
        inconsistent = Diagnostico.objects.create(
            usuario=self.user_b, cliente=self.client_a, serial='INCONSISTENT-B', modo='quick',
            modulos=['system'], iniciado_em=timezone.now() - timedelta(seconds=1),
            finalizado_em=timezone.now(), health_available=False,
            resultado_tecnico={'status': 'completed'},
        )
        self.authenticate(self.user_a)
        response = self.client.get(f'/api/clientes/{self.client_a.id}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['diagnosticos_count'], 1)
        self.assertNotIn(inconsistent.id, {item['id'] for item in response.data['diagnosticos']})

    def test_client_owner_cannot_be_changed_and_foreign_patch_is_hidden(self):
        self.authenticate(self.user_a)
        response = self.client.patch(
            f'/api/clientes/{self.client_a.id}/',
            {'nome': 'Updated A', 'usuario': self.user_b.id},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.client_a.refresh_from_db()
        self.assertEqual(self.client_a.usuario, self.user_a)
        self.assertEqual(
            self.client.patch(f'/api/clientes/{self.client_b.id}/', {'nome': 'No'}, format='json').status_code,
            404,
        )

    def test_diagnostic_and_finding_filters_cannot_cross_accounts(self):
        self.authenticate(self.user_a)
        self.assertEqual(self.client.get('/api/diagnosticos/?serial=SERIAL-B').data, [])
        self.assertEqual(self.client.get(f'/api/diagnosticos/?cliente={self.client_b.id}').data, [])
        self.assertEqual(self.client.get(f'/api/diagnosticos/{self.diagnostic_b.id}/').status_code, 404)
        self.assertEqual(self.client.get(
            f'/api/security/findings/?diagnostico={self.diagnostic_b.id}',
        ).data, [])
        self.assertEqual(self.client.get(
            f'/api/security/findings/{self.finding_b.id}/',
        ).status_code, 404)

    def test_foreign_remediation_and_client_association_are_hidden(self):
        self.authenticate(self.user_a)
        endpoint = f'/api/diagnosticos/{self.diagnostic_b.id}/remediations/'
        self.assertEqual(self.client.get(endpoint).status_code, 404)
        self.assertEqual(self.client.post(endpoint, {}, format='json').status_code, 404)
        self.assertEqual(self.client.patch(
            f'/api/diagnosticos/{self.diagnostic_a.id}/cliente/',
            {'cliente_id': self.client_b.id}, format='json',
        ).status_code, 404)


@override_settings(PASSWORD_HASHERS=FAST_PASSWORD_HASHERS)
class ServerAuthorityTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='authority', password='test-password')
        plan = Plano.objects.create(
            nome='Authority plan', slug='authority-plan', max_diagnosticos_mes=100,
            max_dispositivos=100,
        )
        Licenca.objects.create(
            usuario=self.user, plano=plan, status='active', fim=timezone.now() + timedelta(days=1),
        )
        self.client.force_authenticate(user=self.user)

    def diagnostic_payload(self, technical_result):
        now = timezone.now()
        return {
            'serial': 'AUTHORITY-SERIAL', 'modo': 'quick', 'modulos': ['system'],
            'iniciado_em': (now - timedelta(seconds=1)).isoformat(),
            'finalizado_em': now.isoformat(), 'health_available': False,
            'warnings': [], 'stages': {}, 'resultado_tecnico': technical_result,
        }

    def test_new_diagnostic_cannot_inject_remediation_history(self):
        response = self.client.post('/api/diagnosticos/', self.diagnostic_payload({
            'status': 'completed', 'remediations': [{'diagProUser': {'id': self.user.id}}],
        }), format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Diagnostico.objects.count(), 0)

    def test_new_finding_cannot_start_in_a_final_status(self):
        response = self.client.post('/api/diagnosticos/', self.diagnostic_payload({
            'status': 'completed',
            'security': {
                'schemaVersion': '1.0',
                'findings': [{
                    'ruleId': 'rule.authority', 'category': 'apps',
                    'subjectType': 'app', 'subjectId': 'com.example.authority',
                    'title': 'Authority', 'severity': 'low',
                    'evidenceConfidence': 'high', 'status': 'resolved',
                    'evidence': [{
                        'key': 'installed', 'value': True, 'source': 'package_manager',
                        'quality': 'high',
                    }],
                }],
            },
            'remediations': [],
        }), format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Diagnostico.objects.count(), 0)

    def test_api_redacts_confirmation_hashes_but_preserves_database_audit(self):
        remediation = {
            'executionId': str(uuid4()), 'findingId': 'finding-redacted',
            'confirmation': {
                'tokenId': str(uuid4()), 'tokenHash': 'a' * 64,
                'expiresAt': timezone.now().isoformat(),
            },
        }
        diagnostic = Diagnostico.objects.create(
            usuario=self.user, serial='REDACTED', modo='quick', modulos=['system'],
            iniciado_em=timezone.now() - timedelta(seconds=1), finalizado_em=timezone.now(),
            health_available=False,
            resultado_tecnico={'status': 'completed', 'remediations': [remediation]},
        )
        finding = SecurityFinding.objects.create(
            diagnostico=diagnostic, finding_id='finding-redacted', rule_id='rule.redacted',
            category='apps', subject_type='app', subject_id='com.example.redacted',
            title='Redacted', severity='low', evidence_confidence='high', evidence=[],
        )
        for path in (
            f'/api/diagnosticos/{diagnostic.id}/',
            f'/api/diagnosticos/{diagnostic.id}/remediations/',
            f'/api/security/findings/{finding.id}/',
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertNotIn('tokenHash', str(response.data))
                self.assertNotIn('a' * 64, str(response.data))
        diagnostic.refresh_from_db()
        self.assertEqual(
            diagnostic.resultado_tecnico['remediations'][0]['confirmation']['tokenHash'],
            'a' * 64,
        )

    def test_scan_id_replay_remains_idempotent_after_server_remediation_audit(self):
        scan_id = str(uuid4())
        technical_result = {
            'status': 'completed', 'scanId': scan_id, 'remediations': [],
        }
        payload = self.diagnostic_payload(technical_result)
        first = self.client.post('/api/diagnosticos/', payload, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        diagnostic = Diagnostico.objects.get(pk=first.data['id'])
        diagnostic.resultado_tecnico = {
            **diagnostic.resultado_tecnico,
            'remediations': [{'executionId': str(uuid4()), 'status': 'resolved'}],
        }
        diagnostic.save(update_fields=['resultado_tecnico'])

        replay = self.client.post('/api/diagnosticos/', payload, format='json')
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(replay.data['id'], diagnostic.id)
        self.assertEqual(Diagnostico.objects.count(), 1)


@override_settings(PASSWORD_HASHERS=FAST_PASSWORD_HASHERS)
class ThrottlingApiTests(APITestCase):
    def setUp(self):
        caches[settings.DIAGPRO_THROTTLE_CACHE_ALIAS].clear()
        self.addCleanup(caches[settings.DIAGPRO_THROTTLE_CACHE_ALIAS].clear)
        user_model = get_user_model()
        self.user_a = user_model.objects.create_user(username='throttle-a', password='test-password')
        self.user_b = user_model.objects.create_user(username='throttle-b', password='test-password')

    def rates(self, **overrides):
        rates = dict(settings.DIAGPRO_THROTTLE_RATES)
        rates.update(overrides)
        return rates

    def test_login_normal_requests_pass_then_excess_returns_429(self):
        with override_settings(DIAGPRO_THROTTLE_RATES=self.rates(
            auth_ip='2/min', auth_account='2/min',
        )):
            for _ in range(2):
                response = self.client.post('/api/token/', {
                    'username': self.user_a.username, 'password': 'test-password',
                }, format='json')
                self.assertEqual(response.status_code, 200, response.data)
                self.assertIn('access', response.data)
            response = self.client.post('/api/token/', {
                'username': self.user_a.username, 'password': 'test-password',
            }, format='json')
        self.assertEqual(response.status_code, 429)
        self.assertIn('Retry-After', response)

    def test_login_account_bucket_cannot_be_bypassed_by_changing_ip(self):
        with override_settings(DIAGPRO_THROTTLE_RATES=self.rates(
            auth_ip='10/min', auth_account='1/min',
        )):
            first = self.client.post('/api/token/', {
                'username': self.user_a.username, 'password': 'wrong',
            }, format='json', REMOTE_ADDR='10.0.0.1')
            second = self.client.post('/api/token/', {
                'username': self.user_a.username, 'password': 'wrong',
            }, format='json', REMOTE_ADDR='10.0.0.2')
        self.assertEqual(first.status_code, 401)
        self.assertEqual(second.status_code, 429)

    def test_options_does_not_consume_login_quota(self):
        with override_settings(DIAGPRO_THROTTLE_RATES=self.rates(
            auth_ip='1/min', auth_account='1/min',
        )):
            for _ in range(3):
                self.assertEqual(self.client.options('/api/token/').status_code, 200)
            response = self.client.post('/api/token/', {
                'username': self.user_a.username, 'password': 'test-password',
            }, format='json')
        self.assertEqual(response.status_code, 200, response.data)

    def test_login_cache_failures_return_safe_503(self):
        cases = (
            ('connection_get', 'get', RedisConnectionErrorForTest('rediss://default:redis-secret@cache.test')),
            ('timeout_get', 'get', RedisTimeoutErrorForTest('redis-timeout-secret')),
            ('tls_get', 'get', SSLError('redis-tls-secret')),
            ('authentication_get', 'get', RedisAuthenticationErrorForTest('redis-auth-secret')),
            ('connection_set', 'set', RedisConnectionErrorForTest('redis-write-secret')),
        )
        for label, cache_operation, error in cases:
            with self.subTest(label=label), patch(
                'core.throttling._throttle_cache',
            ) as throttle_cache, self.assertLogs(
                'diagpro.operations', level='WARNING',
            ) as output:
                throttle_cache.return_value.get.return_value = []
                getattr(throttle_cache.return_value, cache_operation).side_effect = error
                response = self.client.post('/api/token/', {
                    'username': self.user_a.username,
                    'password': 'password-must-never-be-logged',
                }, format='json')

            self.assertEqual(response.status_code, 503, response.data)
            self.assertNotIn('access', response.data)
            self.assertNotIn('refresh', response.data)
            serialized_response = response.content.decode()
            self.assertNotIn('password-must-never-be-logged', serialized_response)
            self.assertNotIn('secret', serialized_response)
            formatted = SafeJsonFormatter().format(output.records[0])
            event = json.loads(formatted)
            self.assertEqual(event['event'], 'throttle_cache_failure')
            self.assertEqual(event['error_type'], type(error).__name__)
            self.assertEqual(event['status'], 503)
            self.assertNotIn('password-must-never-be-logged', formatted)
            self.assertNotIn('secret', formatted)

    def test_login_database_failure_returns_safe_503(self):
        with patch(
            'rest_framework_simplejwt.serializers.authenticate',
            side_effect=OperationalError('postgresql://database-secret@host/db'),
        ), self.assertLogs('diagpro.operations', level='ERROR') as output:
            response = self.client.post('/api/token/', {
                'username': self.user_a.username,
                'password': 'password-must-never-be-logged',
            }, format='json')

        self.assertEqual(response.status_code, 503, response.data)
        self.assertNotIn('access', response.data)
        self.assertNotIn('refresh', response.data)
        serialized_response = response.content.decode()
        self.assertNotIn('password-must-never-be-logged', serialized_response)
        self.assertNotIn('database-secret', serialized_response)
        formatted = SafeJsonFormatter().format(output.records[0])
        event = json.loads(formatted)
        self.assertEqual(event['event'], 'database_failure')
        self.assertEqual(event['error_type'], 'OperationalError')
        self.assertEqual(event['status'], 503)
        self.assertNotIn('password-must-never-be-logged', formatted)
        self.assertNotIn('database-secret', formatted)

    def test_refresh_is_throttled_without_changing_token_contract(self):
        refresh = str(RefreshToken.for_user(self.user_a))
        with override_settings(DIAGPRO_THROTTLE_RATES=self.rates(refresh='2/min')):
            for _ in range(2):
                response = self.client.post('/api/token/refresh/', {'refresh': refresh}, format='json')
                self.assertEqual(response.status_code, 200, response.data)
                self.assertIn('access', response.data)
            response = self.client.post('/api/token/refresh/', {'refresh': refresh}, format='json')
        self.assertEqual(response.status_code, 429)

    def test_authenticated_read_quota_is_isolated_per_user(self):
        with override_settings(DIAGPRO_THROTTLE_RATES=self.rates(read='1/min')):
            self.client.force_authenticate(user=self.user_a)
            self.assertEqual(self.client.get('/api/clientes/').status_code, 200)
            self.assertEqual(self.client.get('/api/clientes/').status_code, 429)
            self.client.force_authenticate(user=self.user_b)
            self.assertEqual(self.client.get('/api/clientes/').status_code, 200)

    def test_authenticated_write_quota_is_isolated_per_user(self):
        with override_settings(DIAGPRO_THROTTLE_RATES=self.rates(write='1/min')):
            self.client.force_authenticate(user=self.user_a)
            self.assertEqual(self.client.post('/api/clientes/', {'nome': 'A'}, format='json').status_code, 201)
            self.assertEqual(self.client.post('/api/clientes/', {'nome': 'A2'}, format='json').status_code, 429)
            self.client.force_authenticate(user=self.user_b)
            self.assertEqual(self.client.post('/api/clientes/', {'nome': 'B'}, format='json').status_code, 201)

    def test_diagnostic_has_its_own_limit_and_does_not_block_read(self):
        plan = Plano.objects.create(
            nome='Throttle', slug='throttle', max_diagnosticos_mes=100, max_dispositivos=100,
        )
        Licenca.objects.create(
            usuario=self.user_a, plano=plan, status='active', fim=timezone.now() + timedelta(days=1),
        )
        self.client.force_authenticate(user=self.user_a)
        now = timezone.now()

        def payload(serial):
            return {
                'serial': serial, 'modo': 'quick', 'modulos': ['system'],
                'iniciado_em': (now - timedelta(seconds=1)).isoformat(),
                'finalizado_em': now.isoformat(), 'health_available': False,
                'resultado_tecnico': {'status': 'completed', 'remediations': []},
            }

        with override_settings(DIAGPRO_THROTTLE_RATES=self.rates(
            diagnostic='1/min', read='10/min',
        )):
            self.assertEqual(self.client.post('/api/diagnosticos/', payload('THROTTLE-1'), format='json').status_code, 201)
            self.assertEqual(self.client.post('/api/diagnosticos/', payload('THROTTLE-2'), format='json').status_code, 429)
            self.assertEqual(self.client.get('/api/diagnosticos/').status_code, 200)

    def test_remediation_surface_has_a_dedicated_limit(self):
        diagnostic = Diagnostico.objects.create(
            usuario=self.user_a, serial='THROTTLE-REMEDIATION', modo='quick', modulos=['system'],
            iniciado_em=timezone.now() - timedelta(seconds=1), finalizado_em=timezone.now(),
            health_available=False, resultado_tecnico={'status': 'completed', 'remediations': []},
        )
        self.client.force_authenticate(user=self.user_a)
        endpoint = f'/api/diagnosticos/{diagnostic.id}/remediations/'
        with override_settings(DIAGPRO_THROTTLE_RATES=self.rates(remediation='1/min')):
            self.assertEqual(self.client.get(endpoint).status_code, 200)
            self.assertEqual(self.client.get(endpoint).status_code, 429)

    @override_settings(MERCADO_PAGO_WEBHOOK_SECRET='throttle-webhook-secret')
    def test_webhook_stays_public_hmac_protected_and_is_throttled(self):
        with override_settings(DIAGPRO_THROTTLE_RATES=self.rates(webhook='1/min')):
            first = self.client.post(
                '/api/pagamentos/mercadopago/webhook/?data.id=1',
                {'type': 'payment'}, format='json',
            )
            second = self.client.post(
                '/api/pagamentos/mercadopago/webhook/?data.id=1',
                {'type': 'payment'}, format='json',
            )
        self.assertEqual(first.status_code, 401)
        self.assertEqual(second.status_code, 429)

    @override_settings(MERCADO_PAGO_WEBHOOK_SECRET='throttle-webhook-secret')
    def test_unsigned_non_payment_notification_cannot_skip_hmac(self):
        response = self.client.post(
            '/api/pagamentos/mercadopago/webhook/?data.id=1&type=plan',
            {'type': 'plan'}, format='json',
        )
        self.assertEqual(response.status_code, 401)

    @override_settings(MERCADO_PAGO_WEBHOOK_SECRET='throttle-webhook-secret')
    def test_signed_non_payment_notification_is_safely_ignored(self):
        data_id = '1'
        request_id = 'signed-ignored'
        timestamp = '1704908010'
        manifest = f'id:{data_id};request-id:{request_id};ts:{timestamp};'
        signature = hmac.new(
            b'throttle-webhook-secret', manifest.encode('utf-8'), hashlib.sha256,
        ).hexdigest()
        response = self.client.post(
            f'/api/pagamentos/mercadopago/webhook/?data.id={data_id}&type=plan',
            {'type': 'plan'}, format='json',
            HTTP_X_REQUEST_ID=request_id,
            HTTP_X_SIGNATURE=f'ts={timestamp},v1={signature}',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['processed'])

    @override_settings(MERCADO_PAGO_WEBHOOK_SECRET='throttle-webhook-secret')
    def test_forwarded_for_is_ignored_when_no_trusted_proxy_is_configured(self):
        with override_settings(DIAGPRO_THROTTLE_RATES=self.rates(webhook='1/min')):
            first = self.client.post(
                '/api/pagamentos/mercadopago/webhook/?data.id=1', {'type': 'payment'},
                format='json', REMOTE_ADDR='10.10.10.10', HTTP_X_FORWARDED_FOR='1.1.1.1',
            )
            second = self.client.post(
                '/api/pagamentos/mercadopago/webhook/?data.id=1', {'type': 'payment'},
                format='json', REMOTE_ADDR='10.10.10.10', HTTP_X_FORWARDED_FOR='2.2.2.2',
            )
        self.assertEqual(first.status_code, 401)
        self.assertEqual(second.status_code, 429)

    @override_settings(
        MERCADO_PAGO_WEBHOOK_SECRET='throttle-webhook-secret',
        DIAGPRO_HEALTHCHECK_DATABASE=False,
    )
    def test_webhook_quota_does_not_make_health_unusable(self):
        with override_settings(DIAGPRO_THROTTLE_RATES=self.rates(webhook='1/min')):
            self.client.post(
                '/api/pagamentos/mercadopago/webhook/?data.id=1', {'type': 'payment'}, format='json',
            )
            self.assertEqual(self.client.post(
                '/api/pagamentos/mercadopago/webhook/?data.id=1', {'type': 'payment'}, format='json',
            ).status_code, 429)
            for _ in range(3):
                self.assertEqual(self.client.get('/health/').status_code, 200)

    @override_settings(DIAGPRO_HEALTHCHECK_DATABASE=False)
    def test_health_allows_monitoring_below_limit_then_returns_429(self):
        with override_settings(DIAGPRO_THROTTLE_RATES=self.rates(health='3/min')):
            for _ in range(3):
                self.assertEqual(self.client.get('/health/').status_code, 200)
            self.assertEqual(self.client.get('/health/').status_code, 429)
