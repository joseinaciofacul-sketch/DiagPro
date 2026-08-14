from rest_framework.routers import DefaultRouter

from .views import (
    EmpresaViewSet,
    ClienteViewSet,
    DispositivoViewSet,
    AnaliseViewSet,
    RelatorioViewSet,
    LicencaViewSet,
)

router = DefaultRouter()
router.register(r'empresas', EmpresaViewSet)
router.register(r'clientes', ClienteViewSet)
router.register(r'dispositivos', DispositivoViewSet)
router.register(r'analises', AnaliseViewSet)
router.register(r'relatorios', RelatorioViewSet)
router.register(r'licencas', LicencaViewSet)

urlpatterns = router.urls
