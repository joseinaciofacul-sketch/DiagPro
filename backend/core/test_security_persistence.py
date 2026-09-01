from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Cliente, Diagnostico, Licenca, Plano, SecurityFinding
from .serializers import DiagnosticoSerializer


class SecurityPersistenceApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username='security-owner', password='senha-segura')
        self.other_user = user_model.objects.create_user(username='security-other', password='senha-segura')
        self.plan = Plano.objects.create(
            nome='Plano segurança estruturada',
            slug='security-structured-tests',
            max_diagnosticos_mes=None,
            remediacao=True,
        )
        for user in (self.user, self.other_user):
            Licenca.objects.create(
                usuario=user,
                plano=self.plan,
                status='active',
                fim=timezone.now() + timedelta(days=30),
            )
        self.started_at = timezone.now() - timedelta(minutes=2)
        self.finished_at = timezone.now()

    def authenticate(self, user=None):
        token = str(RefreshToken.for_user(user or self.user).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    def evidence(self, key='capabilities.ACCESSIBILITY.verified'):
        return [{
            'key': key,
            'value': True,
            'source': 'package_manager',
            'quality': 'high',
            'observationId': f'observation:{key}',
        }]

    def finding(self, **overrides):
        data = {
            'id': 'app.accessibility_overlay:com.example.app',
            'ruleId': 'app.accessibility_overlay',
            'category': 'sensitive_capability_combination',
            'subjectType': 'app',
            'subjectId': 'com.example.app',
            'packageName': 'com.example.app',
            'title': 'Acessibilidade e sobreposição de tela habilitadas',
            'summary': 'O aplicativo combina capacidades que exigem revisão.',
            'description': 'O aplicativo combina capacidades que exigem revisão.',
            'severity': 'medium',
            'evidenceConfidence': 'high',
            'evidence': self.evidence(),
            'status': 'open',
            'recommendation': 'Revise a finalidade conhecida do aplicativo.',
            'remediation': {'available': True, 'type': 'uninstall_user_app'},
        }
        data.update(overrides)
        return data

    def factor_for(self, finding, contribution=40):
        return {
            'findingId': finding.get('id'),
            'ruleId': finding['ruleId'],
            'subjectType': finding['subjectType'],
            'subjectId': finding['subjectId'],
            'category': finding['category'],
            'severity': finding['severity'],
            'evidenceConfidence': finding['evidenceConfidence'],
            'contribution': contribution,
        }

    def risk(self, findings=None, **overrides):
        findings = list(findings or [])
        data = {
            'status': 'calculated',
            'score': 40 if findings else 0,
            'level': 'moderate' if findings else 'low',
            'version': '1.0',
            'factors': [self.factor_for(finding) for finding in findings],
        }
        data.update(overrides)
        return data

    def technical_result(self, findings=None, risk=None, scan_id=None, **overrides):
        findings = list(findings or [])
        risk = deepcopy(risk if risk is not None else self.risk(findings))
        security = {
            'schemaVersion': '1.0',
            'analysisVersion': '3.0',
            'findings': deepcopy(findings),
            'observations': [],
            'confirmedThreats': [],
            'securityRisk': deepcopy(risk),
            'remediationActions': [],
        }
        result = {
            'scanId': str(scan_id or uuid4()),
            'status': 'completed',
            'mode': 'quick',
            'startedAt': self.started_at.isoformat(),
            'finishedAt': self.finished_at.isoformat(),
            'security': security,
            'securityRisk': risk,
            'remediations': [],
        }
        result.update(overrides)
        return result

    def payload(self, findings=None, risk=None, technical_result=None, **overrides):
        result = technical_result or self.technical_result(findings, risk)
        data = {
            'serial': 'SECURITY-DEVICE-01',
            'fabricante': 'Fabricante',
            'modelo': 'Modelo',
            'versao_android': '14',
            'sdk': 34,
            'security_patch': '2026-08-01',
            'modo': 'quick',
            'modulos': ['apps', 'security'],
            'iniciado_em': self.started_at.isoformat(),
            'finalizado_em': self.finished_at.isoformat(),
            'health_available': None,
            'warnings': [],
            'stages': {'security': {'status': 'completed'}},
            'resultado_tecnico': result,
        }
        data.update(overrides)
        return data

    def create(self, user=None, **payload_overrides):
        self.authenticate(user)
        response = self.client.post('/api/diagnosticos/', self.payload(**payload_overrides), format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response

    def test_create_diagnostic_without_findings(self):
        response = self.create(findings=[])
        self.assertEqual(response.data['security_findings_count'], 0)
        self.assertEqual(SecurityFinding.objects.count(), 0)

    def test_create_diagnostic_with_finding(self):
        finding = self.finding()
        response = self.create(findings=[finding])
        projected = SecurityFinding.objects.get(diagnostico_id=response.data['id'])
        self.assertEqual(projected.rule_id, finding['ruleId'])
        self.assertEqual(projected.subject_id, finding['subjectId'])

    def test_create_multiple_findings(self):
        app = self.finding()
        device = self.finding(
            id='device.su_binary_accessible:current_device',
            ruleId='device.su_binary_accessible',
            category='modified_environment',
            subjectType='device',
            subjectId='current_device',
            packageName=None,
            title='Executável su acessível',
            severity='high',
            evidenceConfidence='medium',
            evidence=self.evidence('root.suAccessible'),
            remediation={'available': False, 'type': 'manual_guidance'},
        )
        risk = self.risk([app, device], score=66, level='elevated', factors=[
            self.factor_for(app, 40), self.factor_for(device, 26.25),
        ])
        response = self.create(findings=[app, device], risk=risk)
        self.assertEqual(SecurityFinding.objects.filter(diagnostico_id=response.data['id']).count(), 2)

    def test_identical_duplicate_finding_is_projected_once(self):
        finding = self.finding()
        risk = self.risk([finding])
        response = self.create(findings=[finding, deepcopy(finding)], risk=risk)
        self.assertEqual(response.data['security_findings_count'], 1)
        self.assertEqual(len(response.data['resultado_tecnico']['security']['findings']), 2)

    def test_valid_score_is_accepted(self):
        response = self.create(findings=[], risk=self.risk([], score=19, level='low'))
        self.assertEqual(response.data['security_risk_score'], 19)
        self.assertEqual(response.data['security_risk_status'], 'calculated')

    def test_score_level_mismatch_is_rejected(self):
        self.authenticate()
        response = self.client.post(
            '/api/diagnosticos/',
            self.payload(findings=[], risk=self.risk([], score=90, level='low')),
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_score_above_one_hundred_is_rejected(self):
        self.authenticate()
        response = self.client.post(
            '/api/diagnosticos/', self.payload(findings=[], risk=self.risk([], score=101)), format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Diagnostico.objects.count(), 0)

    def test_negative_score_is_rejected(self):
        self.authenticate()
        response = self.client.post(
            '/api/diagnosticos/', self.payload(findings=[], risk=self.risk([], score=-1)), format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_incoherent_status_is_rejected(self):
        self.authenticate()
        risk = self.risk([], status='not_calculated', score=20, level=None)
        response = self.client.post('/api/diagnosticos/', self.payload(findings=[], risk=risk), format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_severity_is_rejected(self):
        self.authenticate()
        finding = self.finding(severity='super-virus')
        response = self.client.post(
            '/api/diagnosticos/',
            self.payload(findings=[finding], risk=self.risk([])),
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_evidence_confidence_is_rejected(self):
        self.authenticate()
        finding = self.finding(evidenceConfidence='certeza-absoluta')
        response = self.client.post('/api/diagnosticos/', self.payload(findings=[finding]), format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_rule_id_is_rejected(self):
        self.authenticate()
        finding = self.finding()
        finding.pop('ruleId')
        response = self.client.post(
            '/api/diagnosticos/',
            self.payload(findings=[finding], risk=self.risk([])),
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_user_cannot_read_other_users_findings(self):
        other = self.create(self.other_user, findings=[self.finding()])
        projection_id = other.data['security_findings'][0]['projection_id']
        self.authenticate(self.user)
        self.assertEqual(self.client.get('/api/security/findings/').data, [])
        self.assertEqual(
            self.client.get(f'/api/security/findings/{projection_id}/').status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_user_cannot_change_other_users_finding(self):
        other = self.create(self.other_user, findings=[self.finding()])
        projection_id = other.data['security_findings'][0]['projection_id']
        self.authenticate(self.user)
        response = self.client.patch(
            f'/api/security/findings/{projection_id}/', {'status': 'resolved'}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertEqual(SecurityFinding.objects.get(pk=projection_id).status, 'open')

    def test_legacy_diagnostic_without_security_risk_is_accepted(self):
        self.authenticate()
        response = self.client.post(
            '/api/diagnosticos/',
            self.payload(technical_result={'mode': 'quick', 'finishedAt': self.finished_at.isoformat()}),
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertFalse(response.data['security_projection_available'])

    def test_new_security_fields_are_null_on_legacy_record(self):
        diagnostic = Diagnostico.objects.create(
            usuario=self.user,
            serial='LEGACY-01',
            modo='quick',
            modulos=['system'],
            iniciado_em=self.started_at,
            finalizado_em=self.finished_at,
            resultado_tecnico={'mode': 'quick'},
        )
        self.assertIsNone(diagnostic.security_risk_score)
        self.assertIsNone(diagnostic.security_risk_status)
        self.assertIsNone(diagnostic.security_schema_version)

    def test_diagnostic_and_findings_commit_together(self):
        response = self.create(findings=[self.finding()])
        self.assertTrue(Diagnostico.objects.filter(pk=response.data['id']).exists())
        self.assertTrue(SecurityFinding.objects.filter(diagnostico_id=response.data['id']).exists())

    def test_projection_failure_rolls_back_diagnostic(self):
        serializer = DiagnosticoSerializer(data=self.payload(findings=[self.finding()]))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        with patch('core.serializers.SecurityFinding.objects.bulk_create', side_effect=RuntimeError('failure')):
            with self.assertRaises(RuntimeError):
                serializer.save(usuario=self.user)
        self.assertEqual(Diagnostico.objects.count(), 0)
        self.assertEqual(SecurityFinding.objects.count(), 0)

    def test_finding_filters(self):
        finding = self.finding()
        response = self.create(findings=[finding])
        diagnostic_id = response.data['id']
        queries = [
            f'diagnostico={diagnostic_id}',
            'severity=medium',
            'category=sensitive_capability_combination',
            'status=open',
            'rule_id=app.accessibility_overlay',
        ]
        for query in queries:
            with self.subTest(query=query):
                result = self.client.get(f'/api/security/findings/?{query}')
                self.assertEqual(result.status_code, status.HTTP_200_OK)
                self.assertEqual(len(result.data), 1)
        self.assertEqual(len(self.client.get('/api/security/findings/?severity=low').data), 0)

    def test_diagnostic_history_filters_by_device_client_and_risk(self):
        client = Cliente.objects.create(usuario=self.user, nome='Cliente histórico')
        first = self.create(findings=[self.finding()])
        first_diagnostic = Diagnostico.objects.get(pk=first.data['id'])
        first_diagnostic.cliente = client
        first_diagnostic.save(update_fields=['cliente'])
        self.create(findings=[], serial='OTHER-DEVICE-02')

        by_serial = self.client.get('/api/diagnosticos/?serial=SECURITY-DEVICE-01')
        by_client = self.client.get(f'/api/diagnosticos/?cliente={client.id}')
        by_risk = self.client.get('/api/diagnosticos/?security_risk_level=moderate')

        self.assertEqual([item['id'] for item in by_serial.data], [first.data['id']])
        self.assertEqual([item['id'] for item in by_client.data], [first.data['id']])
        self.assertEqual([item['id'] for item in by_risk.data], [first.data['id']])

    def test_finding_detail_contains_auditable_context(self):
        response = self.create(findings=[self.finding()])
        projection_id = response.data['security_findings'][0]['projection_id']
        detail = self.client.get(f'/api/security/findings/{projection_id}/')
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.data['diagnostico'], response.data['id'])
        self.assertEqual(detail.data['device']['serial'], 'SECURITY-DEVICE-01')
        self.assertEqual(detail.data['ruleId'], 'app.accessibility_overlay')
        self.assertEqual(detail.data['scoreContribution'], '40.00')
        self.assertEqual(detail.data['evidence'][0]['source'], 'package_manager')

    def test_full_technical_result_is_preserved(self):
        technical = self.technical_result([self.finding()], customTechnicalField={'preserved': True})
        response = self.create(technical_result=technical)
        diagnostic = Diagnostico.objects.get(pk=response.data['id'])
        self.assertEqual(diagnostic.resultado_tecnico, technical)

    def test_score_is_projected_only_from_canonical_json(self):
        response = self.create(findings=[], risk=self.risk([], score=18, level='low'))
        diagnostic = Diagnostico.objects.get(pk=response.data['id'])
        self.assertEqual(diagnostic.security_risk_score, 18)
        self.assertEqual(diagnostic.security_risk_level, 'low')
        self.assertEqual(diagnostic.security_risk_version, '1.0')
        self.assertEqual(diagnostic.security_schema_version, '1.0')

    def test_finding_projection_contains_score_and_remediation(self):
        response = self.create(findings=[self.finding()])
        finding = SecurityFinding.objects.get(diagnostico_id=response.data['id'])
        self.assertEqual(str(finding.score_contribution), '40.00')
        self.assertEqual(finding.scorer_version, '1.0')
        self.assertTrue(finding.remediation_available)
        self.assertEqual(finding.remediation_type, 'uninstall_user_app')

    def test_conflicting_duplicate_finding_is_rejected(self):
        first = self.finding()
        duplicate = self.finding(severity='high')
        self.authenticate()
        response = self.client.post(
            '/api/diagnosticos/', self.payload(findings=[first, duplicate]), format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Diagnostico.objects.count(), 0)

    def test_existing_remediation_flow_updates_projection_without_changing_snapshot_finding(self):
        finding = self.finding()
        technical = self.technical_result([finding])
        technical['security']['remediationActions'] = [{
            'id': f"remediation.{finding['id']}",
            'findingId': finding['id'],
            'packageName': finding['subjectId'],
            'type': 'uninstall_user_app',
            'availability': 'available',
        }]
        response = self.create(technical_result=technical)
        started = timezone.now() - timedelta(seconds=2)
        finished = timezone.now()
        remediation = {
            'executionId': str(uuid4()),
            'findingId': finding['id'],
            'action': 'uninstall_user_app',
            'packageName': finding['subjectId'],
            'startedAt': started.isoformat(),
            'finishedAt': finished.isoformat(),
            'status': 'resolved',
            'transitions': [
                {'status': 'executing', 'at': started.isoformat()},
                {'status': 'verifying', 'at': (started + timedelta(seconds=1)).isoformat()},
                {'status': 'resolved', 'at': finished.isoformat()},
            ],
            'verification': {
                'status': 'verified', 'installed': False,
                'source': 'package_manager', 'user': 0,
            },
        }
        audit = self.client.post(
            f"/api/diagnosticos/{response.data['id']}/remediations/", remediation, format='json',
        )
        self.assertEqual(audit.status_code, status.HTTP_201_CREATED, audit.data)
        projected = SecurityFinding.objects.get(diagnostico_id=response.data['id'])
        diagnostic = Diagnostico.objects.get(pk=response.data['id'])
        self.assertEqual(projected.status, 'resolved')
        self.assertEqual(diagnostic.resultado_tecnico['security']['findings'][0]['status'], 'open')

    def test_license_is_still_required_for_diagnostic_with_findings(self):
        unlicensed = get_user_model().objects.create_user(username='without-license', password='senha-segura')
        self.authenticate(unlicensed)
        response = self.client.post('/api/diagnosticos/', self.payload(findings=[self.finding()]), format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Diagnostico.objects.count(), 0)

    def test_repeated_scan_id_returns_existing_diagnostic_without_duplicate_findings(self):
        scan_id = uuid4()
        technical = self.technical_result([self.finding()], scan_id=scan_id)
        self.authenticate()
        first = self.client.post(
            '/api/diagnosticos/', self.payload(technical_result=technical), format='json',
        )
        second = self.client.post(
            '/api/diagnosticos/', self.payload(technical_result=technical), format='json',
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        self.assertEqual(second.status_code, status.HTTP_200_OK, second.data)
        self.assertEqual(first.data['id'], second.data['id'])
        self.assertEqual(Diagnostico.objects.count(), 1)
        self.assertEqual(SecurityFinding.objects.count(), 1)

    def test_reused_scan_id_with_different_snapshot_is_rejected(self):
        scan_id = uuid4()
        first_technical = self.technical_result([self.finding()], scan_id=scan_id)
        second_technical = deepcopy(first_technical)
        second_technical['status'] = 'partial'
        self.authenticate()
        first = self.client.post(
            '/api/diagnosticos/', self.payload(technical_result=first_technical), format='json',
        )
        second = self.client.post(
            '/api/diagnosticos/', self.payload(technical_result=second_technical), format='json',
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Diagnostico.objects.count(), 1)
        self.assertEqual(SecurityFinding.objects.count(), 1)

    def test_security_findings_endpoint_requires_authentication(self):
        self.client.credentials()
        self.assertEqual(
            self.client.get('/api/security/findings/').status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
