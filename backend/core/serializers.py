from rest_framework import serializers
from django.contrib.auth import password_validation
from django.contrib.auth import get_user_model
from .models import Empresa, Cliente, Dispositivo, Analise, Relatorio, Plano, Licenca, Pagamento, Diagnostico


class EmpresaSerializer(serializers.ModelSerializer):
    usuario = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Empresa
        fields = ['id', 'usuario', 'nome', 'cnpj', 'email', 'telefone', 'endereco', 'data_cadastro']
        read_only_fields = ['id', 'usuario', 'data_cadastro']
        extra_kwargs = {'nome': {'required': True, 'allow_blank': False}}

    def validate_cnpj(self, value):
        if not value:
            return None
        import re

        if len(re.sub(r'\D', '', value)) != 14 or not re.fullmatch(r'[0-9./-]+', value):
            raise serializers.ValidationError('Informe um CNPJ com 14 dígitos.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context.get('request')
        if self.instance is None and request and Empresa.objects.filter(usuario=request.user).exists():
            raise serializers.ValidationError('Este usuário já possui uma assistência configurada.')
        return attrs


class CurrentUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'is_staff']
        read_only_fields = ['id', 'username', 'is_staff']


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirm_new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_current_password(self, value):
        if not self.context['request'].user.check_password(value):
            raise serializers.ValidationError('A senha atual está incorreta.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs['new_password'] != attrs['confirm_new_password']:
            raise serializers.ValidationError({'confirm_new_password': 'A confirmação não corresponde à nova senha.'})
        password_validation.validate_password(attrs['new_password'], self.context['request'].user)
        return attrs

    def save(self, **kwargs):
        user = self.context['request'].user
        user.set_password(self.validated_data['new_password'])
        user.save(update_fields=['password'])
        return user


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


class PlanoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Plano
        fields = [
            'id', 'nome', 'slug', 'descricao', 'preco_mensal', 'moeda',
            'max_usuarios', 'max_dispositivos', 'max_diagnosticos_mes',
            'scanner_completo', 'remediacao', 'relatorios', 'visao_gerencial',
        ]


class LicencaSerializer(serializers.ModelSerializer):
    plano = PlanoSerializer(read_only=True)
    status_efetivo = serializers.CharField(read_only=True)
    valida = serializers.BooleanField(read_only=True)

    class Meta:
        model = Licenca
        fields = [
            'id', 'plano', 'status', 'status_efetivo', 'valida', 'inicio', 'fim',
            'renovacao_automatica', 'atualizado_em',
        ]
        read_only_fields = fields


class PagamentoSerializer(serializers.ModelSerializer):
    plano = PlanoSerializer(read_only=True)

    class Meta:
        model = Pagamento
        fields = [
            'id', 'plano', 'status', 'provider_status', 'provider_status_detail',
            'valor_esperado', 'moeda', 'checkout_url', 'sandbox', 'pago_em',
            'ativado_em', 'criado_em', 'atualizado_em',
        ]
        read_only_fields = fields


class CheckoutSerializer(serializers.Serializer):
    plano_id = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        unknown_fields = set(self.initial_data) - {'plano_id'}
        if unknown_fields:
            raise serializers.ValidationError({
                'campos': f'Campos não permitidos: {", ".join(sorted(unknown_fields))}.',
            })
        return attrs


class RemediationTransitionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=['executing', 'verifying', 'resolved', 'failed', 'not_verified'],
    )
    at = serializers.DateTimeField()


class RemediationVerificationSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=['verified', 'not_verified'])
    installed = serializers.BooleanField(allow_null=True)
    source = serializers.CharField(required=False, allow_blank=False, max_length=80)
    user = serializers.IntegerField(required=False, min_value=0)


class RemediationAuditSerializer(serializers.Serializer):
    executionId = serializers.UUIDField()
    findingId = serializers.CharField(max_length=300)
    action = serializers.ChoiceField(choices=['uninstall_user_app'])
    packageName = serializers.RegexField(
        regex=r'^[A-Za-z][A-Za-z0-9_.-]{1,254}$',
        max_length=255,
    )
    startedAt = serializers.DateTimeField()
    finishedAt = serializers.DateTimeField()
    status = serializers.ChoiceField(choices=['resolved', 'failed', 'not_verified'])
    transitions = RemediationTransitionSerializer(many=True, allow_empty=False)
    verification = RemediationVerificationSerializer()

    def validate(self, attrs):
        if '.' not in attrs['packageName']:
            raise serializers.ValidationError({'packageName': 'Package name inválido.'})
        if attrs['finishedAt'] < attrs['startedAt']:
            raise serializers.ValidationError({'finishedAt': 'O término não pode ser anterior ao início.'})

        transitions = attrs['transitions']
        if transitions[0]['status'] != 'executing':
            raise serializers.ValidationError({'transitions': 'A primeira transição deve ser executing.'})
        if transitions[-1]['status'] != attrs['status']:
            raise serializers.ValidationError({'transitions': 'A transição final deve coincidir com o resultado.'})
        transition_times = [item['at'] for item in transitions]
        if transition_times != sorted(transition_times):
            raise serializers.ValidationError({'transitions': 'As transições devem estar em ordem cronológica.'})
        if transition_times[0] < attrs['startedAt'] or transition_times[-1] > attrs['finishedAt']:
            raise serializers.ValidationError({'transitions': 'As transições devem estar dentro do período da execução.'})

        verification = attrs['verification']
        if attrs['status'] == 'resolved' and not (
            verification['status'] == 'verified' and verification['installed'] is False
        ):
            raise serializers.ValidationError({'verification': 'Resolved exige ausência verificada do pacote.'})
        if attrs['status'] == 'not_verified' and verification['status'] != 'not_verified':
            raise serializers.ValidationError({'verification': 'not_verified exige verificação indisponível.'})
        if verification['status'] == 'verified' and verification['installed'] is None:
            raise serializers.ValidationError({'verification': 'Verificação concluída exige o estado installed.'})

        diagnostico = self.context.get('diagnostico')
        resultado = diagnostico.resultado_tecnico if diagnostico else {}
        security = resultado.get('security') if isinstance(resultado, dict) else None
        findings = security.get('findings', []) if isinstance(security, dict) else []
        actions = security.get('remediationActions', []) if isinstance(security, dict) else []
        finding = next(
            (item for item in findings if isinstance(item, dict) and item.get('id') == attrs['findingId']),
            None,
        )
        planned_action = next(
            (
                item for item in actions
                if isinstance(item, dict)
                and item.get('findingId') == attrs['findingId']
                and item.get('type') == attrs['action']
            ),
            None,
        )
        if finding is None:
            raise serializers.ValidationError({'findingId': 'Finding não pertence ao diagnóstico informado.'})
        if finding.get('packageName') != attrs['packageName']:
            raise serializers.ValidationError({'packageName': 'O pacote não corresponde ao finding.'})
        if planned_action is None or planned_action.get('availability') != 'available':
            raise serializers.ValidationError({'action': 'A ação não estava disponível neste diagnóstico.'})
        if planned_action.get('packageName') != attrs['packageName']:
            raise serializers.ValidationError({'packageName': 'O pacote não corresponde à ação planejada.'})
        return attrs


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
