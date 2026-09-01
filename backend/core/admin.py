from django.contrib import admin
from .models import (
    Empresa, Cliente, Dispositivo, Analise, Relatorio, Plano, Licenca,
    Pagamento, SecurityFinding,
)

admin.site.register(Empresa)
admin.site.register(Cliente)
admin.site.register(Dispositivo)
admin.site.register(Analise)
admin.site.register(Relatorio)


@admin.register(Plano)
class PlanoAdmin(admin.ModelAdmin):
    list_display = ('nome', 'slug', 'ativo', 'preco_mensal', 'moeda')
    list_filter = ('ativo', 'scanner_completo', 'remediacao', 'relatorios', 'visao_gerencial')
    search_fields = ('nome', 'slug')
    prepopulated_fields = {'slug': ('nome',)}


@admin.register(Licenca)
class LicencaAdmin(admin.ModelAdmin):
    list_display = ('usuario', 'plano', 'status_efetivo_admin', 'inicio', 'fim', 'renovacao_automatica')
    list_filter = ('status', 'renovacao_automatica', 'plano')
    search_fields = ('usuario__username', 'empresa__nome', 'external_subscription_id')
    readonly_fields = ('serial', 'inicio', 'atualizado_em')
    fields = (
        'usuario', 'empresa', 'plano', 'status', 'inicio', 'fim',
        'renovacao_automatica', 'provider', 'external_subscription_id',
        'serial', 'atualizado_em',
    )

    @admin.display(description='Status efetivo')
    def status_efetivo_admin(self, obj):
        return obj.status_efetivo or 'Não definido'


@admin.register(Pagamento)
class PagamentoAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'usuario', 'plano', 'status', 'valor_esperado', 'moeda',
        'sandbox', 'criado_em', 'ativado_em',
    )
    list_filter = ('status', 'sandbox', 'plano')
    search_fields = (
        'usuario__username', 'external_reference', 'external_preference_id',
        'external_payment_id',
    )
    readonly_fields = (
        'usuario', 'plano', 'provider', 'external_reference', 'external_preference_id', 'external_payment_id',
        'status', 'provider_status', 'provider_status_detail', 'valor_esperado', 'moeda',
        'checkout_url', 'sandbox', 'webhook_count', 'ultimo_webhook_request_id',
        'erro_codigo', 'pago_em', 'ativado_em', 'criado_em', 'atualizado_em',
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(SecurityFinding)
class SecurityFindingAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'diagnostico', 'rule_id', 'severity', 'category', 'status',
        'evidence_confidence', 'score_contribution', 'created_at',
    )
    list_filter = ('severity', 'category', 'status', 'evidence_confidence')
    search_fields = (
        'rule_id', 'finding_id', 'subject_id', 'diagnostico__serial',
        'diagnostico__usuario__username',
    )
    list_select_related = ('diagnostico', 'diagnostico__usuario')
    readonly_fields = (
        'diagnostico', 'finding_id', 'rule_id', 'category', 'subject_type',
        'subject_id', 'title', 'summary', 'severity', 'evidence_confidence',
        'recommendation', 'remediation_type', 'remediation_available', 'evidence',
        'score_contribution', 'scorer_version', 'created_at', 'updated_at',
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
