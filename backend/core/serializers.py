from rest_framework import serializers
from django.contrib.auth import password_validation
from django.contrib.auth import get_user_model
from django.db import transaction

from .models import (
    Empresa, Cliente, Dispositivo, Analise, Relatorio, Plano, Licenca,
    Pagamento, Diagnostico, SecurityFinding,
)
from .security_projection import build_finding_models, validate_security_snapshot


SENSITIVE_API_KEYS = frozenset({'confirmationtoken', 'rawtoken', 'tokenhash', 'token'})


def _normalized_key(key):
    return ''.join(character for character in str(key).casefold() if character.isalnum())


def redact_sensitive_api_values(value):
    """Return an API-safe copy without confirmation secrets or internal hashes."""
    if isinstance(value, dict):
        return {
            key: redact_sensitive_api_values(child)
            for key, child in value.items()
            if _normalized_key(key) not in SENSITIVE_API_KEYS
        }
    if isinstance(value, list):
        return [redact_sensitive_api_values(item) for item in value]
    return value


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
        diagnosticos = getattr(cliente, 'owned_diagnosticos', None)
        if diagnosticos is None:
            diagnosticos = (
                cliente.diagnosticos
                .filter(usuario=cliente.usuario)
                .prefetch_related('security_findings')
            )
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
                'security_risk_score': item.security_risk_score,
                'security_risk_level': item.security_risk_level,
                'security_risk_status': item.security_risk_status,
                'security_risk_version': item.security_risk_version,
                'security_findings_count': len(item.security_findings.all()),
            }
            for item in diagnosticos
        ]


class DispositivoSerializer(serializers.ModelSerializer):
    cliente = serializers.PrimaryKeyRelatedField(queryset=Cliente.objects.none())

    class Meta:
        model = Dispositivo
        fields = [
            'id', 'cliente', 'tipo', 'fabricante', 'modelo', 'numero_serie',
            'sistema_operacional', 'data_cadastro',
        ]
        read_only_fields = ['id', 'data_cadastro']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            self.fields['cliente'].queryset = Cliente.objects.filter(usuario=request.user)


class AnaliseSerializer(serializers.ModelSerializer):
    dispositivo = serializers.PrimaryKeyRelatedField(queryset=Dispositivo.objects.none())
    tecnico = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Analise
        fields = [
            'id', 'dispositivo', 'tecnico', 'score_geral', 'score_seguranca',
            'score_bateria', 'score_armazenamento', 'score_performance',
            'score_sistema', 'dados_brutos', 'resumo_ia', 'data_analise',
        ]
        read_only_fields = ['id', 'tecnico', 'data_analise']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            self.fields['dispositivo'].queryset = Dispositivo.objects.filter(
                cliente__usuario=request.user,
            )


class RelatorioSerializer(serializers.ModelSerializer):
    analise = serializers.PrimaryKeyRelatedField(queryset=Analise.objects.none())

    class Meta:
        model = Relatorio
        fields = ['id', 'analise', 'qr_code_token', 'arquivo_pdf', 'data_geracao']
        read_only_fields = ['id', 'qr_code_token', 'arquivo_pdf', 'data_geracao']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            self.fields['analise'].queryset = Analise.objects.filter(
                dispositivo__cliente__usuario=request.user,
            )

    def validate_analise(self, value):
        existing = Relatorio.objects.filter(analise=value)
        if self.instance is not None:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError('Esta análise já possui relatório.')
        return value


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
        choices=[
            'remediation_pending', 'executing', 'verifying', 'resolved',
            'verification_failed', 'failed', 'not_verified', 'canceled',
            'device_disconnected', 'not_authorized', 'not_supported', 'inconclusive',
        ],
    )
    at = serializers.DateTimeField()


class RemediationVerificationSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=['verified', 'not_verified'])
    installed = serializers.BooleanField(allow_null=True)
    source = serializers.CharField(required=False, allow_blank=False, max_length=80)
    user = serializers.IntegerField(required=False, min_value=0)
    reason = serializers.CharField(required=False, allow_blank=False, max_length=120)


class RemediationDeviceSerializer(serializers.Serializer):
    serial = serializers.RegexField(regex=r'^[A-Za-z0-9._:-]{1,128}$', max_length=128)
    manufacturer = serializers.CharField(required=False, allow_null=True, allow_blank=True, max_length=120)
    model = serializers.CharField(required=False, allow_null=True, allow_blank=True, max_length=120)


class RemediationConfirmationSerializer(serializers.Serializer):
    tokenId = serializers.UUIDField()
    tokenHash = serializers.RegexField(regex=r'^[a-f0-9]{64}$', max_length=64)
    expiresAt = serializers.DateTimeField()


