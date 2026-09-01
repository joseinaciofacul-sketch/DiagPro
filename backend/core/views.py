from rest_framework.viewsets import ModelViewSet
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.generics import ListAPIView, RetrieveUpdateAPIView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Count, Max
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.utils import timezone
from copy import deepcopy

from .models import (
    Empresa, Cliente, Dispositivo, Analise, Relatorio, Plano, Licenca,
    Pagamento, Diagnostico, SecurityFinding,
)
from .serializers import (
    EmpresaSerializer,
    ClienteSerializer,
    DispositivoSerializer,
    AnaliseSerializer,
    RelatorioSerializer,
    LicencaSerializer,
    PlanoSerializer,
    PagamentoSerializer,
    CheckoutSerializer,
    DiagnosticoSerializer,
    SecurityFindingSummarySerializer,
    SecurityFindingDetailSerializer,
    RemediationAuditSerializer,
    CurrentUserSerializer,
    ChangePasswordSerializer,
)
from .payments import (
    InvalidWebhookSignature,
    PaymentConfigurationError,
    PaymentIntegrationError,
    PaymentReconciliationError,
    create_checkout_preference,
    process_mercado_pago_webhook,
    validate_webhook_signature,
)
from .subscriptions import diagnostic_capability, get_user_subscription, subscription_usage


class EmpresaViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = EmpresaSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        return Empresa.objects.filter(usuario=self.request.user).order_by('id')

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)


class CurrentUserView(RetrieveUpdateAPIView):
    serializer_class = CurrentUserSerializer
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_object(self):
        return self.request.user


class ChangePasswordView(APIView):
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({'detail': 'Senha alterada com sucesso. Faça login novamente.'})


class ClienteViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = ClienteSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        return (
            Cliente.objects
            .filter(usuario=self.request.user)
            .annotate(
                diagnosticos_count=Count('diagnosticos', distinct=True),
                dispositivos_count=Count('dispositivos', distinct=True),
                ultimo_atendimento=Max('diagnosticos__finalizado_em'),
            )
            .prefetch_related('diagnosticos__security_findings')
            .order_by('nome', 'id')
        )

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)


class DispositivoViewSet(ModelViewSet):
    queryset = Dispositivo.objects.all()
    serializer_class = DispositivoSerializer


class AnaliseViewSet(ModelViewSet):
    queryset = Analise.objects.all()
    serializer_class = AnaliseSerializer


class RelatorioViewSet(ModelViewSet):
    queryset = Relatorio.objects.all()
    serializer_class = RelatorioSerializer


class LicencaViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LicencaSerializer

    def get_queryset(self):
        return Licenca.objects.filter(usuario=self.request.user).select_related('plano')


class PlanListView(ListAPIView):
    serializer_class = PlanoSerializer

    def get_queryset(self):
        return Plano.objects.filter(ativo=True).order_by('nome', 'id')


class CurrentSubscriptionView(APIView):
    def get(self, request):
        license_record = get_user_subscription(request.user)
        capability = diagnostic_capability(request.user, license_record)
        latest_payment = (
            Pagamento.objects
            .filter(usuario=request.user)
            .select_related('plano')
            .first()
        )
        payment_data = (
            PagamentoSerializer(latest_payment, context={'request': request}).data
            if latest_payment else None
        )
        if license_record is None:
            return Response({
                'assinatura': None,
                'uso': None,
                'capacidade_diagnostico': capability,
                'pagamento_recente': payment_data,
            })

        return Response({
            'assinatura': LicencaSerializer(license_record, context={'request': request}).data,
            'uso': subscription_usage(request.user),
            'capacidade_diagnostico': capability,
            'pagamento_recente': payment_data,
        })


