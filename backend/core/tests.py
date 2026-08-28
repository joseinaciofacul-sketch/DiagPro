from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Cliente, Diagnostico


class DiagnosticoApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.usuario = user_model.objects.create_user(username='tecnico', password='senha-segura')
        self.outro_usuario = user_model.objects.create_user(username='outro', password='senha-segura')
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
            'resultado_tecnico': {'mode': 'quick', 'finishedAt': self.fim.isoformat()},
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