class RemediationAuditSerializer(serializers.Serializer):
    executionId = serializers.UUIDField()
    actionId = serializers.UUIDField(required=False)
    projectionId = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    findingId = serializers.CharField(max_length=400)
    action = serializers.ChoiceField(choices=[
        'uninstall_user_app', 'manual_review', 'manual_security_setting',
        'manual_device_admin_review', 'manual_accessibility_review',
        'manual_overlay_review', 'rescan', 'no_action',
    ])
    device = RemediationDeviceSerializer(required=False)
    androidUser = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    packageName = serializers.RegexField(
        regex=r'^[A-Za-z][A-Za-z0-9_.-]{1,254}$',
        max_length=255,
        required=False,
        allow_null=True,
    )
    preview = serializers.JSONField(required=False)
    confirmation = RemediationConfirmationSerializer(required=False)
    startedAt = serializers.DateTimeField()
    finishedAt = serializers.DateTimeField(required=False, allow_null=True)
    status = serializers.ChoiceField(choices=[
        'remediation_pending', 'resolved', 'verification_failed', 'failed',
        'not_verified', 'canceled', 'device_disconnected', 'not_authorized',
        'not_supported', 'inconclusive',
    ])
    transitions = RemediationTransitionSerializer(many=True, allow_empty=False)
    verification = RemediationVerificationSerializer()
    logicalCommand = serializers.CharField(required=False, allow_null=True, max_length=600)
    actionDispatched = serializers.BooleanField(required=False, default=False)
    adbResult = serializers.JSONField(required=False, allow_null=True)
    error = serializers.JSONField(required=False, allow_null=True)

    @staticmethod
    def _contains_raw_token(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if _normalized_key(key) in {'confirmationtoken', 'rawtoken', 'token'}:
                    return True
                if RemediationAuditSerializer._contains_raw_token(child):
                    return True
        if isinstance(value, list):
            return any(RemediationAuditSerializer._contains_raw_token(item) for item in value)
        return False

    def validate(self, attrs):
        forbidden_owner_fields = {'usuario', 'user', 'diagProUser', 'diagnosticId'} & set(self.initial_data)
        if forbidden_owner_fields:
            raise serializers.ValidationError({
                'campos': 'O usuário e o diagnóstico da auditoria são definidos pelo servidor.',
            })
        if self._contains_raw_token(self.initial_data):
            raise serializers.ValidationError({'confirmation': 'O token bruto de confirmação não pode ser persistido.'})

        package_name = attrs.get('packageName')
        if attrs['action'] == 'uninstall_user_app' and (not package_name or '.' not in package_name):
            raise serializers.ValidationError({'packageName': 'Package name inválido.'})
        if package_name and '.' not in package_name:
            raise serializers.ValidationError({'packageName': 'Package name inválido.'})

        finished_at = attrs.get('finishedAt')
        is_pending = attrs['status'] == 'remediation_pending'
        if is_pending and finished_at is not None:
            raise serializers.ValidationError({'finishedAt': 'A remediação pendente ainda não possui término.'})
        if not is_pending and finished_at is None:
            raise serializers.ValidationError({'finishedAt': 'O resultado final exige horário de término.'})
        if finished_at is not None and finished_at < attrs['startedAt']:
            raise serializers.ValidationError({'finishedAt': 'O término não pode ser anterior ao início.'})

        transitions = attrs['transitions']
        stage6_payload = any(key in attrs for key in ['actionId', 'preview', 'confirmation', 'device', 'androidUser'])
        allowed_first = {'remediation_pending'} if stage6_payload else {'remediation_pending', 'executing'}
        if transitions[0]['status'] not in allowed_first:
            raise serializers.ValidationError({'transitions': 'A primeira transição operacional deve ser remediation_pending.'})
        if transitions[-1]['status'] != attrs['status']:
            raise serializers.ValidationError({'transitions': 'A transição final deve coincidir com o resultado.'})
        transition_times = [item['at'] for item in transitions]
        if transition_times != sorted(transition_times):
            raise serializers.ValidationError({'transitions': 'As transições devem estar em ordem cronológica.'})
        if transition_times[0] < attrs['startedAt'] or (finished_at and transition_times[-1] > finished_at):
            raise serializers.ValidationError({'transitions': 'As transições devem estar dentro do período da execução.'})

        verification = attrs['verification']
        if attrs['status'] == 'resolved' and not (
            verification['status'] == 'verified' and verification['installed'] is False
        ):
            raise serializers.ValidationError({'verification': 'Resolved exige ausência verificada do pacote.'})
        if attrs['status'] == 'not_verified' and verification['status'] != 'not_verified':
            raise serializers.ValidationError({'verification': 'not_verified exige verificação indisponível.'})
        if attrs['status'] == 'verification_failed' and not (
            verification['status'] == 'verified' and verification['installed'] is True
        ):
            raise serializers.ValidationError({'verification': 'verification_failed exige pacote ainda instalado.'})
        if verification['status'] == 'verified' and verification['installed'] is None:
            raise serializers.ValidationError({'verification': 'Verificação concluída exige o estado installed.'})

        if stage6_payload:
            required = ['actionId', 'device', 'androidUser', 'preview', 'confirmation']
            missing = [field for field in required if field not in attrs]
            if missing:
                raise serializers.ValidationError({'campos': f'Campos operacionais ausentes: {", ".join(missing)}.'})
            if attrs['actionId'] != attrs['executionId']:
                raise serializers.ValidationError({'actionId': 'actionId deve coincidir com executionId.'})
            diagnostico = self.context.get('diagnostico')
            if attrs['device']['serial'] != diagnostico.serial:
                raise serializers.ValidationError({'device': 'O dispositivo não corresponde ao diagnóstico.'})
            preview = attrs['preview']
            if not isinstance(preview, dict):
                raise serializers.ValidationError({'preview': 'Preview operacional inválido.'})
            if attrs['action'] == 'uninstall_user_app':
                if preview.get('app', {}).get('type') != 'user':
                    raise serializers.ValidationError({'preview': 'Uninstall exige aplicativo de usuário no preview.'})
                if preview.get('app', {}).get('packageName') != package_name:
                    raise serializers.ValidationError({'preview': 'O pacote do preview não corresponde à ação.'})
                if preview.get('androidUser') != attrs['androidUser']:
                    raise serializers.ValidationError({'preview': 'O usuário Android do preview não corresponde à ação.'})
                expected_command = f"pm uninstall --user {attrs['androidUser']} {package_name}"
                if attrs.get('logicalCommand') != expected_command:
                    raise serializers.ValidationError({'logicalCommand': 'O comando lógico de remoção é inválido.'})

        diagnostico = self.context.get('diagnostico')
        resultado = diagnostico.resultado_tecnico if diagnostico else {}
        security = resultado.get('security') if isinstance(resultado, dict) else None
        findings = security.get('findings', []) if isinstance(security, dict) else []
        actions = security.get('remediationActions', []) if isinstance(security, dict) else []
        projected_finding = None
        projection_id = attrs.get('projectionId')
        if projection_id:
            projected_finding = diagnostico.security_findings.filter(pk=projection_id).first()
            if projected_finding is None or projected_finding.finding_id != attrs['findingId']:
                raise serializers.ValidationError({'projectionId': 'SecurityFinding não pertence ao diagnóstico informado.'})

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
        if finding is None and projected_finding is None:
            raise serializers.ValidationError({'findingId': 'Finding não pertence ao diagnóstico informado.'})
        expected_package = finding.get('packageName') if finding else (
            projected_finding.subject_id if projected_finding.subject_type == 'app' else None
        )
        if expected_package != package_name:
            raise serializers.ValidationError({'packageName': 'O pacote não corresponde ao finding.'})
        if planned_action is None or planned_action.get('availability') != 'available':
            raise serializers.ValidationError({'action': 'A ação não estava disponível neste diagnóstico.'})
        if planned_action.get('packageName') != attrs['packageName']:
            raise serializers.ValidationError({'packageName': 'O pacote não corresponde à ação planejada.'})
        return attrs


class SecurityFindingSummarySerializer(serializers.ModelSerializer):
    diagnostico = serializers.PrimaryKeyRelatedField(read_only=True)
    diagnosticFinishedAt = serializers.DateTimeField(
        source='diagnostico.finalizado_em',
        read_only=True,
    )
    projection_id = serializers.IntegerField(source='id', read_only=True)
    id = serializers.CharField(source='finding_id', read_only=True)
    ruleId = serializers.CharField(source='rule_id', read_only=True)
    subjectType = serializers.CharField(source='subject_type', read_only=True)
    subjectId = serializers.CharField(source='subject_id', read_only=True)
    packageName = serializers.SerializerMethodField()
    description = serializers.CharField(source='summary', read_only=True)
    evidenceConfidence = serializers.CharField(source='evidence_confidence', read_only=True)
    scoreContribution = serializers.DecimalField(
        source='score_contribution',
        max_digits=5,
        decimal_places=2,
        read_only=True,
        allow_null=True,
    )
    scorerVersion = serializers.CharField(source='scorer_version', read_only=True, allow_null=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)
    remediation = serializers.SerializerMethodField()

    class Meta:
        model = SecurityFinding
        fields = [
            'projection_id', 'diagnostico', 'diagnosticFinishedAt', 'id', 'ruleId',
            'category', 'subjectType', 'subjectId', 'packageName', 'title',
            'summary', 'description', 'severity',
            'evidenceConfidence', 'evidence', 'status', 'recommendation',
            'remediation', 'scoreContribution', 'scorerVersion', 'createdAt', 'updatedAt',
        ]
        read_only_fields = fields

    def get_packageName(self, finding):
        return finding.subject_id if finding.subject_type == 'app' else None

    def get_remediation(self, finding):
        return {
            'type': finding.remediation_type or 'none',
            'available': finding.remediation_available,
        }


class SecurityFindingDetailSerializer(SecurityFindingSummarySerializer):
    device = serializers.SerializerMethodField()
    latestRemediation = serializers.SerializerMethodField()

    class Meta(SecurityFindingSummarySerializer.Meta):
        fields = SecurityFindingSummarySerializer.Meta.fields + [
            'device', 'latestRemediation',
        ]

    def get_device(self, finding):
        diagnostico = finding.diagnostico
        return {
            'serial': diagnostico.serial,
            'manufacturer': diagnostico.fabricante,
            'model': diagnostico.modelo,
            'androidVersion': diagnostico.versao_android,
            'sdk': diagnostico.sdk,
            'securityPatch': diagnostico.security_patch,
        }

    def get_latestRemediation(self, finding):
        resultado = finding.diagnostico.resultado_tecnico
        remediations = resultado.get('remediations', []) if isinstance(resultado, dict) else []
        matches = [
            item for item in remediations
            if isinstance(item, dict) and item.get('findingId') == finding.finding_id
        ]
        if not matches:
            return None
        return redact_sensitive_api_values(matches[-1])


class DiagnosticoSerializer(serializers.ModelSerializer):
    usuario = serializers.PrimaryKeyRelatedField(read_only=True)
    cliente = ClienteResumoSerializer(read_only=True)
    security_findings = SecurityFindingSummarySerializer(many=True, read_only=True)
    security_findings_count = serializers.SerializerMethodField()
    security_projection_available = serializers.SerializerMethodField()

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
            'scan_id',
            'modo',
            'modulos',
            'iniciado_em',
            'finalizado_em',
            'health_available',
            'health_score',
            'health_label',
            'health_explanation',
            'security_risk_score',
            'security_risk_level',
            'security_risk_status',
            'security_risk_version',
            'security_schema_version',
            'security_projection_available',
            'security_findings_count',
            'security_findings',
            'bateria',
            'armazenamento',
            'memoria',
            'apps',
            'warnings',
            'stages',
            'resultado_tecnico',
            'criado_em',
        ]
        read_only_fields = [
            'id', 'usuario', 'cliente', 'scan_id', 'security_risk_score',
            'security_risk_level', 'security_risk_status', 'security_risk_version',
            'security_schema_version', 'security_projection_available',
            'security_findings_count', 'security_findings', 'criado_em',
        ]
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
        if 'remediations' in value:
            remediations = value['remediations']
            if not isinstance(remediations, list) or remediations:
                raise serializers.ValidationError(
                    'Um diagnóstico novo não pode criar histórico de remediação.'
                )
        scan_status = value.get('status')
        legacy_completed_result = scan_status is None and bool(value.get('finishedAt'))
        if scan_status not in {'completed', 'partial'} and not legacy_completed_result:
            raise serializers.ValidationError(
                'Somente resultados concluídos ou concluídos parcialmente podem ser persistidos.'
            )
        self._security_projection = validate_security_snapshot(value)
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs['finalizado_em'] < attrs['iniciado_em']:
            raise serializers.ValidationError({'finalizado_em': 'A conclusão não pode ser anterior ao início.'})
        if attrs.get('health_available') is True and attrs.get('health_score') is None:
            raise serializers.ValidationError({'health_score': 'Informe o score quando ele estiver disponível.'})
        return attrs

    def get_security_projection(self):
        projection = getattr(self, '_security_projection', None)
        if projection is None:
            projection = validate_security_snapshot(self.validated_data['resultado_tecnico'])
            self._security_projection = projection
        return projection

    def get_security_findings_count(self, diagnostico):
        return len(diagnostico.security_findings.all())

    def get_security_projection_available(self, diagnostico):
        return bool(
            diagnostico.security_schema_version
            or diagnostico.security_risk_status is not None
            or self.get_security_findings_count(diagnostico) > 0
        )

    def to_representation(self, instance):
        return redact_sensitive_api_values(super().to_representation(instance))

    def create(self, validated_data):
        projection = self.get_security_projection()
        risk = projection.get('risk') or {}
        projected_fields = {
            'scan_id': projection.get('scan_id'),
            'security_schema_version': projection.get('schema_version'),
            'security_risk_score': risk.get('score'),
            'security_risk_level': risk.get('level'),
            'security_risk_status': risk.get('status'),
            'security_risk_version': risk.get('version'),
        }
        with transaction.atomic():
            diagnostico = Diagnostico.objects.create(**validated_data, **projected_fields)
            findings = build_finding_models(diagnostico, projection)
            if findings:
                SecurityFinding.objects.bulk_create(findings)
        return diagnostico
