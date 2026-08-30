from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    EmpresaViewSet,
    ClienteViewSet,
    DispositivoViewSet,
    AnaliseViewSet,
    RelatorioViewSet,
    LicencaViewSet,
    DiagnosticoViewSet,
    CurrentUserView,
    ChangePasswordView,
    PlanListView,
    CurrentSubscriptionView,
)

router = DefaultRouter()
router.register(r'empresas', EmpresaViewSet, basename='empresa')
router.register(r'clientes', ClienteViewSet, basename='cliente')
router.register(r'dispositivos', DispositivoViewSet)
router.register(r'analises', AnaliseViewSet)
router.register(r'relatorios', RelatorioViewSet)
router.register(r'licencas', LicencaViewSet, basename='licenca')
router.register(r'diagnosticos', DiagnosticoViewSet, basename='diagnostico')

urlpatterns = [
    path('me/', CurrentUserView.as_view(), name='current-user'),
    path('me/password/', ChangePasswordView.as_view(), name='change-password'),
    path('planos/', PlanListView.as_view(), name='plan-list'),
    path('assinatura/', CurrentSubscriptionView.as_view(), name='current-subscription'),
] + router.urls
