from datetime import timedelta
from decimal import Decimal
import hashlib
import hmac
from unittest.mock import patch

from django.contrib import admin
from django.contrib.auth import authenticate, get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Cliente, Diagnostico, Empresa, Licenca, Pagamento, Plano
from .payments import PaymentIntegrationError


class DiagnosticoApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.usuario = user_model.objects.create_user(username='tecnico', password='senha-segura')
        self.outro_usuario = user_model.objects.create_user(username='outro', password='senha-segura')
        self.plano = Plano.objects.create(
            nome='Plano dos testes de diagnóstico',
            slug='diagnosticos-testes',
            max_diagnosticos_mes=None,
        )
        for usuario in (self.usuario, self.outro_usuario):
            Licenca.objects.create(
                usuario=usuario,
                plano=self.plano,
                status='active',
                fim=timezone.now() + timedelta(days=30),
            )
        self.inicio = timezone.now() - timedelta(minutes=2)
        self.fim = timezone.now()

    def payload(self, **overrides):
        dados = {
            'serial': 'R58M123ABC',
            'fabricante': 'Samsung',
            'modelo': 'SM-A525M',
            'versao_android': '14',
            'sdk': 34,
            'security_patch': '2026-07-01',
            'modo': 'quick',
            'modulos': ['apps', 'security', 'battery', 'storage'],
            'iniciado_em': self.inicio.isoformat(),
            'finalizado_em': self.fim.isoformat(),
            'health_available': True,
            'health_score': 91,
            'health_label': 'Boa',
            'health_explanation': 'Calculado com os sinais coletados.',
            'bateria': {'level': 80},
            'armazenamento': {'totalGb': 128, 'usedGb': 64},
            'memoria': None,
            'apps': {'total': 20, 'userTotal': 8, 'systemTotal': 12},
            'warnings': [],
            'stages': {'apps': {'status': 'completed'}},
            'resultado_tecnico': {'status': 'completed', 'mode': 'quick', 'finishedAt': self.fim.isoformat()},
        }
        dados.update(overrides)
        return dados

    def autenticar(self, usuario):
        access_token = str(RefreshToken.for_user(usuario).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

    def criar_para(self, dono, **overrides):
        self.autenticar(dono)
        resposta = self.client.post('/api/diagnosticos/', self.payload(**overrides), format='json')
        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)
        return resposta

    def test_criacao_autenticada_usa_request_user(self):
        resposta = self.criar_para(self.usuario, usuario=self.outro_usuario.pk)

        diagnostico = Diagnostico.objects.get(pk=resposta.data['id'])
        self.assertEqual(diagnostico.usuario, self.usuario)
        self.assertEqual(diagnostico.serial, 'R58M123ABC')
        self.assertEqual(diagnostico.health_score, 91)

    def test_listagem_autenticada_mais_recente_primeiro(self):
        antigo = self.criar_para(
            self.usuario,
            serial='OLD123',
            iniciado_em=(self.inicio - timedelta(days=1)).isoformat(),
            finalizado_em=(self.fim - timedelta(days=1)).isoformat(),
        )
        recente = self.criar_para(self.usuario, serial='NEW123')

        resposta = self.client.get('/api/diagnosticos/')

        self.assertEqual(resposta.status_code, status.HTTP_200_OK)
        self.assertEqual([item['id'] for item in resposta.data], [recente.data['id'], antigo.data['id']])

    def test_acesso_sem_token_e_negado(self):
        self.client.credentials()

        self.assertEqual(self.client.get('/api/diagnosticos/').status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(
            self.client.post('/api/diagnosticos/', self.payload(), format='json').status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_diagnosticos_ficam_isolados_entre_usuarios(self):
        proprio = self.criar_para(self.usuario)
        alheio = self.criar_para(self.outro_usuario, serial='OTHER123')

        self.autenticar(self.usuario)
        listagem = self.client.get('/api/diagnosticos/')

        self.assertEqual([item['id'] for item in listagem.data], [proprio.data['id']])
        self.assertEqual(
            self.client.get(f"/api/diagnosticos/{alheio.data['id']}/").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_payload_invalido_nao_cria_registro(self):
        self.autenticar(self.usuario)
        resposta = self.client.post(
            '/api/diagnosticos/',
            self.payload(serial='', health_score=150, modulos=[]),
            format='json',
        )

        self.assertEqual(resposta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Diagnostico.objects.count(), 0)
        self.assertIn('serial', resposta.data)
        self.assertIn('modulos', resposta.data)
        self.assertIn('health_score', resposta.data)

    def test_resultado_nao_concluido_nao_e_persistido(self):
        self.autenticar(self.usuario)

        for scan_status in (None, 'running', 'canceled', 'failed', 'device_disconnected'):
            with self.subTest(scan_status=scan_status):
                technical_result = {'mode': 'quick'}
                if scan_status is not None:
                    technical_result['status'] = scan_status
                resposta = self.client.post(
                    '/api/diagnosticos/',
                    self.payload(resultado_tecnico=technical_result),
                    format='json',
                )
                self.assertEqual(resposta.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertIn('resultado_tecnico', resposta.data)

        self.assertEqual(Diagnostico.objects.count(), 0)

    def test_resultado_parcial_pode_ser_persistido(self):
        resposta = self.criar_para(
            self.usuario,
            resultado_tecnico={'status': 'partial', 'mode': 'quick', 'warnings': [{'stage': 'apps'}]},
        )

        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resposta.data['resultado_tecnico']['status'], 'partial')


class DiagnosticLicenseEnforcementApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.usuario = user_model.objects.create_user(username='license-owner', password='senha-segura')
        self.outro_usuario = user_model.objects.create_user(username='license-other', password='senha-segura')
        self.inicio = timezone.now() - timedelta(minutes=2)
        self.fim = timezone.now()

    def autenticar(self, usuario=None):
        access_token = str(RefreshToken.for_user(usuario or self.usuario).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

    def payload(self, serial='LICENSE-TEST'):
        return {
            'serial': serial,
            'modo': 'quick',
            'modulos': ['system'],
            'iniciado_em': self.inicio.isoformat(),
            'finalizado_em': self.fim.isoformat(),
            'health_available': None,
            'warnings': [],
            'stages': {'system': {'status': 'completed'}},
            'resultado_tecnico': {'status': 'completed', 'mode': 'quick', 'serial': serial},
        }

    def criar_plano(self, limit=None):
        return Plano.objects.create(
            nome=f'Plano limite {limit}',
            slug=f'license-limit-{Plano.objects.count() + 1}',
            max_diagnosticos_mes=limit,
        )

    def criar_licenca(self, status_assinatura='active', limit=None, fim=None):
        return Licenca.objects.create(
            usuario=self.usuario,
            plano=self.criar_plano(limit),
            status=status_assinatura,
            fim=fim or timezone.now() + timedelta(days=30),
        )

    def criar_diagnostico_direto(self, usuario=None, serial='DIRECT-LICENSE-TEST'):
        return Diagnostico.objects.create(
            usuario=usuario or self.usuario,
            serial=serial,
            modo='quick',
            modulos=['system'],
            iniciado_em=self.inicio,
            finalizado_em=self.fim,
            health_available=None,
            resultado_tecnico={'mode': 'quick'},
        )

    def post(self, serial='LICENSE-TEST'):
        return self.client.post('/api/diagnosticos/', self.payload(serial), format='json')

    def assert_bloqueado(self, resposta, code):
        self.assertEqual(resposta.status_code, status.HTTP_403_FORBIDDEN, resposta.data)
        self.assertFalse(resposta.data['allowed'])
        self.assertEqual(resposta.data['code'], code)

    def test_sem_assinatura_bloqueia_novo_diagnostico(self):
        self.autenticar()

        resposta = self.post()

        self.assert_bloqueado(resposta, 'subscription_required')
        self.assertEqual(Diagnostico.objects.count(), 0)

    def test_assinatura_active_permite_novo_diagnostico(self):
        self.criar_licenca('active')
        self.autenticar()

        resposta = self.post()

        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)

    def test_assinatura_trial_permite_novo_diagnostico(self):
        self.criar_licenca('trial')
        self.autenticar()

        resposta = self.post()

        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)

    def test_assinatura_expired_bloqueia_novo_diagnostico(self):
        self.criar_licenca('expired')
        self.autenticar()

        self.assert_bloqueado(self.post(), 'subscription_expired')

    def test_assinatura_canceled_bloqueia_novo_diagnostico(self):
        self.criar_licenca('canceled')
        self.autenticar()

        self.assert_bloqueado(self.post(), 'subscription_canceled')

    def test_assinatura_past_due_bloqueia_novo_diagnostico(self):
        self.criar_licenca('past_due')
        self.autenticar()

        self.assert_bloqueado(self.post(), 'subscription_past_due')

    def test_status_active_com_data_passada_e_tratado_como_expired(self):
        self.criar_licenca('active', fim=timezone.now() - timedelta(seconds=1))
        self.autenticar()

        self.assert_bloqueado(self.post(), 'subscription_expired')

    def test_limite_nulo_permite_quantidade_ilimitada(self):
        self.criar_licenca('active', limit=None)
        for index in range(12):
            self.criar_diagnostico_direto(serial=f'UNLIMITED-{index}')
        self.autenticar()

        resposta = self.post('UNLIMITED-NEW')

        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)
        self.assertEqual(Diagnostico.objects.filter(usuario=self.usuario).count(), 13)

    def test_limite_10_com_uso_9_permite_o_decimo(self):
        self.criar_licenca('active', limit=10)
        for index in range(9):
            self.criar_diagnostico_direto(serial=f'BELOW-LIMIT-{index}')
        self.autenticar()

        resposta = self.post('TENTH-DIAGNOSTIC')

        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)
        self.assertEqual(Diagnostico.objects.filter(usuario=self.usuario).count(), 10)

    def test_limite_10_com_uso_10_bloqueia_o_decimo_primeiro(self):
        self.criar_licenca('active', limit=10)
        for index in range(10):
            self.criar_diagnostico_direto(serial=f'AT-LIMIT-{index}')
        self.autenticar()

        resposta = self.post('ELEVENTH-DIAGNOSTIC')

        self.assert_bloqueado(resposta, 'monthly_diagnostic_limit_reached')
        self.assertEqual(resposta.data['usage'], 10)
        self.assertEqual(resposta.data['limit'], 10)
        self.assertEqual(Diagnostico.objects.filter(usuario=self.usuario).count(), 10)

    def test_uso_de_outro_usuario_nao_consome_o_limite(self):
        self.criar_licenca('active', limit=1)
        self.criar_diagnostico_direto(usuario=self.outro_usuario, serial='OTHER-USAGE')
        self.autenticar()

        resposta = self.post('OWNER-FIRST')

        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)

    def test_historico_e_detalhe_continuam_disponiveis_apos_expiracao(self):
        diagnostico = self.criar_diagnostico_direto(serial='HISTORY-AFTER-EXPIRATION')
        self.criar_licenca('active', fim=timezone.now() - timedelta(seconds=1))
        self.autenticar()

        listagem = self.client.get('/api/diagnosticos/')
        detalhe = self.client.get(f'/api/diagnosticos/{diagnostico.id}/')

        self.assertEqual(listagem.status_code, status.HTTP_200_OK, listagem.data)
        self.assertEqual([item['id'] for item in listagem.data], [diagnostico.id])
        self.assertEqual(detalhe.status_code, status.HTTP_200_OK, detalhe.data)

    def test_criacao_sem_autenticacao_continua_negada(self):
        resposta = self.post()

        self.assertEqual(resposta.status_code, status.HTTP_401_UNAUTHORIZED)


class RemediationPersistenceApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.usuario = user_model.objects.create_user(username='remediation-owner', password='senha-segura')
        self.outro_usuario = user_model.objects.create_user(username='remediation-other', password='senha-segura')
        self.finding_id = 'app.sensitive_capabilities.com.example.app'
        self.package_name = 'com.example.app'
        self.inicio = timezone.now() - timedelta(seconds=3)
        self.fim = timezone.now()

    def autenticar(self, usuario):
        access_token = str(RefreshToken.for_user(usuario).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

    def resultado_tecnico(self, remediations=None):
        return {
            'mode': 'quick',
            'health': {'available': True, 'score': 88, 'label': 'Boa'},
            'stages': {'security': {'status': 'completed'}},
            'security': {
                'findings': [{
                    'id': self.finding_id,
                    'packageName': self.package_name,
                    'title': 'Capacidades sensíveis observadas',
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

    def criar_diagnostico(self, usuario, resultado_tecnico=None):
        return Diagnostico.objects.create(
            usuario=usuario,
            serial='SERIAL-REMEDIATION',
            modo='quick',
            modulos=['apps', 'security'],
            iniciado_em=self.inicio - timedelta(minutes=1),
            finalizado_em=self.inicio,
            health_available=True,
            health_score=88,
            resultado_tecnico=resultado_tecnico or self.resultado_tecnico(),
        )

    def payload(self, execution_id='11111111-1111-4111-8111-111111111111', **overrides):
        dados = {
            'executionId': execution_id,
            'findingId': self.finding_id,
            'action': 'uninstall_user_app',
            'packageName': self.package_name,
            'startedAt': self.inicio.isoformat(),
            'finishedAt': self.fim.isoformat(),
            'status': 'resolved',
            'transitions': [
                {'status': 'executing', 'at': self.inicio.isoformat()},
                {'status': 'verifying', 'at': (self.inicio + timedelta(seconds=1)).isoformat()},
                {'status': 'resolved', 'at': self.fim.isoformat()},
            ],
            'verification': {
                'status': 'verified',
                'installed': False,
                'source': 'package_manager',
                'user': 0,
            },
        }
        dados.update(overrides)
        return dados

    def endpoint(self, diagnostico_id):
        return f'/api/diagnosticos/{diagnostico_id}/remediations/'

    def test_criacao_autenticada_persiste_auditoria_real(self):
        diagnostico = self.criar_diagnostico(self.usuario)
        self.assertFalse(Licenca.objects.filter(usuario=self.usuario).exists())
        self.autenticar(self.usuario)

        resposta = self.client.post(self.endpoint(diagnostico.id), self.payload(), format='json')

        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)
        self.assertTrue(resposta.data['created'])
        diagnostico.refresh_from_db()
        auditoria = diagnostico.resultado_tecnico['remediations'][0]
        self.assertEqual(auditoria['executionId'], self.payload()['executionId'])
        self.assertEqual(auditoria['status'], 'resolved')
        self.assertFalse(auditoria['verification']['installed'])

    def test_diagnostico_de_outro_usuario_retorna_404(self):
        diagnostico = self.criar_diagnostico(self.outro_usuario)
        self.autenticar(self.usuario)

        resposta = self.client.post(self.endpoint(diagnostico.id), self.payload(), format='json')

        self.assertEqual(resposta.status_code, status.HTTP_404_NOT_FOUND)
        diagnostico.refresh_from_db()
        self.assertEqual(diagnostico.resultado_tecnico['remediations'], [])

    def test_diagnostico_inexistente_retorna_404(self):
        self.autenticar(self.usuario)

        resposta = self.client.post(self.endpoint(999999), self.payload(), format='json')

        self.assertEqual(resposta.status_code, status.HTTP_404_NOT_FOUND)

    def test_preserva_todo_resultado_tecnico_anterior(self):
        resultado_original = self.resultado_tecnico()
        diagnostico = self.criar_diagnostico(self.usuario, resultado_original)
        self.autenticar(self.usuario)

        resposta = self.client.post(self.endpoint(diagnostico.id), self.payload(), format='json')

        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)
        diagnostico.refresh_from_db()
        self.assertEqual(diagnostico.resultado_tecnico['health'], resultado_original['health'])
        self.assertEqual(diagnostico.resultado_tecnico['stages'], resultado_original['stages'])
        self.assertEqual(diagnostico.resultado_tecnico['security'], resultado_original['security'])

    def test_adiciona_nova_auditoria_sem_substituir_as_anteriores(self):
        anterior = self.payload('22222222-2222-4222-8222-222222222222')
        diagnostico = self.criar_diagnostico(self.usuario, self.resultado_tecnico([anterior]))
        self.autenticar(self.usuario)

        resposta = self.client.post(self.endpoint(diagnostico.id), self.payload(), format='json')

        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)
        diagnostico.refresh_from_db()
        auditorias = diagnostico.resultado_tecnico['remediations']
        self.assertEqual(len(auditorias), 2)
        self.assertEqual(auditorias[0]['executionId'], anterior['executionId'])
        self.assertEqual(auditorias[1]['executionId'], self.payload()['executionId'])

    def test_execution_id_duplicado_e_idempotente(self):
        diagnostico = self.criar_diagnostico(self.usuario)
        self.autenticar(self.usuario)

        primeira = self.client.post(self.endpoint(diagnostico.id), self.payload(), format='json')
        segunda = self.client.post(self.endpoint(diagnostico.id), self.payload(), format='json')

        self.assertEqual(primeira.status_code, status.HTTP_201_CREATED, primeira.data)
        self.assertEqual(segunda.status_code, status.HTTP_200_OK, segunda.data)
        self.assertTrue(segunda.data['duplicate'])
        diagnostico.refresh_from_db()
        self.assertEqual(len(diagnostico.resultado_tecnico['remediations']), 1)

    def test_payload_invalido_nao_altera_diagnostico(self):
        diagnostico = self.criar_diagnostico(self.usuario)
        self.autenticar(self.usuario)
        payload = self.payload(verification={'status': 'verified', 'installed': True})

        resposta = self.client.post(self.endpoint(diagnostico.id), payload, format='json')

        self.assertEqual(resposta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('verification', resposta.data)
        diagnostico.refresh_from_db()
        self.assertEqual(diagnostico.resultado_tecnico['remediations'], [])

    def test_acesso_sem_token_e_negado(self):
        diagnostico = self.criar_diagnostico(self.usuario)
        self.client.credentials()

        resposta = self.client.post(self.endpoint(diagnostico.id), self.payload(), format='json')

        self.assertEqual(resposta.status_code, status.HTTP_401_UNAUTHORIZED)


class ClienteApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.usuario = user_model.objects.create_user(username='cliente-owner', password='senha-segura')
        self.outro_usuario = user_model.objects.create_user(username='outro-owner', password='senha-segura')

    def autenticar(self, usuario):
        access_token = str(RefreshToken.for_user(usuario).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

    def criar_cliente(self, dono, **overrides):
        self.autenticar(dono)
        payload = {
            'nome': 'Cliente Real',
            'telefone': '11999990000',
            'email': 'cliente@example.com',
            'documento': '',
            'observacoes': '',
        }
        payload.update(overrides)
        resposta = self.client.post('/api/clientes/', payload, format='json')
        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)
        return resposta

    def criar_diagnostico(self, usuario, serial='SERIAL123'):
        agora = timezone.now()
        return Diagnostico.objects.create(
            usuario=usuario,
            serial=serial,
            modo='quick',
            modulos=['apps'],
            iniciado_em=agora - timedelta(minutes=1),
            finalizado_em=agora,
            health_available=False,
            resultado_tecnico={'mode': 'quick'},
        )

    def test_criacao_autenticada_define_usuario_do_request(self):
        resposta = self.criar_cliente(self.usuario, usuario=self.outro_usuario.pk)

        cliente = Cliente.objects.get(pk=resposta.data['id'])
        self.assertEqual(cliente.usuario, self.usuario)
        self.assertEqual(cliente.nome, 'Cliente Real')

    def test_listagem_e_detalhe_isolam_usuarios(self):
        proprio = self.criar_cliente(self.usuario)
        alheio = self.criar_cliente(self.outro_usuario, nome='Cliente Alheio')

        self.autenticar(self.usuario)
        listagem = self.client.get('/api/clientes/')

        self.assertEqual([item['id'] for item in listagem.data], [proprio.data['id']])
        self.assertEqual(self.client.get(f"/api/clientes/{alheio.data['id']}/").status_code, status.HTTP_404_NOT_FOUND)

    def test_edicao_parcial_de_cliente_proprio(self):
        cliente = self.criar_cliente(self.usuario)

        resposta = self.client.patch(
            f"/api/clientes/{cliente.data['id']}/",
            {'telefone': '11888887777', 'observacoes': 'Retorno agendado.'},
            format='json',
        )

        self.assertEqual(resposta.status_code, status.HTTP_200_OK)
        self.assertEqual(resposta.data['telefone'], '11888887777')
        self.assertEqual(resposta.data['observacoes'], 'Retorno agendado.')

    def test_acesso_sem_token_e_exclusao_sao_negados(self):
        self.client.credentials()
        self.assertEqual(self.client.get('/api/clientes/').status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.client.post('/api/clientes/', {'nome': 'Sem token'}, format='json').status_code, status.HTTP_401_UNAUTHORIZED)

        cliente = Cliente.objects.create(usuario=self.usuario, nome='Sem exclusão')
        self.autenticar(self.usuario)
        self.assertEqual(self.client.delete(f'/api/clientes/{cliente.id}/').status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_vinculo_entre_diagnostico_e_cliente_do_mesmo_usuario(self):
        cliente = Cliente.objects.create(usuario=self.usuario, nome='Cliente Vinculado')
        diagnostico = self.criar_diagnostico(self.usuario)
        self.autenticar(self.usuario)

        resposta = self.client.patch(
            f'/api/diagnosticos/{diagnostico.id}/cliente/',
            {'cliente_id': cliente.id},
            format='json',
        )

        self.assertEqual(resposta.status_code, status.HTTP_200_OK)
        diagnostico.refresh_from_db()
        self.assertEqual(diagnostico.cliente, cliente)
        self.assertEqual(resposta.data['cliente']['id'], cliente.id)

        detalhe_cliente = self.client.get(f'/api/clientes/{cliente.id}/')
        self.assertEqual(detalhe_cliente.data['diagnosticos_count'], 1)
        self.assertEqual(detalhe_cliente.data['diagnosticos'][0]['id'], diagnostico.id)

    def test_nao_vincula_cliente_de_outro_usuario(self):
        cliente_alheio = Cliente.objects.create(usuario=self.outro_usuario, nome='Cliente Alheio')
        diagnostico = self.criar_diagnostico(self.usuario)
        self.autenticar(self.usuario)

        resposta = self.client.patch(
            f'/api/diagnosticos/{diagnostico.id}/cliente/',
            {'cliente_id': cliente_alheio.id},
            format='json',
        )

        self.assertEqual(resposta.status_code, status.HTTP_404_NOT_FOUND)
        diagnostico.refresh_from_db()
        self.assertIsNone(diagnostico.cliente)

    def test_nao_vincula_diagnostico_de_outro_usuario(self):
        cliente = Cliente.objects.create(usuario=self.usuario, nome='Cliente Próprio')
        diagnostico_alheio = self.criar_diagnostico(self.outro_usuario, serial='OTHER123')
        self.autenticar(self.usuario)

        resposta = self.client.patch(
            f'/api/diagnosticos/{diagnostico_alheio.id}/cliente/',
            {'cliente_id': cliente.id},
            format='json',
        )

        self.assertEqual(resposta.status_code, status.HTTP_404_NOT_FOUND)
        diagnostico_alheio.refresh_from_db()
        self.assertIsNone(diagnostico_alheio.cliente)


class SettingsApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.usuario = user_model.objects.create_user(
            username='configurador',
            password='SenhaAtual!2026',
            email='antes@example.com',
        )
        self.outro_usuario = user_model.objects.create_user(
            username='outro-configurador',
            password='SenhaAtual!2026',
        )

    def autenticar(self, usuario):
        access_token = str(RefreshToken.for_user(usuario).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

    def test_me_exige_autenticacao(self):
        self.assertEqual(self.client.get('/api/me/').status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.client.get('/api/empresas/').status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(
            self.client.post('/api/me/password/', {}, format='json').status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_me_retorna_e_atualiza_apenas_usuario_autenticado(self):
        self.autenticar(self.usuario)
        resposta = self.client.patch('/api/me/', {
            'first_name': 'José',
            'last_name': 'Silva',
            'email': 'jose@example.com',
            'username': 'tentativa-de-troca',
            'is_staff': True,
        }, format='json')

        self.assertEqual(resposta.status_code, status.HTTP_200_OK, resposta.data)
        self.usuario.refresh_from_db()
        self.assertEqual(self.usuario.first_name, 'José')
        self.assertEqual(self.usuario.last_name, 'Silva')
        self.assertEqual(self.usuario.email, 'jose@example.com')
        self.assertEqual(self.usuario.username, 'configurador')
        self.assertFalse(self.usuario.is_staff)
        self.assertEqual(resposta.data['username'], 'configurador')

    def test_troca_de_senha_valida_senha_atual_e_confirmacao(self):
        self.autenticar(self.usuario)
        senha_errada = self.client.post('/api/me/password/', {
            'current_password': 'Incorreta!2026',
            'new_password': 'NovaSenhaSegura!2026',
            'confirm_new_password': 'NovaSenhaSegura!2026',
        }, format='json')
        confirmacao_errada = self.client.post('/api/me/password/', {
            'current_password': 'SenhaAtual!2026',
            'new_password': 'NovaSenhaSegura!2026',
            'confirm_new_password': 'OutraSenha!2026',
        }, format='json')

        self.assertEqual(senha_errada.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(confirmacao_errada.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(self.usuario.check_password('SenhaAtual!2026'))

    def test_troca_de_senha_usa_hash_do_django(self):
        self.autenticar(self.usuario)
        resposta = self.client.post('/api/me/password/', {
            'current_password': 'SenhaAtual!2026',
            'new_password': 'NovaSenhaSegura!2026',
            'confirm_new_password': 'NovaSenhaSegura!2026',
        }, format='json')

        self.assertEqual(resposta.status_code, status.HTTP_200_OK, resposta.data)
        self.usuario.refresh_from_db()
        self.assertNotEqual(self.usuario.password, 'NovaSenhaSegura!2026')
        self.assertEqual(self.client.get('/api/me/').status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIsNone(authenticate(username='configurador', password='SenhaAtual!2026'))
        self.assertEqual(authenticate(username='configurador', password='NovaSenhaSegura!2026'), self.usuario)

    def test_empresa_e_criada_com_dono_do_request(self):
        self.autenticar(self.usuario)
        resposta = self.client.post('/api/empresas/', {
            'nome': 'Assistência Real',
            'cnpj': '12.345.678/0001-90',
            'email': 'contato@example.com',
            'telefone': '11999998888',
            'endereco': 'Rua cadastrada, 10',
            'usuario': self.outro_usuario.id,
        }, format='json')

        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)
        empresa = Empresa.objects.get(pk=resposta.data['id'])
        self.assertEqual(empresa.usuario, self.usuario)
        self.assertEqual(resposta.data['usuario'], self.usuario.id)

    def test_empresa_fica_isolada_entre_usuarios(self):
        empresa_alheia = Empresa.objects.create(usuario=self.outro_usuario, nome='Outra assistência')
        self.autenticar(self.usuario)

        self.assertEqual(self.client.get('/api/empresas/').data, [])
        self.assertEqual(
            self.client.patch(f'/api/empresas/{empresa_alheia.id}/', {'nome': 'Ataque'}, format='json').status_code,
            status.HTTP_404_NOT_FOUND,
        )
        empresa_alheia.refresh_from_db()
        self.assertEqual(empresa_alheia.nome, 'Outra assistência')

    def test_empresa_propria_pode_ser_editada(self):
        empresa = Empresa.objects.create(usuario=self.usuario, nome='Nome anterior')
        self.autenticar(self.usuario)

        resposta = self.client.patch(
            f'/api/empresas/{empresa.id}/',
            {'nome': 'Nome atualizado', 'telefone': '11999990000'},
            format='json',
        )

        self.assertEqual(resposta.status_code, status.HTTP_200_OK, resposta.data)
        empresa.refresh_from_db()
        self.assertEqual(empresa.nome, 'Nome atualizado')
        self.assertEqual(empresa.telefone, '11999990000')

    def test_empresa_valida_campos_e_impede_duplicidade_por_usuario(self):
        self.autenticar(self.usuario)
        invalida = self.client.post('/api/empresas/', {'nome': '', 'cnpj': '123'}, format='json')
        primeira = self.client.post('/api/empresas/', {'nome': 'Assistência Real'}, format='json')
        duplicada = self.client.post('/api/empresas/', {'nome': 'Outra'}, format='json')

        self.assertEqual(invalida.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(primeira.status_code, status.HTTP_201_CREATED, primeira.data)
        self.assertEqual(duplicada.status_code, status.HTTP_400_BAD_REQUEST)


class SubscriptionApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.usuario = user_model.objects.create_user(username='assinante', password='SenhaSegura!2026')
        self.outro_usuario = user_model.objects.create_user(username='outro-assinante', password='SenhaSegura!2026')

    def autenticar(self, usuario):
        access_token = str(RefreshToken.for_user(usuario).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

    def criar_plano(self, **overrides):
        data = {
            'nome': 'Plano cadastrado',
            'slug': f'plano-{Plano.objects.count() + 1}',
            'descricao': 'Descrição cadastrada no teste.',
            'ativo': True,
            'preco_mensal': None,
            'moeda': '',
            'max_usuarios': None,
            'max_dispositivos': None,
            'max_diagnosticos_mes': None,
        }
        data.update(overrides)
        return Plano.objects.create(**data)

    def criar_diagnostico(self, usuario, serial, finished_at):
        return Diagnostico.objects.create(
            usuario=usuario,
            serial=serial,
            modo='quick',
            modulos=['system'],
            iniciado_em=finished_at - timedelta(minutes=2),
            finalizado_em=finished_at,
            health_available=None,
            resultado_tecnico={'mode': 'quick'},
        )

    def test_endpoints_exigem_autenticacao(self):
        self.assertEqual(self.client.get('/api/planos/').status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.client.get('/api/assinatura/').status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.client.get('/api/licencas/').status_code, status.HTTP_401_UNAUTHORIZED)

    def test_usuario_sem_assinatura_recebe_ausencia_explicita(self):
        self.autenticar(self.usuario)
        resposta = self.client.get('/api/assinatura/')

        self.assertEqual(resposta.status_code, status.HTTP_200_OK)
        self.assertIsNone(resposta.data['assinatura'])
        self.assertIsNone(resposta.data['uso'])
        self.assertFalse(resposta.data['capacidade_diagnostico']['allowed'])
        self.assertEqual(resposta.data['capacidade_diagnostico']['code'], 'subscription_required')

    def test_planos_disponiveis_retorna_somente_ativos(self):
        ativo = self.criar_plano(nome='Plano ativo', slug='ativo')
        self.criar_plano(nome='Plano inativo', slug='inativo', ativo=False)
        self.autenticar(self.usuario)

        resposta = self.client.get('/api/planos/')

        self.assertEqual(resposta.status_code, status.HTTP_200_OK)
        self.assertEqual([item['id'] for item in resposta.data], [ativo.id])
        self.assertIsNone(resposta.data[0]['preco_mensal'])
        self.assertIsNone(resposta.data[0]['max_usuarios'])
        self.assertIsNone(resposta.data[0]['max_dispositivos'])
        self.assertIsNone(resposta.data[0]['max_diagnosticos_mes'])

    def test_assinatura_retorna_plano_status_e_datas_reais(self):
        plano = self.criar_plano(
            max_usuarios=3,
            max_dispositivos=20,
            max_diagnosticos_mes=100,
            scanner_completo=True,
            relatorios=True,
        )
        inicio = timezone.now()
        fim = inicio + timedelta(days=30)
        Licenca.objects.create(
            usuario=self.usuario,
            plano=plano,
            status='active',
            inicio=inicio,
            fim=fim,
            renovacao_automatica=True,
        )
        self.autenticar(self.usuario)

        resposta = self.client.get('/api/assinatura/')

        self.assertEqual(resposta.status_code, status.HTTP_200_OK)
        self.assertEqual(resposta.data['assinatura']['plano']['id'], plano.id)
        self.assertEqual(resposta.data['assinatura']['status'], 'active')
        self.assertEqual(resposta.data['assinatura']['status_efetivo'], 'active')
        self.assertTrue(resposta.data['assinatura']['valida'])
        self.assertEqual(resposta.data['assinatura']['fim'], fim.isoformat().replace('+00:00', 'Z'))
        self.assertTrue(resposta.data['assinatura']['renovacao_automatica'])
        self.assertTrue(resposta.data['capacidade_diagnostico']['allowed'])
        self.assertEqual(resposta.data['capacidade_diagnostico']['code'], 'diagnostic_allowed')

    def test_assinatura_de_outro_usuario_nao_e_retornada(self):
        plano = self.criar_plano()
        assinatura_alheia = Licenca.objects.create(
            usuario=self.outro_usuario,
            plano=plano,
            status='active',
            fim=timezone.now() + timedelta(days=30),
        )
        self.autenticar(self.usuario)

        resposta = self.client.get('/api/assinatura/')

        self.assertIsNone(resposta.data['assinatura'])
        self.assertEqual(self.client.get('/api/licencas/').data, [])
        self.assertEqual(
            self.client.get(f'/api/licencas/{assinatura_alheia.id}/').status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_status_suportados_e_validade(self):
        plano = self.criar_plano()
        user_model = get_user_model()
        valid_statuses = {'trial': True, 'active': True, 'past_due': False, 'canceled': False, 'expired': False}

        for index, (subscription_status, expected_validity) in enumerate(valid_statuses.items()):
            usuario = user_model.objects.create_user(username=f'status-{index}', password='SenhaSegura!2026')
            license_record = Licenca.objects.create(
                usuario=usuario,
                plano=plano,
                status=subscription_status,
                fim=timezone.now() + timedelta(days=10),
            )
            self.assertEqual(license_record.status_efetivo, subscription_status)
            self.assertEqual(license_record.valida, expected_validity)

        expired_by_date = Licenca.objects.create(
            usuario=self.usuario,
            plano=plano,
            status='active',
            fim=timezone.now() - timedelta(seconds=1),
        )
        self.assertEqual(expired_by_date.status_efetivo, 'expired')
        self.assertFalse(expired_by_date.valida)

    def test_uso_atual_conta_diagnosticos_do_mes_e_seriais_unicos(self):
        plano = self.criar_plano(max_diagnosticos_mes=10, max_dispositivos=5)
        Licenca.objects.create(
            usuario=self.usuario,
            plano=plano,
            status='active',
            fim=timezone.now() + timedelta(days=30),
        )
        now = timezone.now()
        previous_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
        self.criar_diagnostico(self.usuario, 'SERIAL-1', now - timedelta(hours=2))
        self.criar_diagnostico(self.usuario, 'SERIAL-1', now - timedelta(hours=1))
        diagnostico_anterior = self.criar_diagnostico(self.usuario, 'SERIAL-2', previous_month)
        Diagnostico.objects.filter(pk=diagnostico_anterior.pk).update(criado_em=previous_month)
        self.criar_diagnostico(self.outro_usuario, 'SERIAL-OTHER', now)
        self.autenticar(self.usuario)

        resposta = self.client.get('/api/assinatura/')

        self.assertEqual(resposta.data['uso']['diagnosticos_mes'], 2)
        self.assertEqual(resposta.data['uso']['dispositivos_identificados'], 2)
        self.assertIsNone(resposta.data['uso']['usuarios'])

    def test_assinatura_e_somente_leitura_pela_api(self):
        self.autenticar(self.usuario)
        resposta = self.client.post('/api/licencas/', {'status': 'active'}, format='json')
        self.assertEqual(resposta.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_plano_e_assinatura_estao_registrados_no_admin(self):
        self.assertTrue(admin.site.is_registered(Plano))
        self.assertTrue(admin.site.is_registered(Licenca))


@override_settings(
    MERCADO_PAGO_ACCESS_TOKEN='TEST-backend-only-token',
    MERCADO_PAGO_WEBHOOK_SECRET='webhook-test-secret',
    MERCADO_PAGO_SUCCESS_URL='https://example.com/payments/success',
    MERCADO_PAGO_FAILURE_URL='https://example.com/payments/failure',
    MERCADO_PAGO_PENDING_URL='https://example.com/payments/pending',
    MERCADO_PAGO_WEBHOOK_URL='https://example.com/api/payments/webhook',
    MERCADO_PAGO_USE_SANDBOX=True,
    MERCADO_PAGO_LICENSE_DURATION_DAYS=30,
)
class MercadoPagoPaymentsApiTests(APITestCase):
    checkout_url = '/api/assinatura/checkout/'
    webhook_url = '/api/pagamentos/mercadopago/webhook/'

    def setUp(self):
        user_model = get_user_model()
        self.usuario = user_model.objects.create_user(
            username='payment-owner',
            password='senha-segura',
            email='payment-owner@example.com',
        )
        self.outro_usuario = user_model.objects.create_user(
            username='payment-other',
            password='senha-segura',
        )
        self.plano = Plano.objects.create(
            nome='Plano Mercado Pago',
            slug='mercado-pago',
            ativo=True,
            preco_mensal=Decimal('79.90'),
            moeda='BRL',
            max_diagnosticos_mes=10,
        )

    def autenticar(self, usuario=None):
        access_token = str(RefreshToken.for_user(usuario or self.usuario).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

    def preference_response(self):
        return {
            'id': 'preference-test-1',
            'sandbox_init_point': 'https://sandbox.mercadopago.com.br/checkout/test',
            'init_point': 'https://www.mercadopago.com.br/checkout/live',
        }

    def criar_pagamento(self, usuario=None):
        return Pagamento.objects.create(
            usuario=usuario or self.usuario,
            plano=self.plano,
            external_preference_id='preference-test-1',
            valor_esperado=self.plano.preco_mensal,
            moeda='BRL',
            checkout_url='https://sandbox.mercadopago.com.br/checkout/test',
            sandbox=True,
        )

    def remote_payment(self, payment, payment_id='100001', external_status='approved', **overrides):
        data = {
            'id': payment_id,
            'external_reference': str(payment.external_reference),
            'status': external_status,
            'status_detail': 'accredited' if external_status == 'approved' else external_status,
            'transaction_amount': '79.90',
            'currency_id': 'BRL',
            'live_mode': False,
            'date_approved': timezone.now().isoformat(),
        }
        data.update(overrides)
        return data

    def webhook_headers(self, payment_id, request_id='request-test-1'):
        timestamp = '1704908010'
        manifest = f'id:{str(payment_id).lower()};request-id:{request_id};ts:{timestamp};'
        signature = hmac.new(
            b'webhook-test-secret',
            manifest.encode('utf-8'),
            hashlib.sha256,
        ).hexdigest()
        return {
            'HTTP_X_SIGNATURE': f'ts={timestamp},v1={signature}',
            'HTTP_X_REQUEST_ID': request_id,
        }

    def enviar_webhook(self, payment_id='100001', request_id='request-test-1', headers=None):
        webhook_headers = headers or self.webhook_headers(payment_id, request_id)
        return self.client.post(
            f'{self.webhook_url}?data.id={payment_id}&type=payment',
            {'type': 'payment', 'data': {'id': payment_id}},
            format='json',
            **webhook_headers,
        )

    def diagnostic_payload(self):
        now = timezone.now()
        return {
            'serial': 'PAYMENT-LICENSE-TEST',
            'modo': 'quick',
            'modulos': ['system'],
            'iniciado_em': (now - timedelta(minutes=1)).isoformat(),
            'finalizado_em': now.isoformat(),
            'health_available': None,
            'resultado_tecnico': {'status': 'completed', 'mode': 'quick'},
        }

    def test_checkout_sem_jwt_e_bloqueado(self):
        resposta = self.client.post(self.checkout_url, {'plano_id': self.plano.id}, format='json')

        self.assertEqual(resposta.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(Pagamento.objects.count(), 0)

    @patch('core.payments.MercadoPagoClient.create_preference')
    def test_checkout_com_plano_inexistente_retorna_404(self, create_preference):
        self.autenticar()

        resposta = self.client.post(self.checkout_url, {'plano_id': 999999}, format='json')

        self.assertEqual(resposta.status_code, status.HTTP_404_NOT_FOUND)
        create_preference.assert_not_called()

    @patch('core.payments.MercadoPagoClient.create_preference')
    def test_checkout_com_plano_inativo_e_bloqueado(self, create_preference):
        self.plano.ativo = False
        self.plano.save(update_fields=['ativo'])
        self.autenticar()

        resposta = self.client.post(self.checkout_url, {'plano_id': self.plano.id}, format='json')

        self.assertEqual(resposta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resposta.data['code'], 'plan_not_available')
        create_preference.assert_not_called()

    @patch('core.payments.MercadoPagoClient.create_preference')
    def test_frontend_nao_consegue_alterar_preco(self, create_preference):
        self.autenticar()

        resposta = self.client.post(
            self.checkout_url,
            {'plano_id': self.plano.id, 'preco': '0.01', 'moeda': 'USD'},
            format='json',
        )

        self.assertEqual(resposta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Pagamento.objects.count(), 0)
        create_preference.assert_not_called()

    @patch('core.payments.MercadoPagoClient.create_preference')
    def test_checkout_usa_preco_moeda_e_referencia_do_backend(self, create_preference):
        create_preference.return_value = self.preference_response()
        self.autenticar()

        resposta = self.client.post(self.checkout_url, {'plano_id': self.plano.id}, format='json')

        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)
        payment = Pagamento.objects.get()
        self.assertEqual(payment.valor_esperado, Decimal('79.90'))
        self.assertEqual(payment.moeda, 'BRL')
        sent_payload = create_preference.call_args.args[0]
        self.assertEqual(sent_payload['items'][0]['unit_price'], 79.9)
        self.assertEqual(sent_payload['items'][0]['currency_id'], 'BRL')
        self.assertEqual(sent_payload['external_reference'], str(payment.external_reference))
        self.assertNotIn('access_token', sent_payload)

    @patch('core.payments.MercadoPagoClient.get_payment')
    def test_pagamento_pendente_nao_ativa_assinatura(self, get_payment):
        payment = self.criar_pagamento()
        get_payment.return_value = self.remote_payment(payment, external_status='pending')

        resposta = self.enviar_webhook()

        self.assertEqual(resposta.status_code, status.HTTP_200_OK, resposta.data)
        payment.refresh_from_db()
        license_record = Licenca.objects.get(usuario=self.usuario)
        self.assertEqual(payment.status, 'pending')
        self.assertEqual(license_record.status, 'past_due')
        self.assertFalse(license_record.valida)

    @patch('core.payments.MercadoPagoClient.get_payment')
    def test_pagamento_aprovado_valido_ativa_assinatura(self, get_payment):
        payment = self.criar_pagamento()
        get_payment.return_value = self.remote_payment(payment)

        resposta = self.enviar_webhook()

        self.assertEqual(resposta.status_code, status.HTTP_200_OK, resposta.data)
        self.assertTrue(resposta.data['subscription_activated'])
        payment.refresh_from_db()
        license_record = Licenca.objects.get(usuario=self.usuario)
        self.assertEqual(payment.status, 'approved')
        self.assertIsNotNone(payment.ativado_em)
        self.assertEqual(license_record.status, 'active')
        self.assertEqual(license_record.plano, self.plano)
        self.assertEqual(license_record.provider, 'mercadopago')
        self.assertEqual(license_record.external_subscription_id, '100001')
        self.assertTrue(license_record.valida)

    @patch('core.payments.MercadoPagoClient.get_payment')
    def test_pagamento_rejeitado_nao_ativa_assinatura(self, get_payment):
        payment = self.criar_pagamento()
        get_payment.return_value = self.remote_payment(payment, external_status='rejected')

        resposta = self.enviar_webhook()

        self.assertEqual(resposta.status_code, status.HTTP_200_OK, resposta.data)
        payment.refresh_from_db()
        license_record = Licenca.objects.get(usuario=self.usuario)
        self.assertEqual(payment.status, 'rejected')
        self.assertIsNone(payment.ativado_em)
        self.assertEqual(license_record.status, 'canceled')
        self.assertFalse(license_record.valida)

    @patch('core.payments.MercadoPagoClient.get_payment')
    def test_webhook_aprovado_duplicado_e_idempotente(self, get_payment):
        payment = self.criar_pagamento()
        get_payment.return_value = self.remote_payment(payment)

        primeira = self.enviar_webhook(request_id='request-duplicate-1')
        first_expiration = Licenca.objects.get(usuario=self.usuario).fim
        segunda = self.enviar_webhook(request_id='request-duplicate-2')

        self.assertTrue(primeira.data['subscription_activated'])
        self.assertFalse(segunda.data['subscription_activated'])
        payment.refresh_from_db()
        self.assertEqual(payment.webhook_count, 2)
        self.assertEqual(Licenca.objects.get(usuario=self.usuario).fim, first_expiration)

    @patch('core.payments.MercadoPagoClient.get_payment')
    def test_valor_divergente_nao_ativa_assinatura(self, get_payment):
        payment = self.criar_pagamento()
        get_payment.return_value = self.remote_payment(payment, transaction_amount='1.00')

        resposta = self.enviar_webhook()

        self.assertEqual(resposta.status_code, status.HTTP_200_OK, resposta.data)
        payment.refresh_from_db()
        self.assertEqual(payment.status, 'invalid')
        self.assertEqual(payment.erro_codigo, 'payment_amount_mismatch')
        self.assertFalse(Licenca.objects.filter(usuario=self.usuario).exists())

    @patch('core.payments.MercadoPagoClient.get_payment')
    def test_moeda_divergente_nao_ativa_assinatura(self, get_payment):
        payment = self.criar_pagamento()
        get_payment.return_value = self.remote_payment(payment, currency_id='USD')

        resposta = self.enviar_webhook()

        self.assertEqual(resposta.status_code, status.HTTP_200_OK, resposta.data)
        payment.refresh_from_db()
        self.assertEqual(payment.status, 'invalid')
        self.assertEqual(payment.erro_codigo, 'payment_currency_mismatch')
        self.assertFalse(Licenca.objects.filter(usuario=self.usuario).exists())

    @patch('core.payments.MercadoPagoClient.get_payment')
    def test_pagamento_de_outro_usuario_nao_altera_assinatura_errada(self, get_payment):
        original_license = Licenca.objects.create(
            usuario=self.usuario,
            plano=self.plano,
            status='canceled',
            fim=timezone.now() + timedelta(days=5),
        )
        payment = self.criar_pagamento(usuario=self.outro_usuario)
        get_payment.return_value = self.remote_payment(payment)

        resposta = self.enviar_webhook()

        self.assertEqual(resposta.status_code, status.HTTP_200_OK, resposta.data)
        original_license.refresh_from_db()
        self.assertEqual(original_license.status, 'canceled')
        self.assertEqual(Licenca.objects.get(usuario=self.outro_usuario).status, 'active')

    @patch('core.payments.MercadoPagoClient.get_payment')
    def test_webhook_invalido_nao_altera_assinatura(self, get_payment):
        payment = self.criar_pagamento()

        resposta = self.enviar_webhook(headers={
            'HTTP_X_SIGNATURE': 'ts=1704908010,v1=invalid',
            'HTTP_X_REQUEST_ID': 'request-invalid',
        })

        self.assertEqual(resposta.status_code, status.HTTP_401_UNAUTHORIZED)
        get_payment.assert_not_called()
        payment.refresh_from_db()
        self.assertEqual(payment.status, 'checkout_created')
        self.assertFalse(Licenca.objects.filter(usuario=self.usuario).exists())

    @patch('core.payments.MercadoPagoClient.get_payment')
    def test_webhook_valido_funciona_sem_jwt_e_sem_token_csrf(self, get_payment):
        payment = self.criar_pagamento()
        get_payment.return_value = self.remote_payment(payment)
        csrf_client = APIClient(enforce_csrf_checks=True)

        resposta = csrf_client.post(
            f'{self.webhook_url}?data.id=100001&type=payment',
            {'type': 'payment', 'data': {'id': '100001'}},
            format='json',
            **self.webhook_headers('100001', 'request-no-csrf'),
        )

        self.assertEqual(resposta.status_code, status.HTTP_200_OK, resposta.data)
        self.assertTrue(resposta.data['processed'])
        self.assertEqual(Licenca.objects.get(usuario=self.usuario).status, 'active')

    @patch('core.payments.MercadoPagoClient.get_payment')
    def test_assinatura_ativada_por_pagamento_libera_diagnostico(self, get_payment):
        payment = self.criar_pagamento()
        get_payment.return_value = self.remote_payment(payment)
        self.enviar_webhook()
        self.autenticar()

        resposta = self.client.post('/api/diagnosticos/', self.diagnostic_payload(), format='json')

        self.assertEqual(resposta.status_code, status.HTTP_201_CREATED, resposta.data)

    @patch('core.payments.MercadoPagoClient.get_payment')
    def test_assinatura_nao_elegivel_continua_bloqueando_diagnostico(self, get_payment):
        payment = self.criar_pagamento()
        get_payment.return_value = self.remote_payment(payment, external_status='rejected')
        self.enviar_webhook()
        self.autenticar()

        resposta = self.client.post('/api/diagnosticos/', self.diagnostic_payload(), format='json')

        self.assertEqual(resposta.status_code, status.HTTP_403_FORBIDDEN, resposta.data)
        self.assertEqual(resposta.data['code'], 'subscription_canceled')

    @patch('core.payments.MercadoPagoClient.get_payment')
    def test_falha_de_comunicacao_nao_ativa_assinatura(self, get_payment):
        payment = self.criar_pagamento()
        get_payment.side_effect = PaymentIntegrationError(
            'mercado_pago_unavailable',
            'Não foi possível comunicar com o Mercado Pago.',
        )

        resposta = self.enviar_webhook()

        self.assertEqual(resposta.status_code, status.HTTP_502_BAD_GATEWAY, resposta.data)
        payment.refresh_from_db()
        self.assertEqual(payment.status, 'checkout_created')
        self.assertFalse(Licenca.objects.filter(usuario=self.usuario).exists())

    @patch('core.payments.MercadoPagoClient.create_preference')
    def test_falha_ao_criar_checkout_fica_auditada_sem_ativar(self, create_preference):
        create_preference.side_effect = PaymentIntegrationError(
            'mercado_pago_unavailable',
            'Não foi possível comunicar com o Mercado Pago.',
        )
        self.autenticar()

        resposta = self.client.post(self.checkout_url, {'plano_id': self.plano.id}, format='json')

        self.assertEqual(resposta.status_code, status.HTTP_502_BAD_GATEWAY, resposta.data)
        payment = Pagamento.objects.get()
        self.assertEqual(payment.status, 'failed')
        self.assertFalse(Licenca.objects.filter(usuario=self.usuario).exists())

    def test_pagamento_esta_registrado_no_admin(self):
        self.assertTrue(admin.site.is_registered(Pagamento))

    def test_consulta_da_assinatura_nao_expoe_pagamento_de_outro_usuario(self):
        self.criar_pagamento(usuario=self.outro_usuario)
        self.autenticar()

        sem_pagamento_proprio = self.client.get('/api/assinatura/')
        pagamento_proprio = self.criar_pagamento()
        com_pagamento_proprio = self.client.get('/api/assinatura/')

        self.assertIsNone(sem_pagamento_proprio.data['pagamento_recente'])
        self.assertEqual(com_pagamento_proprio.data['pagamento_recente']['id'], pagamento_proprio.id)
