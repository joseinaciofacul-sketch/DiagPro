"""Google OpenID Connect helpers with no provider secrets in responses or logs."""
from hashlib import sha256
import base64
import secrets

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from google.auth.exceptions import GoogleAuthError, TransportError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token
import requests

from .models import ExternalIdentity


GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
GOOGLE_ISSUERS = {'accounts.google.com', 'https://accounts.google.com'}


class BoundedGoogleRequest(GoogleRequest):
    def __call__(self, *args, **kwargs):
        kwargs['timeout'] = 10
        kwargs['allow_redirects'] = False
        return super().__call__(*args, **kwargs)


class GoogleOAuthError(Exception):
    code = 'google_auth_failed'


class GoogleOAuthUnavailable(GoogleOAuthError):
    code = 'google_unavailable'


class GoogleOAuthRejected(GoogleOAuthError):
    code = 'invalid_google_token'


class GoogleEmailUnverified(GoogleOAuthError):
    code = 'email_not_verified'


class GoogleAccountLinkRequired(GoogleOAuthError):
    code = 'account_link_required'


class GoogleAccountDisabled(GoogleOAuthError):
    code = 'account_not_authorized'


def token_urlsafe(size=32):
    return secrets.token_urlsafe(size)


def token_hash(value):
    return sha256(value.encode('utf-8')).hexdigest()


def pkce_challenge(verifier):
    digest = sha256(verifier.encode('ascii')).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b'=').decode('ascii')


def exchange_and_verify_google_code(*, code, code_verifier, expected_nonce):
    try:
        response = requests.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                'code': code,
                'client_id': settings.GOOGLE_CLIENT_ID,
                'client_secret': settings.GOOGLE_CLIENT_SECRET,
                'redirect_uri': settings.GOOGLE_OAUTH_REDIRECT_URI,
                'grant_type': 'authorization_code',
                'code_verifier': code_verifier,
            },
            timeout=10,
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise GoogleOAuthUnavailable from exc

    if response.status_code == 429 or response.status_code >= 500:
        raise GoogleOAuthUnavailable
    if response.status_code != 200:
        raise GoogleOAuthRejected
    try:
        raw_id_token = response.json().get('id_token')
    except (ValueError, AttributeError) as exc:
        raise GoogleOAuthRejected from exc
    if not isinstance(raw_id_token, str) or not raw_id_token:
        raise GoogleOAuthRejected

    try:
        claims = id_token.verify_oauth2_token(
            raw_id_token,
            BoundedGoogleRequest(),
            settings.GOOGLE_CLIENT_ID,
        )
    except TransportError as exc:
        raise GoogleOAuthUnavailable from exc
    except (GoogleAuthError, ValueError, TypeError) as exc:
        raise GoogleOAuthRejected from exc

    if claims.get('iss') not in GOOGLE_ISSUERS:
        raise GoogleOAuthRejected
    nonce = claims.get('nonce')
    if not isinstance(nonce, str) or not nonce.isascii() or not secrets.compare_digest(nonce, expected_nonce):
        error = GoogleOAuthRejected()
        error.code = 'invalid_nonce'
        raise error
    if claims.get('email_verified') is not True:
        raise GoogleEmailUnverified

    subject = claims.get('sub')
    email = claims.get('email')
    if not isinstance(subject, str) or not subject or len(subject) > 255:
        raise GoogleOAuthRejected
    if not isinstance(email, str) or '@' not in email or len(email) > 254:
        raise GoogleOAuthRejected
    return {
        'subject': subject,
        'email': email.strip().casefold(),
        'name': str(claims.get('name') or '').strip()[:150],
    }


@transaction.atomic
def resolve_google_user(identity):
    User = get_user_model()
    external = (
        ExternalIdentity.objects.select_related('user')
        .filter(provider=ExternalIdentity.PROVIDER_GOOGLE, provider_user_id=identity['subject'])
        .first()
    )
    if external:
        if not external.user.is_active:
            raise GoogleAccountDisabled
        return external.user, False

    # Igualdade de e-mail, isoladamente, nunca autoriza vínculo com uma conta já existente.
    if User.objects.filter(email__iexact=identity['email']).exists():
        raise GoogleAccountLinkRequired

    base_username = f"google_{sha256(identity['subject'].encode('utf-8')).hexdigest()[:24]}"
    username = base_username
    suffix = 0
    while User.objects.filter(username=username).exists():
        suffix += 1
        username = f'{base_username[:140]}_{suffix}'

    user = User(username=username, email=identity['email'], first_name=identity['name'])
    user.set_unusable_password()
    user.save()
    ExternalIdentity.objects.create(
        user=user,
        provider=ExternalIdentity.PROVIDER_GOOGLE,
        provider_user_id=identity['subject'],
    )
    return user, True
