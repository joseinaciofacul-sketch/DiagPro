from django.contrib import admin
from .models import Empresa, Cliente, Dispositivo, Analise, Relatorio, Licenca

admin.site.register(Empresa)
admin.site.register(Cliente)
admin.site.register(Dispositivo)
admin.site.register(Analise)
admin.site.register(Relatorio)
admin.site.register(Licenca)
# Register your models here.
