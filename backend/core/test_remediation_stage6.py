from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Diagnostico, SecurityFinding


class RemediationStage6ApiTests(APITestCase):
    def setUp(self):
        users = get_user_model()
        self.owner = users.objects.create_user(username='stage6-owner', password='safe-password')
        self.other = users.objects.create_user(username='stage6-other', password='safe-password')
        self.finding_id = 'app.sms_contacts_boot:com.example.app'
        self.package_name = 'com.example.app'
        self.started = timezone.now() - timedelta(seconds=4)
        self.finished = timezone.now()
        self.diagnostic = self.create_diagnostic(self.owner)
        self.finding = self.create_projection(self.diagnostic)

    def authenticate(self, user=None):
        token = str(RefreshToken.for_user(user or self.owner).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    def technical_result(self, remediations=None):
        return {
            'scanId': str(uuid4()),
            'mode': 'quick',
            'securityRisk': {'status': 'calculated', 'score': 40, 'level': 'moderate', 'version': '1.0'},
            'security': {
                'findings': [{
                    'id': self.finding_id,
                    'ruleId': 'app.sms_contacts_boot',
                    'subjectType': 'app',
                    'subjectId': self.package_name,
                    'packageName': self.package_name,
                    'title': 'Conjunto de capacidades sensíveis',
                    'status': 'open',
                }],
                'remediationActions': [{
                    'id': f'remediation.{self.finding_id}',
                    'findingId': self.finding_id,
                    'packageName': self.package_name,
                    'type': 'uninstall_user_app',
                    'availability': 'available',
                }],
            },
            'remediations': list(remediations or []),
        }

    def create_diagnostic(self, user, technical=None):
        return Diagnostico.objects.create(
            usuario=user,
            serial='SERIAL-STAGE6',
            modo='quick',
            modulos=['apps', 'security'],
            iniciado_em=self.started - timedelta(minutes=1),
            finalizado_em=self.started,
            health_available=True,
            health_score=80,
            resultado_tecnico=technical or self.technical_result(),
        )

    def create_projection(self, diagnostic):
        return SecurityFinding.objects.create(
            diagnostico=diagnostic,
            finding_id=self.finding_id,
            rule_id='app.sms_contacts_boot',
            category='sensitive_capability_combination',
            subject_type='app',
            subject_id=self.package_name,
            title='Conjunto de capacidades sensíveis',
            summary='Requer revisão contextual.',
            severity='medium',
            evidence_confidence='medium',
            recommendation='Validar com o cliente.',
            remediation_type='uninstall_user_app',
            remediation_available=True,
            evidence=[],
        )

    def endpoint(self, diagnostic=None):
        return f'/api/diagnosticos/{(diagnostic or self.diagnostic).id}/remediations/'

    def pending_payload(self, execution_id='11111111-1111-4111-8111-111111111111'):
        return {
            'executionId': execution_id,
            'actionId': execution_id,
            'projectionId': self.finding.id,
            'findingId': self.finding_id,
            'action': 'uninstall_user_app',
            'device': {'serial': 'SERIAL-STAGE6', 'manufacturer': 'Example', 'model': 'Device'},
            'androidUser': 10,
            'packageName': self.package_name,
            'preview': {
                'id': execution_id,
                'device': {'serial': 'SERIAL-STAGE6'},
                'app': {'name': None, 'packageName': self.package_name, 'type': 'user'},
                'androidUser': 10,
                'finding': {'id': self.finding_id, 'projectionId': self.finding.id},
                'action': {'type': 'uninstall_user_app'},
                'impact': 'Dados locais podem ser perdidos.',
                'reversible': False,
                'requiresConfirmation': True,
                'risks': ['Dados locais podem ser perdidos.'],
                'verification': {'type': 'package_absent_for_user'},
            },
            'confirmation': {
                'tokenId': '22222222-2222-4222-8222-222222222222',
                'tokenHash': 'a' * 64,
                'expiresAt': (self.finished + timedelta(minutes=2)).isoformat(),
            },
            'startedAt': self.started.isoformat(),
            'finishedAt': None,
            'status': 'remediation_pending',
            'transitions': [{'status': 'remediation_pending', 'at': self.started.isoformat()}],
            'logicalCommand': f'pm uninstall --user 10 {self.package_name}',
            'actionDispatched': False,
            'adbResult': None,
            'verification': {
                'status': 'not_verified', 'installed': None,
                'source': 'package_manager', 'user': 10,
            },
            'error': None,
        }

    def final_payload(self, status_value='resolved', execution_id='11111111-1111-4111-8111-111111111111'):
        payload = self.pending_payload(execution_id)
        installed = status_value == 'verification_failed'
        payload.update({
            'finishedAt': self.finished.isoformat(),
            'status': status_value,
            'actionDispatched': True,
            'transitions': [
                {'status': 'remediation_pending', 'at': self.started.isoformat()},
                {'status': 'executing', 'at': (self.started + timedelta(seconds=1)).isoformat()},
                {'status': 'verifying', 'at': (self.started + timedelta(seconds=2)).isoformat()},
                {'status': status_value, 'at': self.finished.isoformat()},
            ],
            'adbResult': {'status': 'success', 'code': 'SUCCESS', 'output': 'Success', 'actionDispatched': True},
            'verification': {
                'status': 'verified', 'installed': installed,
                'source': 'package_manager', 'user': 10,
            },
            'error': None if status_value == 'resolved' else {
                'code': 'PACKAGE_STILL_INSTALLED', 'message': 'Pacote ainda instalado.',
            },
        })
        return payload

    def test_pending_is_recorded_and_projection_becomes_pending(self):
        self.authenticate()
        response = self.client.post(self.endpoint(), self.pending_payload(), format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, 'remediation_pending')
        self.diagnostic.refresh_from_db()
        audit = self.diagnostic.resultado_tecnico['remediations'][0]
        self.assertEqual(audit['diagProUser']['id'], self.owner.id)
        self.assertNotIn('confirmationToken', str(audit))

    def test_final_updates_pending_atomically_without_duplicate(self):
        self.authenticate()
        self.client.post(self.endpoint(), self.pending_payload(), format='json')
        response = self.client.post(self.endpoint(), self.final_payload(), format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(response.data['updated'])
        self.diagnostic.refresh_from_db()
        self.assertEqual(len(self.diagnostic.resultado_tecnico['remediations']), 1)
        self.assertEqual(self.diagnostic.resultado_tecnico['remediations'][0]['status'], 'resolved')
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, 'resolved')

    def test_package_still_installed_becomes_verification_failed(self):
        self.authenticate()
        response = self.client.post(self.endpoint(), self.final_payload('verification_failed'), format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, 'verification_failed')

    def test_cancel_before_dispatch_keeps_finding_open(self):
        payload = self.pending_payload()
        payload.update({
            'finishedAt': self.finished.isoformat(), 'status': 'canceled',
            'transitions': [
                {'status': 'remediation_pending', 'at': self.started.isoformat()},
                {'status': 'canceled', 'at': self.finished.isoformat()},
            ],
            'error': {'code': 'OPERATION_CANCELED', 'message': 'Cancelado pelo operador.'},
        })
        self.authenticate()
        response = self.client.post(self.endpoint(), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, 'open')

    def test_failure_before_dispatch_keeps_finding_open(self):
        payload = self.pending_payload()
        payload.update({
            'finishedAt': self.finished.isoformat(), 'status': 'failed',
            'transitions': [
                {'status': 'remediation_pending', 'at': self.started.isoformat()},
                {'status': 'executing', 'at': (self.started + timedelta(seconds=1)).isoformat()},
                {'status': 'failed', 'at': self.finished.isoformat()},
            ],
            'error': {'code': 'PACKAGE_NOT_INSTALLED', 'message': 'Pacote não instalado.'},
        })
        self.authenticate()
        response = self.client.post(self.endpoint(), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, 'open')

    def test_disconnect_after_dispatch_never_marks_resolved(self):
        payload = self.pending_payload()
        payload.update({
            'finishedAt': self.finished.isoformat(), 'status': 'device_disconnected',
            'actionDispatched': True,
            'transitions': [
                {'status': 'remediation_pending', 'at': self.started.isoformat()},
                {'status': 'executing', 'at': (self.started + timedelta(seconds=1)).isoformat()},
                {'status': 'device_disconnected', 'at': self.finished.isoformat()},
            ],
            'adbResult': {'status': 'device_disconnected', 'code': 'DEVICE_DISCONNECTED', 'actionDispatched': True},
            'error': {'code': 'DEVICE_DISCONNECTED', 'message': 'Dispositivo desconectado.'},
        })
        self.authenticate()
        response = self.client.post(self.endpoint(), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, 'verification_failed')

    def test_get_returns_audit_for_owner(self):
        self.authenticate()
        self.client.post(self.endpoint(), self.pending_payload(), format='json')
        response = self.client.get(self.endpoint())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['remediationsCount'], 1)

    def test_get_is_isolated_between_users(self):
        self.authenticate(self.other)
        self.assertEqual(self.client.get(self.endpoint()).status_code, status.HTTP_404_NOT_FOUND)

    def test_endpoint_requires_authentication(self):
        self.client.credentials()
        self.assertEqual(self.client.get(self.endpoint()).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.client.post(self.endpoint(), self.pending_payload(), format='json').status_code, status.HTTP_401_UNAUTHORIZED)

    def test_raw_confirmation_token_is_rejected(self):
        payload = self.pending_payload()
        payload['confirmationToken'] = 'raw-secret'
        self.authenticate()
        response = self.client.post(self.endpoint(), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.diagnostic.refresh_from_db()
        self.assertEqual(self.diagnostic.resultado_tecnico['remediations'], [])

    def test_projection_from_other_diagnostic_is_rejected(self):
        other_diagnostic = self.create_diagnostic(self.owner)
        other_projection = self.create_projection(other_diagnostic)
        payload = self.pending_payload()
        payload['projectionId'] = other_projection.id
        self.authenticate()
        response = self.client.post(self.endpoint(), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('projectionId', response.data)

    def test_preview_android_user_mismatch_is_rejected(self):
        payload = self.pending_payload()
        payload['preview']['androidUser'] = 0
        self.authenticate()
        response = self.client.post(self.endpoint(), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('preview', response.data)

    def test_system_app_preview_is_rejected(self):
        payload = self.pending_payload()
        payload['preview']['app']['type'] = 'system'
        self.authenticate()
        response = self.client.post(self.endpoint(), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_final_result_replay_is_idempotent(self):
        self.authenticate()
        first = self.client.post(self.endpoint(), self.final_payload(), format='json')
        second = self.client.post(self.endpoint(), self.final_payload(), format='json')
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertTrue(second.data['duplicate'])
        self.diagnostic.refresh_from_db()
        self.assertEqual(len(self.diagnostic.resultado_tecnico['remediations']), 1)

    def test_conflicting_final_result_is_rejected(self):
        self.authenticate()
        self.client.post(self.endpoint(), self.final_payload(), format='json')
        response = self.client.post(self.endpoint(), self.final_payload('verification_failed'), format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_backend_rollback_preserves_pending_when_projection_update_fails(self):
        self.authenticate()
        self.client.post(self.endpoint(), self.pending_payload(), format='json')
        with patch('django.db.models.query.QuerySet.update', side_effect=RuntimeError('projection failure')):
            with self.assertRaises(RuntimeError):
                self.client.post(self.endpoint(), self.final_payload(), format='json')
        self.diagnostic.refresh_from_db()
        self.assertEqual(self.diagnostic.resultado_tecnico['remediations'][0]['status'], 'remediation_pending')

    def test_original_finding_snapshot_remains_immutable(self):
        original = deepcopy(self.diagnostic.resultado_tecnico['security']['findings'])
        self.authenticate()
        self.client.post(self.endpoint(), self.final_payload(), format='json')
        self.diagnostic.refresh_from_db()
        self.assertEqual(self.diagnostic.resultado_tecnico['security']['findings'], original)

    def test_new_scan_after_remediation_creates_new_snapshot_without_recalculating_old_score(self):
        old_score = self.diagnostic.resultado_tecnico['securityRisk']['score']
        self.authenticate()
        self.client.post(self.endpoint(), self.final_payload(), format='json')
        new_technical = self.technical_result()
        new_technical['securityRisk'] = {'status': 'calculated', 'score': 12, 'level': 'low', 'version': '1.0'}
        new_diagnostic = self.create_diagnostic(self.owner, new_technical)
        self.diagnostic.refresh_from_db()
        self.assertNotEqual(new_diagnostic.id, self.diagnostic.id)
        self.assertEqual(self.diagnostic.resultado_tecnico['securityRisk']['score'], old_score)
        self.assertEqual(new_diagnostic.resultado_tecnico['securityRisk']['score'], 12)

    def test_legacy_diagnostic_without_projection_keeps_conservative_flow(self):
        legacy = self.create_diagnostic(self.owner)
        payload = {
            'executionId': '33333333-3333-4333-8333-333333333333',
            'findingId': self.finding_id,
            'action': 'uninstall_user_app',
            'packageName': self.package_name,
            'startedAt': self.started.isoformat(),
            'finishedAt': self.finished.isoformat(),
            'status': 'resolved',
            'transitions': [
                {'status': 'executing', 'at': self.started.isoformat()},
                {'status': 'verifying', 'at': (self.started + timedelta(seconds=1)).isoformat()},
                {'status': 'resolved', 'at': self.finished.isoformat()},
            ],
            'verification': {'status': 'verified', 'installed': False, 'source': 'package_manager', 'user': 10},
        }
        self.authenticate()
        response = self.client.post(self.endpoint(legacy), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertFalse(SecurityFinding.objects.filter(diagnostico=legacy).exists())
