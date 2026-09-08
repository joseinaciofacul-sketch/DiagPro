"""SimpleJWT-compatible views with explicit abuse protection."""
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .throttling import LoginAccountRateThrottle, LoginIPRateThrottle, RefreshIPRateThrottle


class ThrottledTokenObtainPairView(TokenObtainPairView):
    throttle_classes = [LoginIPRateThrottle, LoginAccountRateThrottle]


class ThrottledTokenRefreshView(TokenRefreshView):
    throttle_classes = [RefreshIPRateThrottle]
