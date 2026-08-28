from rest_framework import serializers
from .models import Empresa, Cliente, Dispositivo, Analise, Relatorio, Licenca, Diagnostico


class EmpresaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Empresa
        fields = '__all__'


class ClienteResumoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cliente
        fields = ['id', 'nome', 'telefone', 'email']


class ClienteSerializer(serializers.ModelSerializer):
    usuario = serializers.PrimaryKeyRelatedField(read_only=True)
    diagnosticos_count = serializers.IntegerField(read_only=True)
    dispositivos_count = serializers.IntegerField(read_only=True)
    ultimo_atendimento = serializers.DateTimeField(read_only=True, allow_null=True)
    diagnosticos = serializers.SerializerMethodField()

    class Meta:
        model = Cliente
        fields = [
            'id',
            'usuario',
            'nome',
            'telefone',
            'email',
            'documento',
            'observacoes',
            'diagnosticos_count',
            'dispositivos_count',
            'ultimo_atendimento',
            'diagnosticos',
            'criado_em',
            'atualizado_em',
        ]
        read_only_fields = [
            'id', 'usuario', 'diagnosticos_count', 'dispositivos_count',
            'ultimo_atendimento', 'diagnosticos', 'criado_em', 'atualizado_em',
        ]
        extra_kwargs = {'nome': {'required': True, 'allow_blank': False}}

    def get_diagnosticos(self, cliente):
        return [
            {
                'id': item.id,
                'finalizado_em': item.finalizado_em,
                'fabricante': item.fabricante,
                'modelo': item.modelo,
                'serial': item.serial,
                'modo': item.modo,
                'health_available': item.health_available,
                'health_score': item.health_score,
                'health_label': item.health_label,
            }
            for item in cliente.diagnosticos.all()
        ]


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


class DiagnosticoSerializer(serializers.ModelSerializer):
    usuario = serializers.PrimaryKeyRelatedField(read_only=True)
    cliente = ClienteResumoSerializer(read_only=True)

    class Meta:
        model = Diagnostico
        fields = [
            'id',
            'usuario',
            'cliente',
            'serial',
            'fabricante',
            'modelo',
            'versao_android',
            'sdk',
            'security_patch',
            'modo',
            'modulos',
            'iniciado_em',
            'finalizado_em',
            'health_available',
            'health_score',
            'health_label',
            'health_explanation',
            'bateria',
            'armazenamento',
            'memoria',
            'apps',
            'warnings',
            'stages',
            'resultado_tecnico',
            'criado_em',
        ]
        read_only_fields = ['id', 'usuario', 'cliente', 'criado_em']
        extra_kwargs = {
            'serial': {'required': True, 'allow_blank': False},
            'modulos': {'required': True},
            'iniciado_em': {'required': True},
            'finalizado_em': {'required': True},
            'health_available': {'required': True, 'allow_null': True},
            'resultado_tecnico': {'required': True},
        }

    def validate_serial(self, value):
        import re

        if not re.fullmatch(r'[A-Za-z0-9._:-]{1,128}', value):
            raise serializers.ValidationError('Serial de dispositivo inválido.')
        return value

    def validate_modulos(self, value):
        permitidos = {'system', 'apps', 'security', 'permissions', 'battery', 'storage', 'performance'}
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError('Informe ao menos um módulo executado.')
        if any(not isinstance(item, str) or item not in permitidos for item in value):
            raise serializers.ValidationError('A lista contém um módulo inválido.')
        if len(value) != len(set(value)):
            raise serializers.ValidationError('A lista de módulos não pode conter duplicatas.')
        return value

    def validate_warnings(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Warnings deve ser uma lista.')
        return value

    def validate_stages(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('Stages deve ser um objeto.')
        return value

    def validate_resultado_tecnico(self, value):
        if not isinstance(value, dict) or not value:
            raise serializers.ValidationError('O resultado técnico completo é obrigatório.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs['finalizado_em'] < attrs['iniciado_em']:
            raise serializers.ValidationError({'finalizado_em': 'A conclusão não pode ser anterior ao início.'})
        if attrs.get('health_available') is True and attrs.get('health_score') is None:
            raise serializers.ValidationError({'health_score': 'Informe o score quando ele estiver disponível.'})
        return attrs