class SubscriptionCheckoutView(APIView):
    def post(self, request):
        serializer = CheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        plan = get_object_or_404(Plano, pk=serializer.validated_data['plano_id'])
        if not plan.ativo:
            return Response({
                'code': 'plan_not_available',
                'message': 'Este plano não está disponível para compra.',
            }, status=status.HTTP_400_BAD_REQUEST)
        if plan.preco_mensal is None or plan.preco_mensal <= 0:
            return Response({
                'code': 'plan_price_not_configured',
                'message': 'Este plano ainda não possui preço válido para checkout.',
            }, status=status.HTTP_400_BAD_REQUEST)

        currency = (plan.moeda or '').strip().upper()
        if len(currency) != 3 or not currency.isalpha():
            return Response({
                'code': 'plan_currency_not_configured',
                'message': 'Este plano ainda não possui moeda válida para checkout.',
            }, status=status.HTTP_400_BAD_REQUEST)

        payment = Pagamento.objects.create(
            usuario=request.user,
            plano=plan,
            valor_esperado=plan.preco_mensal,
            moeda=currency,
            sandbox=bool(getattr(settings, 'MERCADO_PAGO_USE_SANDBOX', True)),
        )
        try:
            preference_id, checkout_url = create_checkout_preference(payment, request.user)
        except PaymentConfigurationError as error:
            payment.status = 'failed'
            payment.erro_codigo = error.code
            payment.save(update_fields=['status', 'erro_codigo', 'atualizado_em'])
            return Response({'code': error.code, 'message': error.message}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except PaymentIntegrationError as error:
            payment.status = 'failed'
            payment.erro_codigo = error.code
            payment.save(update_fields=['status', 'erro_codigo', 'atualizado_em'])
            return Response({'code': error.code, 'message': error.message}, status=status.HTTP_502_BAD_GATEWAY)

        payment.external_preference_id = preference_id
        payment.checkout_url = checkout_url
        payment.save(update_fields=['external_preference_id', 'checkout_url', 'atualizado_em'])
        return Response({
            'pagamento_id': payment.id,
            'status': payment.status,
            'checkout_url': checkout_url,
            'sandbox': payment.sandbox,
        }, status=status.HTTP_201_CREATED)


class MercadoPagoWebhookView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        notification_type = str(request.data.get('type') or request.query_params.get('type') or '').lower()
        if notification_type and notification_type != 'payment':
            return Response({'processed': False, 'code': 'notification_type_ignored'})

        data_id = request.query_params.get('data.id')
        try:
            validate_webhook_signature(
                x_signature=request.headers.get('x-signature'),
                x_request_id=request.headers.get('x-request-id'),
                data_id=data_id,
            )
        except InvalidWebhookSignature as error:
            return Response({'code': error.code, 'message': error.message}, status=status.HTTP_401_UNAUTHORIZED)
        except PaymentConfigurationError as error:
            return Response({'code': error.code, 'message': error.message}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        try:
            payment, _license_record, activated = process_mercado_pago_webhook(
                data_id=data_id,
                request_id=request.headers.get('x-request-id'),
            )
        except PaymentConfigurationError as error:
            return Response({'code': error.code, 'message': error.message}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except PaymentReconciliationError as error:
            return Response({'processed': False, 'code': error.code, 'message': error.message})
        except PaymentIntegrationError as error:
            return Response({'code': error.code, 'message': error.message}, status=status.HTTP_502_BAD_GATEWAY)

        return Response({
            'processed': True,
            'payment_status': payment.status,
            'subscription_activated': activated,
        })


class DiagnosticoViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = DiagnosticoSerializer

    def get_queryset(self):
        queryset = (
            Diagnostico.objects
            .filter(usuario=self.request.user)
            .select_related('cliente')
            .prefetch_related('security_findings')
            .order_by('-finalizado_em', '-id')
        )
        serial = self.request.query_params.get('serial')
        cliente = self.request.query_params.get('cliente')
        risk_level = self.request.query_params.get('security_risk_level')
        risk_status = self.request.query_params.get('security_risk_status')
        if serial:
            if len(serial) > 128:
                raise ValidationError({'serial': 'O serial informado é muito longo.'})
            queryset = queryset.filter(serial=serial)
        if cliente:
            if not cliente.isdigit():
                raise ValidationError({'cliente': 'Informe um cliente válido.'})
            queryset = queryset.filter(cliente_id=int(cliente))
        if risk_level:
            allowed_levels = {'low', 'attention', 'moderate', 'elevated', 'very_high'}
            if risk_level not in allowed_levels:
                raise ValidationError({'security_risk_level': 'Classificação de risco inválida.'})
            queryset = queryset.filter(security_risk_level=risk_level)
        if risk_status:
            allowed_statuses = {'calculated', 'partial', 'not_calculated', 'insufficient_data'}
            if risk_status not in allowed_statuses:
                raise ValidationError({'security_risk_status': 'Status de risco inválido.'})
            queryset = queryset.filter(security_risk_status=risk_status)
        return queryset

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        get_user_model().objects.select_for_update().only('pk').get(pk=request.user.pk)
        capability = diagnostic_capability(request.user)
        if not capability['allowed']:
            return Response(capability, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        scan_id = serializer.get_security_projection().get('scan_id')
        if scan_id is not None:
            existing = self.get_queryset().filter(scan_id=scan_id).first()
            if existing is not None:
                if existing.resultado_tecnico != serializer.validated_data['resultado_tecnico']:
                    raise ValidationError({
                        'resultado_tecnico': 'O scanId já pertence a outro snapshot deste usuário.',
                    })
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    @action(detail=True, methods=['patch'], url_path='cliente')
    def associar_cliente(self, request, pk=None):
        diagnostico = self.get_object()
        cliente_id = request.data.get('cliente_id')

        if cliente_id in (None, ''):
            diagnostico.cliente = None
        else:
            if isinstance(cliente_id, bool) or not str(cliente_id).isdigit():
                raise ValidationError({'cliente_id': 'Informe um cliente válido.'})
            diagnostico.cliente = get_object_or_404(
                Cliente,
                pk=cliente_id,
                usuario=request.user,
            )

        diagnostico.save(update_fields=['cliente'])
        return Response(self.get_serializer(diagnostico).data)

    @action(detail=True, methods=['get', 'post'], url_path='remediations')
    def registrar_remediacao(self, request, pk=None):
        diagnostico = self.get_object()
        if request.method == 'GET':
            resultado = diagnostico.resultado_tecnico or {}
            remediations = resultado.get('remediations', []) if isinstance(resultado, dict) else []
            if not isinstance(remediations, list):
                raise ValidationError({'remediations': 'O histórico técnico existente é inválido.'})
            return Response({
                'diagnosticId': diagnostico.id,
                'remediations': remediations,
                'remediationsCount': len(remediations),
            })

        serializer = RemediationAuditSerializer(
            data=request.data,
            context={'request': request, 'diagnostico': diagnostico},
        )
        serializer.is_valid(raise_exception=True)
        remediation = dict(serializer.data)
        execution_id = remediation['executionId']
        remediation['diagnosticId'] = diagnostico.id
        remediation['diagProUser'] = {
            'id': request.user.id,
            'username': request.user.get_username(),
        }

        with transaction.atomic():
            diagnostico = Diagnostico.objects.select_for_update().get(
                pk=diagnostico.pk,
                usuario=request.user,
            )
            resultado = deepcopy(diagnostico.resultado_tecnico or {})
            remediations = resultado.get('remediations', [])
            if not isinstance(remediations, list):
                raise ValidationError({'remediations': 'O histórico técnico existente é inválido.'})

            existing_index = next((
                index for index, item in enumerate(remediations)
                if isinstance(item, dict) and item.get('executionId') == execution_id
            ), None)
            existing = remediations[existing_index] if existing_index is not None else None
            if existing is not None and existing.get('status') != 'remediation_pending':
                if existing != remediation:
                    raise ValidationError({
                        'executionId': 'Esta ação já possui um resultado final diferente.',
                    })
                return Response({
                    'diagnosticId': diagnostico.id,
                    'created': False,
                    'duplicate': True,
                    'updated': False,
                    'remediation': existing,
                    'remediationsCount': len(remediations),
                })

            updated = existing is not None
            if updated:
                if remediation['status'] == 'remediation_pending' and existing != remediation:
                    raise ValidationError({'executionId': 'A ação pendente já foi registrada com outro conteúdo.'})
                if existing == remediation:
                    return Response({
                        'diagnosticId': diagnostico.id,
                        'created': False,
                        'duplicate': True,
                        'updated': False,
                        'remediation': existing,
                        'remediationsCount': len(remediations),
                    })
                remediations[existing_index] = remediation
            else:
                remediations.append(remediation)
            resultado['remediations'] = remediations
            diagnostico.resultado_tecnico = resultado
            diagnostico.save(update_fields=['resultado_tecnico'])
            projected_status = {
                'remediation_pending': 'remediation_pending',
                'resolved': 'resolved',
                'failed': 'verification_failed' if (
                    remediation.get('actionDispatched') or not remediation.get('actionId')
                ) else 'open',
                'not_verified': 'verification_failed',
                'verification_failed': 'verification_failed',
                'inconclusive': 'verification_failed',
                'canceled': 'open',
                'device_disconnected': 'verification_failed' if remediation.get('actionDispatched') else 'open',
                'not_authorized': 'verification_failed' if remediation.get('actionDispatched') else 'open',
                'not_supported': 'verification_failed' if remediation.get('actionDispatched') else 'open',
            }[remediation['status']]
            finding_query = SecurityFinding.objects.filter(diagnostico=diagnostico)
            if remediation.get('projectionId'):
                finding_query = finding_query.filter(pk=remediation['projectionId'])
            else:
                finding_query = finding_query.filter(finding_id=remediation['findingId'])
            finding_query.update(status=projected_status, updated_at=timezone.now())

        return Response({
            'diagnosticId': diagnostico.id,
            'created': not updated,
            'duplicate': False,
            'updated': updated,
            'remediation': remediation,
            'remediationsCount': len(remediations),
        }, status=status.HTTP_200_OK if updated else status.HTTP_201_CREATED)


class SecurityFindingViewSet(viewsets.ReadOnlyModelViewSet):
    http_method_names = ['get', 'head', 'options']

    def get_serializer_class(self):
        return SecurityFindingDetailSerializer if self.action == 'retrieve' else SecurityFindingSummarySerializer

    def get_queryset(self):
        queryset = (
            SecurityFinding.objects
            .filter(diagnostico__usuario=self.request.user)
            .select_related('diagnostico', 'diagnostico__cliente')
            .order_by('-diagnostico__finalizado_em', '-id')
        )
        diagnostico = self.request.query_params.get('diagnostico')
        severity = self.request.query_params.get('severity')
        category = self.request.query_params.get('category')
        finding_status = self.request.query_params.get('status')
        rule_id = self.request.query_params.get('rule_id')

        if diagnostico:
            if not diagnostico.isdigit():
                raise ValidationError({'diagnostico': 'Informe um diagnóstico válido.'})
            queryset = queryset.filter(diagnostico_id=int(diagnostico))
        if severity:
            allowed = {choice[0] for choice in SecurityFinding.SEVERITY_CHOICES}
            if severity not in allowed:
                raise ValidationError({'severity': 'Severidade inválida.'})
            queryset = queryset.filter(severity=severity)
        if category:
            if len(category) > 100:
                raise ValidationError({'category': 'Categoria inválida.'})
            queryset = queryset.filter(category=category)
        if finding_status:
            allowed = {choice[0] for choice in SecurityFinding.STATUS_CHOICES}
            if finding_status not in allowed:
                raise ValidationError({'status': 'Status de finding inválido.'})
            queryset = queryset.filter(status=finding_status)
        if rule_id:
            if len(rule_id) > 200:
                raise ValidationError({'rule_id': 'Rule ID inválido.'})
            queryset = queryset.filter(rule_id=rule_id)
        return queryset
