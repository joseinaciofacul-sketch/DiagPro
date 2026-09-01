import json
import re
from decimal import Decimal
from uuid import UUID

from rest_framework import serializers

from .models import SecurityFinding


MAX_TECHNICAL_RESULT_BYTES = 10 * 1024 * 1024
MAX_FINDINGS_PER_DIAGNOSTIC = 500
MAX_EVIDENCE_ITEMS_PER_FINDING = 64
MAX_EVIDENCE_BYTES_PER_FINDING = 64 * 1024

VERSION_PATTERN = re.compile(r'^\d+(?:\.\d+){0,2}$')
RULE_ID_PATTERN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$')
CATEGORY_PATTERN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$')
PACKAGE_PATTERN = re.compile(r'^[A-Za-z][A-Za-z0-9_.-]{1,254}$')
SAFE_SUBJECT_PATTERN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:@/\-]{0,254}$')
FORBIDDEN_EVIDENCE_KEY_PARTS = {
    'password', 'passwd', 'credential', 'secret', 'access_token', 'refresh_token',
    'sms_body', 'message_body', 'contact_name', 'photo', 'image_content',
}


def _json_size(value):
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    except (TypeError, ValueError) as error:
        raise serializers.ValidationError('O conteúdo precisa ser JSON válido.') from error
    return len(encoded)


def _require_string(mapping, field, *, required=True):
    value = mapping.get(field)
    if value is None and not required:
        return
    if not isinstance(value, str):
        raise serializers.ValidationError({field: 'Este campo deve ser uma string.'})


class SecurityEvidenceSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=200, allow_blank=False)
    value = serializers.JSONField()
    source = serializers.CharField(max_length=120, allow_blank=False)
    quality = serializers.ChoiceField(choices=['low', 'medium', 'high'])
    observationId = serializers.CharField(required=False, max_length=300, allow_blank=False)

    def validate_key(self, value):
        normalized = value.casefold()
        if any(part in normalized for part in FORBIDDEN_EVIDENCE_KEY_PARTS):
            raise serializers.ValidationError('A evidência não pode identificar conteúdo pessoal ou credenciais.')
        if any(ord(character) < 32 for character in value):
            raise serializers.ValidationError('A chave da evidência contém caracteres inválidos.')
        return value


class FindingRemediationSerializer(serializers.Serializer):
    available = serializers.BooleanField()
    type = serializers.ChoiceField(choices=['none', 'manual_guidance', 'uninstall_user_app'])


class SecurityFindingPayloadSerializer(serializers.Serializer):
    id = serializers.CharField(required=False, max_length=400, allow_blank=False)
    ruleId = serializers.RegexField(regex=RULE_ID_PATTERN, max_length=200)
    category = serializers.RegexField(regex=CATEGORY_PATTERN, max_length=100)
    subjectType = serializers.ChoiceField(choices=['device', 'app'])
    subjectId = serializers.CharField(max_length=255, allow_blank=False)
    title = serializers.CharField(required=False, max_length=240, allow_blank=False)
    summary = serializers.CharField(required=False, max_length=2000, allow_blank=True)
    description = serializers.CharField(required=False, max_length=2000, allow_blank=True)
    severity = serializers.ChoiceField(choices=['info', 'low', 'medium', 'high', 'critical'])
    evidenceConfidence = serializers.ChoiceField(choices=['low', 'medium', 'high'])
    evidence = serializers.ListField(
        child=SecurityEvidenceSerializer(),
        allow_empty=False,
        max_length=MAX_EVIDENCE_ITEMS_PER_FINDING,
    )
    status = serializers.ChoiceField(
        required=False,
        default='open',
        choices=[choice[0] for choice in SecurityFinding.STATUS_CHOICES],
    )
    recommendation = serializers.CharField(required=False, max_length=4000, allow_blank=True)
    remediation = FindingRemediationSerializer(required=False)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        subject_id = attrs['subjectId']
        pattern = PACKAGE_PATTERN if attrs['subjectType'] == 'app' else SAFE_SUBJECT_PATTERN
        if not pattern.fullmatch(subject_id):
            raise serializers.ValidationError({'subjectId': 'O identificador do sujeito é inválido.'})
        if attrs['subjectType'] == 'app' and '.' not in subject_id:
            raise serializers.ValidationError({'subjectId': 'O packageName do aplicativo é inválido.'})
        if _json_size(attrs['evidence']) > MAX_EVIDENCE_BYTES_PER_FINDING:
            raise serializers.ValidationError({'evidence': 'As evidências do finding excedem o limite permitido.'})
        return attrs


