from rest_framework.viewsets import ModelViewSet
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from django.db.models import Count, Max
from django.shortcuts import get_object_or_404

from .models import Empresa, Cliente, Dispositivo, Analise, Relatorio, Licenca, Diagnostico
from .serializers import (
    EmpresaSerializer,
    ClienteSerializer,
    DispositivoSerializer,
    AnaliseSerializer,
    RelatorioSerializer,
    LicencaSerializer,
    DiagnosticoSerializer,
)


class EmpresaViewSet(ModelViewSet):
    queryset = Empresa.objects.all()
    serializer_class = EmpresaSerializer


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
            .prefetch_related('diagnosticos')
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


class LicencaViewSet(ModelViewSet):
    queryset = Licenca.objects.all()
    serializer_class = LicencaSerializer


class DiagnosticoViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = DiagnosticoSerializer

    def get_queryset(self):
        return (
            Diagnostico.objects
            .filter(usuario=self.request.user)
            .select_related('cliente')
            .order_by('-finalizado_em', '-id')
        )

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)

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
