from rest_framework.routers import DefaultRouter

from .views import (
    EmpresaViewSet,
    ClienteViewSet,
    DispositivoViewSet,
    AnaliseViewSet,
    RelatorioViewSet,
    LicencaViewSet,
    DiagnosticoViewSet,
)

router = DefaultRouter()
router.register(r'empresas', EmpresaViewSet)
router.register(r'clientes', ClienteViewSet, basename='cliente')
router.register(r'dispositivos', DispositivoViewSet)
router.register(r'analises', AnaliseViewSet)
router.register(r'relatorios', RelatorioViewSet)
router.register(r'licencas', LicencaViewSet)
router.register(r'diagnosticos', DiagnosticoViewSet, basename='diagnostico')

urlpatterns = router.urls