class SecurityRiskFactorSerializer(serializers.Serializer):
    findingId = serializers.CharField(required=False, max_length=400, allow_blank=False)
    ruleId = serializers.RegexField(regex=RULE_ID_PATTERN, max_length=200)
    subjectType = serializers.ChoiceField(choices=['device', 'app'])
    subjectId = serializers.CharField(max_length=255, allow_blank=False)
    category = serializers.RegexField(regex=CATEGORY_PATTERN, max_length=100)
    severity = serializers.ChoiceField(choices=['info', 'low', 'medium', 'high', 'critical'])
    evidenceConfidence = serializers.ChoiceField(choices=['low', 'medium', 'high'])
    contribution = serializers.FloatField(min_value=0, max_value=100)


class SecurityRiskPayloadSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=['calculated', 'partial', 'not_calculated', 'insufficient_data'],
    )
    score = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=100)
    level = serializers.ChoiceField(
        required=False,
        allow_null=True,
        choices=['low', 'attention', 'moderate', 'elevated', 'very_high'],
    )
    version = serializers.RegexField(regex=VERSION_PATTERN, max_length=20)
    factors = SecurityRiskFactorSerializer(many=True, required=False)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        status = attrs['status']
        score = attrs.get('score')
        level = attrs.get('level')
        if status in {'calculated', 'partial'}:
            if score is None:
                raise serializers.ValidationError({'score': 'Um score numérico é obrigatório para este status.'})
            if level is None:
                raise serializers.ValidationError({'level': 'A classificação é obrigatória para este status.'})
            expected_level = next(
                threshold_level
                for minimum, threshold_level in (
                    (80, 'very_high'), (60, 'elevated'), (40, 'moderate'),
                    (20, 'attention'), (0, 'low'),
                )
                if score >= minimum
            )
            if level != expected_level:
                raise serializers.ValidationError({
                    'level': 'A classificação não corresponde ao intervalo do score informado.',
                })
        elif score is not None:
            raise serializers.ValidationError({'score': 'Este status não permite score numérico.'})
        elif level is not None:
            raise serializers.ValidationError({'level': 'Este status não permite classificação numérica.'})
        return attrs


def _strict_validate_payload_types(security, findings, risk):
    if not isinstance(findings, list):
        raise serializers.ValidationError({'security': {'findings': 'Findings deve ser uma lista.'}})
    if len(findings) > MAX_FINDINGS_PER_DIAGNOSTIC:
        raise serializers.ValidationError({'security': {'findings': 'O diagnóstico excede o limite de findings.'}})

    finding_string_fields = (
        'ruleId', 'category', 'subjectType', 'subjectId', 'severity', 'evidenceConfidence',
    )
    for index, finding in enumerate(findings):
        if not isinstance(finding, dict):
            raise serializers.ValidationError({'security': {'findings': {index: 'Cada finding deve ser um objeto.'}}})
        try:
            for field in finding_string_fields:
                _require_string(finding, field)
        except serializers.ValidationError as error:
            raise serializers.ValidationError({'security': {'findings': {index: error.detail}}}) from error
        if not isinstance(finding.get('evidence'), list):
            raise serializers.ValidationError({'security': {'findings': {index: {'evidence': 'Evidence deve ser uma lista.'}}}})
        for evidence_index, evidence in enumerate(finding['evidence']):
            if not isinstance(evidence, dict):
                raise serializers.ValidationError({
                    'security': {'findings': {index: {'evidence': {evidence_index: 'A evidência deve ser um objeto.'}}}},
                })

    if risk is None:
        return
    if not isinstance(risk, dict):
        raise serializers.ValidationError({'securityRisk': 'Security Risk deve ser um objeto.'})
    for field in ('status', 'version'):
        _require_string(risk, field)
    if risk.get('score') is not None and (isinstance(risk['score'], bool) or not isinstance(risk['score'], int)):
        raise serializers.ValidationError({'securityRisk': {'score': 'O score deve ser um número inteiro.'}})
    if risk.get('level') is not None and not isinstance(risk['level'], str):
        raise serializers.ValidationError({'securityRisk': {'level': 'A classificação deve ser uma string.'}})
    if 'factors' in risk and not isinstance(risk['factors'], list):
        raise serializers.ValidationError({'securityRisk': {'factors': 'Factors deve ser uma lista.'}})


def _validated_version(value, field_name):
    if value is None:
        return None
    if not isinstance(value, str) or not VERSION_PATTERN.fullmatch(value):
        raise serializers.ValidationError({field_name: 'A versão deve usar formato numérico, como 1.0.'})
    return value


