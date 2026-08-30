from django.contrib import admin
from .models import Empresa, Cliente, Dispositivo, Analise, Relatorio, Plano, Licenca

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
