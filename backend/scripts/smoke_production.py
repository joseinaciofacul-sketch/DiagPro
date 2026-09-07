"""Smoke local WSGI, sem writes no banco, login, pagamento ou aparelho.

Executar do backend: python scripts/smoke_production.py
Usa o PostgreSQL local já configurado; rejeita hosts de banco remotos.
"""
import os
from pathlib import Path
import secrets
import sys
import tempfile
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE_DIR))
load_dotenv(BASE_DIR / '.env', override=False)


def verify(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    # Somente este processo; nunca escreve .env nem reutiliza a chave comercial.
    os.environ.update({
        'DJANGO_SETTINGS_MODULE': 'devicecheck_backend.settings',
        'DJANGO_DEBUG': 'false',
        'DJANGO_SECRET_KEY': secrets.token_urlsafe(64),
        'DJANGO_ALLOWED_HOSTS': '127.0.0.1,localhost',
        'DJANGO_SECURE_SSL_REDIRECT': 'false',
        'DJANGO_TRUST_PROXY_SSL_HEADER': 'false',
        'DJANGO_SECURE_HSTS_SECONDS': '0',
        'DJANGO_CORS_ALLOWED_ORIGINS': 'null',
        'DJANGO_HEALTHCHECK_DATABASE': 'true',
        'MERCADO_PAGO_ACCESS_TOKEN': '',
        'MERCADO_PAGO_WEBHOOK_SECRET': '',
    })
    with tempfile.TemporaryDirectory(prefix='diagpro-production-smoke-') as temporary:
        os.environ['DJANGO_STATIC_ROOT'] = str(Path(temporary) / 'static')
        import django
        django.setup()
        from django.conf import settings
        from django.core.management import call_command
        from django.test import override_settings
        from waitress import create_server

        verify(settings.DATABASES['default']['HOST'] in {'127.0.0.1', 'localhost', '::1'},
               'Smoke limitado a PostgreSQL local; nenhum acesso remoto executado.')
        call_command('check', verbosity=0)
        # Configuração HTTPS simulada só para os system checks; não é TLS real.
        with override_settings(SECURE_SSL_REDIRECT=True, SECURE_HSTS_SECONDS=3600,
                               SECURE_HSTS_INCLUDE_SUBDOMAINS=True, SECURE_HSTS_PRELOAD=True):
            call_command('check', deploy=True, fail_level='WARNING', verbosity=0)
        call_command('collectstatic', interactive=False, verbosity=0)
        # WhiteNoise indexa os arquivos ao construir o handler WSGI.
        from devicecheck_backend.wsgi import application
        server = create_server(application, host='127.0.0.1', port=0, threads=2)
        worker = threading.Thread(target=server.run, daemon=True)
        worker.start()

        def fetch(path, method='GET', headers=None):
            request = Request(f'http://127.0.0.1:{server.effective_port}{path}',
                              method=method, headers=headers or {})
            try:
                response = urlopen(request, timeout=10)
            except HTTPError as error:
                response = error
            with response:
                return response.status, response.headers, response.read()

        try:
            status, _, body = fetch('/health/')
            verify(status == 200 and b'"ok"' in body, 'Health/readiness local falhou.')
            verify(fetch('/admin/login/')[0] == 200, 'Admin local falhou.')
            status, headers, body = fetch('/static/admin/css/base.css')
            verify(status == 200 and 'text/css' in headers.get('Content-Type', '') and body,
                   'Static Admin falhou.')
            verify(fetch('/api/diagnosticos/')[0] == 401, 'API aceitou chamada sem JWT.')
            status, headers, _ = fetch('/api/token/', 'OPTIONS', {
                'Origin': 'null', 'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'authorization,content-type',
            })
            verify(status == 200 and headers.get('Access-Control-Allow-Origin') == 'null',
                   'Preflight Electron falhou.')
            _, headers, _ = fetch('/api/token/', 'OPTIONS', {
                'Origin': 'https://untrusted.example.test', 'Access-Control-Request-Method': 'POST',
            })
            verify('Access-Control-Allow-Origin' not in headers, 'Origem não autorizada recebeu CORS.')
            verify(fetch('/health/', headers={'Host': 'untrusted.example.test'})[0] == 400,
                   'Host não autorizado foi aceito.')
            print('PASS: DEBUG=False, WSGI Waitress, PostgreSQL SELECT 1, Admin/static, JWT e CORS.')
            print('LIMITES: somente HTTP loopback; TLS/proxy e Gunicorn Linux não executados.')
        finally:
            server.close()
            server.task_dispatcher.shutdown()
            worker.join(timeout=3)


if __name__ == '__main__':
    main()
