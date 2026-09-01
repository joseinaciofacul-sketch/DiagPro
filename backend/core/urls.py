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
    SecurityFindingViewSet,
    CurrentUserView,
    ChangePasswordView,
    PlanListView,
    CurrentSubscriptionView,
    SubscriptionCheckoutView,
    MercadoPagoWebhookView,
)

router = DefaultRouter()
router.register(r'empresas', EmpresaViewSet, basename='empresa')
router.register(r'clientes', ClienteViewSet, basename='cliente')
router.register(r'dispositivos', DispositivoViewSet)
router.register(r'analises', AnaliseViewSet)
router.register(r'relatorios', RelatorioViewSet)
router.register(r'licencas', LicencaViewSet, basename='licenca')
router.register(r'diagnosticos', DiagnosticoViewSet, basename='diagnostico')
router.register(r'security/findings', SecurityFindingViewSet, basename='security-finding')

urlpatterns = [
    path('me/', CurrentUserView.as_view(), name='current-user'),
    path('me/password/', ChangePasswordView.as_view(), name='change-password'),
    path('planos/', PlanListView.as_view(), name='plan-list'),
    path('assinatura/', CurrentSubscriptionView.as_view(), name='current-subscription'),
    path('assinatura/checkout/', SubscriptionCheckoutView.as_view(), name='subscription-checkout'),
    path('pagamentos/mercadopago/webhook/', MercadoPagoWebhookView.as_view(), name='mercado-pago-webhook'),
] + router.urls