def validate_security_snapshot(technical_result):
    if _json_size(technical_result) > MAX_TECHNICAL_RESULT_BYTES:
        raise serializers.ValidationError('O resultado técnico excede o limite de 10 MB.')

    security = technical_result.get('security')
    if security is not None and not isinstance(security, dict):
        raise serializers.ValidationError({'security': 'Security deve ser um objeto.'})
    security = security or {}
    findings = security.get('findings', [])
    top_level_risk = technical_result.get('securityRisk')
    nested_risk = security.get('securityRisk')
    if top_level_risk is not None and nested_risk is not None and top_level_risk != nested_risk:
        raise serializers.ValidationError({'securityRisk': 'As cópias do Security Risk são incoerentes.'})
    risk = top_level_risk if top_level_risk is not None else nested_risk
    _strict_validate_payload_types(security, findings, risk)

    finding_serializer = SecurityFindingPayloadSerializer(data=findings, many=True)
    finding_serializer.is_valid(raise_exception=True)
    validated_findings = []
    findings_by_key = {}
    finding_ids = set()
    for index, finding in enumerate(finding_serializer.validated_data):
        key = (finding['ruleId'], finding['subjectType'], finding['subjectId'])
        current = findings_by_key.get(key)
        if current is not None:
            if current != finding:
                raise serializers.ValidationError({
                    'security': {'findings': {index: 'Finding duplicado possui conteúdo conflitante.'}},
                })
            continue
        finding_id = finding.get('id') or f"{finding['ruleId']}:{finding['subjectId']}"
        if finding_id in finding_ids:
            raise serializers.ValidationError({
                'security': {'findings': {index: 'O identificador do finding está duplicado.'}},
            })
        finding_ids.add(finding_id)
        findings_by_key[key] = finding
        validated_findings.append(finding)

    validated_risk = None
    if risk is not None:
        risk_serializer = SecurityRiskPayloadSerializer(data=risk)
        risk_serializer.is_valid(raise_exception=True)
        validated_risk = risk_serializer.validated_data
        if validated_risk['status'] in {'calculated', 'partial'}:
            factors = validated_risk.get('factors') or []
            factors_by_id = {factor.get('findingId'): factor for factor in factors if factor.get('findingId')}
            factors_by_key = {
                (factor['ruleId'], factor['subjectType'], factor['subjectId']): factor
                for factor in factors
            }
            for finding in validated_findings:
                finding_id = finding.get('id') or f"{finding['ruleId']}:{finding['subjectId']}"
                factor = factors_by_id.get(finding_id) or factors_by_key.get(
                    (finding['ruleId'], finding['subjectType'], finding['subjectId']),
                )
                if factor is None:
                    raise serializers.ValidationError({
                        'securityRisk': {'factors': f'Falta o fator do finding {finding_id}.'},
                    })
                comparable_fields = {
                    'ruleId': 'ruleId', 'subjectType': 'subjectType', 'subjectId': 'subjectId',
                    'category': 'category', 'severity': 'severity',
                    'evidenceConfidence': 'evidenceConfidence',
                }
                if any(factor[factor_field] != finding[finding_field]
                       for factor_field, finding_field in comparable_fields.items()):
                    raise serializers.ValidationError({
                        'securityRisk': {'factors': f'O fator do finding {finding_id} é incoerente.'},
                    })

    schema_version = _validated_version(security.get('schemaVersion'), 'security.schemaVersion')
    scan_id = None
    if technical_result.get('scanId') is not None:
        try:
            scan_id = UUID(str(technical_result['scanId']))
        except (TypeError, ValueError, AttributeError) as error:
            raise serializers.ValidationError({'scanId': 'O identificador do scan deve ser um UUID válido.'}) from error

    return {
        'scan_id': scan_id,
        'schema_version': schema_version,
        'risk': validated_risk,
        'findings': validated_findings,
    }


def build_finding_models(diagnostico, projection):
    risk = projection.get('risk') or {}
    factors = risk.get('factors') or []
    factors_by_id = {factor.get('findingId'): factor for factor in factors if factor.get('findingId')}
    factors_by_key = {
        (factor['ruleId'], factor['subjectType'], factor['subjectId']): factor
        for factor in factors
    }
    rows = []
    for finding in projection.get('findings', []):
        finding_id = finding.get('id') or f"{finding['ruleId']}:{finding['subjectId']}"
        factor = factors_by_id.get(finding_id) or factors_by_key.get(
            (finding['ruleId'], finding['subjectType'], finding['subjectId']),
        )
        remediation = finding.get('remediation') or {}
        contribution = factor.get('contribution') if factor else None
        rows.append(SecurityFinding(
            diagnostico=diagnostico,
            finding_id=finding_id,
            rule_id=finding['ruleId'],
            category=finding['category'],
            subject_type=finding['subjectType'],
            subject_id=finding['subjectId'],
            title=finding.get('title') or finding['ruleId'],
            summary=finding.get('summary') or finding.get('description') or '',
            severity=finding['severity'],
            evidence_confidence=finding['evidenceConfidence'],
            status=finding.get('status', 'open'),
            recommendation=finding.get('recommendation', ''),
            remediation_type=remediation.get('type', ''),
            remediation_available=remediation.get('available', False),
            evidence=finding['evidence'],
            score_contribution=Decimal(str(contribution)).quantize(Decimal('0.01'))
            if contribution is not None else None,
            scorer_version=risk.get('version'),
        ))
    return rows
