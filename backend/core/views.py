from rest_framework.viewsets import ModelViewSet

from .models import Empresa, Cliente, Dispositivo, Analise, Relatorio, Licenca
from .serializers import (
    EmpresaSerializer,
    ClienteSerializer,
    DispositivoSerializer,
    AnaliseSerializer,
    RelatorioSerializer,
    LicencaSerializer,
)


class EmpresaViewSet(ModelViewSet):
    queryset = Empresa.objects.all()
    serializer_class = EmpresaSerializer


class ClienteViewSet(ModelViewSet):
    queryset = Cliente.objects.all()
    serializer_class = ClienteSerializer


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
