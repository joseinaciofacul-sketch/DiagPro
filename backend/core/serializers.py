from rest_framework import serializers
from .models import Empresa, Cliente, Dispositivo, Analise, Relatorio, Licenca


class EmpresaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Empresa
        fields = '__all__'


class ClienteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cliente
        fields = '__all__'


class DispositivoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dispositivo
        fields = '__all__'


class AnaliseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Analise
        fields = '__all__'


class RelatorioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Relatorio
        fields = '__all__'


class LicencaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Licenca
        fields = '__all__'
