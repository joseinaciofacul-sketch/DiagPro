# DiagPro — ETAPA 11: preparação da API online

## Estado e limites

Checkpoint inicial: `main`, `12f65c8`, igual a `origin/main`, working tree limpo.
Nenhum deploy, conta cloud, compra, credencial, migration de modelo, scan físico,
pagamento real, commit ou push nesta etapa. Desktop/Scanner/ADB não foram alterados.

**Não liberar a API publicamente ainda.** A preparação operacional não resolve os
bloqueios de isolamento e limitação de abuso listados abaixo.

## Arquitetura e hospedagem recomendadas

Electron/React + ADB no Windows → HTTPS → Django/WSGI Linux → PostgreSQL gerenciado.
O PC do cliente não instala Python, Django ou PostgreSQL. O servidor não usa ADB.

Recomendação para primeiro beta: PaaS com serviço WSGI pago, PostgreSQL gerenciado
na mesma região/rede privada e HTTPS gerenciado. Render é uma candidata, não uma
decisão de contratação. Não há configuração específica de provedor no repositório.

| Alternativa | Simplicidade/manutenção | Custo e backup | HTTPS/segurança/escala |
| --- | --- | --- | --- |
| A: PaaS WSGI + PostgreSQL gerenciado | Menor carga operacional; recomendada | Serviço + banco + armazenamento/tráfego; escolher plano com recuperação | TLS da plataforma; configurar secrets, rede e limites; ampliar recursos conforme medição |
| B: container + banco gerenciado | Mais portável, mas requer manter imagem/base | Custos de serviço e banco semelhantes, mais pipeline/registro | TLS da plataforma; atualizar imagem e validar usuário/permissões; escala por réplicas |
| C: VPS + Nginx + Gunicorn + PostgreSQL | Maior responsabilidade operacional | Pode ter menor custo de máquina, mas administração e backups próprios | Operador cuida de patches, firewall, TLS, banco e restauração; escala manual inicialmente |

Não fixar preço desatualizável: aprovar orçamento de serviço, banco, armazenamento,
tráfego, retenção e região antes de contratar. Free não é referência de operação
comercial: pode dormir e não incluir recuperação adequada do banco.

Fontes oficiais consultadas em 07/09/2026:
[preços Render](https://render.com/pricing),
[limitações Free](https://render.com/docs/free),
[TLS Render](https://render.com/docs/tls),
[recuperação PostgreSQL](https://render.com/docs/postgresql-backups).

## Bloqueios reais antes de exposição pública

1. Rotas legadas `/api/dispositivos/`, `/api/analises/`, `/api/relatorios/` usam
   `ModelViewSet` com `.objects.all()` e serializers com `fields='__all__'`.
   Não há escopo por proprietário nesses viewsets. Um usuário autenticado pode
   alcançar dados de outros usuários e informar relações alheias. Corrigir
   listagem/detalhe/escrita/relacionamentos com testes entre usuários ou retirar
   essas rotas da exposição pública após aprovação. Não basta CORS ou JWT.
   Não alteradas aqui para não modificar regras legadas fora desta preparação.
2. Login, refresh, Admin e API não têm rate limiting configurado. Definir limites
   de borda antes do beta externo, incluindo IP real de proxy confiável e tamanho
   de requisições. Throttle DRF em cache local não equivale a proteção distribuída
   contra força bruta/DDoS. Nenhum mecanismo novo foi ativado nesta etapa.
3. Resolver uploads privados antes de habilitá-los: disco efêmero perde arquivos;
   servir PDFs publicamente poderia expor dados de clientes.
4. Selecionar provedor/região/plano, validar dependências e Gunicorn em Linux limpo,
   provisionar secrets fora do Git, confirmar TLS/proxy, backup e restauração.

Os endpoints atuais de diagnósticos, findings, clientes, empresas e assinatura
têm filtros por usuário no código inspecionado. A suíte existente cobre as regras
atuais de diagnóstico/licença. Isso não certifica isolamento de toda API legada.

## Variáveis e ambientes

`backend/.env.example` é exemplo de DESENVOLVIMENTO; não copiá-lo integralmente para
produção. `.env` existente não foi editado. Variáveis do processo têm prioridade
sobre `.env`, carregado explicitamente a partir de `backend/`.

| Variável | Regra |
| --- | --- |
| `DJANGO_DEBUG` | Ausente = false; desenvolvimento precisa de true explícito |
| `DJANGO_SECRET_KEY` | Obrigatória; chave aleatória forte exclusiva do servidor |
| `SECRET_KEY` | Alias legado aceito; DJANGO_SECRET_KEY tem prioridade; ausência de ambas falha claramente |
| `DJANGO_ALLOWED_HOSTS` | Hostnames reais separados por vírgula; sem esquema/caminho; wildcard proibido com DEBUG=false; fallback é apenas loopback |
| `DJANGO_CORS_ALLOWED_ORIGINS` | Lista explícita; produção sem variável = nenhuma origem permitida |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Origens HTTPS de interfaces que usam sessão/CSRF, somente se necessárias |
| `DATABASE_URL` | URL PostgreSQL do provedor; prioridade sobre DB_* de identificação |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` | Alternativa compatível com banco local/remoto |
| `DB_SSLMODE`, `DB_SSLROOTCERT` | Overrides TLS opcionais; valores da URL preservados quando vazios |
| `DB_CONN_MAX_AGE` | Segundos, padrão 0; ajustar segundo limite de conexões; health checks de conexão ativos |
| `DB_CONNECT_TIMEOUT` | Timeout de conexão, padrão 5 s; parâmetro da URL tem prioridade |
| `DJANGO_SECURE_SSL_REDIRECT` | Ativar após confirmar TLS/proxy; padrão false preserva teste HTTP local |
| `DJANGO_TRUST_PROXY_SSL_HEADER` | Padrão false; true somente se proxy confiável sobrescreve X-Forwarded-Proto |
| `DJANGO_SECURE_HSTS_SECONDS` | Padrão 0; aumentar gradualmente após TLS confirmado |
| `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS`, `DJANGO_SECURE_HSTS_PRELOAD` | Padrão false; só ativar após avaliar todos os subdomínios/compromisso de preload |
| `DJANGO_LOG_LEVEL` | INFO padrão; aceita DEBUG/INFO/WARNING/ERROR/CRITICAL |
| `DJANGO_HEALTHCHECK_DATABASE` | true padrão; false transforma health em liveness sem banco |
| `DJANGO_STATIC_ROOT` | Opcional, padrão backend/staticfiles |
| `DJANGO_MEDIA_ROOT` | Opcional, padrão backend/media; requer estratégia persistente privada |

Nenhuma variável pública `VITE_*` pode conter senha, chave de servidor ou token.
Chave fraca pode gerar warning de deploy; não o ignorar. Gerar a chave pelo gerenciador
de secrets do ambiente, sem colar em logs/comandos compartilhados. A chave também
assina JWT no desenho atual; sua troca pode invalidar sessões/tokens.

Desenvolvimento Windows, na pasta backend e no terminal atual:

```powershell
$env:DJANGO_DEBUG = 'true'
.\venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

Isso não grava `.env`. Alternativamente, o operador pode adicionar apenas
`DJANGO_DEBUG=true` ao seu `.env` local. Nunca usar runserver em produção.

## CORS, CSRF e Electron

Desenvolvimento com DEBUG=true admite Vite localhost/127.0.0.1:5173 e origens locais
legadas. Produção não libera origens por padrão. CORS fica restrito a `/api/`,
`CORS_ALLOW_ALL_ORIGINS=False` e `CORS_ALLOW_CREDENTIALS=False`.

Renderer `file://` pode enviar `Origin: null`. Para esse beta, se confirmado no
cliente, configurar explicitamente `DJANGO_CORS_ALLOWED_ORIGINS=null`. Isso permite
outras origens opacas também: **null não é identidade do DiagPro**. Não adicionar
cookies de autenticação. O acesso segue exigindo Bearer JWT e autorização por dono.
No futuro, avaliar origem própria de protocolo Electron sem enfraquecer webSecurity.
Uma interface web futura precisa de sua origem HTTPS exata, não `*`.

CSRF global permanece ativo. DRF usa JWT no header, não sessão; não necessita token
CSRF de navegador para essas rotas. Admin usa sessão e mantém CSRF. O webhook externo
preserva seu tratamento DRF sem JWT e sua validação HMAC; não foi reimplementado.

Referências: [CORS oficial](https://github.com/adamchainz/django-cors-headers),
[throttling DRF](https://www.django-rest-framework.org/api-guide/throttling/).

## PostgreSQL centralizado

Preferir banco gerenciado, acesso privado, usuário de privilégio mínimo e TLS
conforme o provedor (preferir verify-full com CA válida). `require` cifra, mas não
equivale à verificação explícita do hostname/CA de verify-full. Não expor 5432
indiscriminadamente. Nada de credenciais do banco no desktop.

`dj-database-url` evita parser manual e aceita senha percent-encoded. Respostas de
erro de configuração não reproduzem a URL. Outros engines são rejeitados. URL e
DB_* locais são testados separadamente. Nenhum banco cloud criado ou migration
de modelo gerada. Definir limites de conexões conforme workers/threads/réplicas.

## HTTPS e servidor WSGI

Produção Linux: Gunicorn, declarado somente para plataforma não Windows. Exemplo
genérico **após** configurar o ambiente e o proxy, dentro de backend:

```sh
gunicorn devicecheck_backend.wsgi:application --bind "0.0.0.0:${PORT:-8000}" --workers 2 --error-logfile -
```

Não habilitar access logs com query strings, headers ou bodies. O padrão acima não
liga access log. Workers são ponto inicial, não dimensionamento medido; ajustar
memória/conexões/timeout segundo métricas reais. Tráfego público somente pelo proxy;
restringir acesso direto ao socket/origem. Só confiar em headers que a plataforma
remove/substitui, nunca em headers fornecidos livremente pelo cliente.

Waitress é declarado apenas para Windows, utilizado na simulação WSGI local. Não
executamos Gunicorn no Windows. Validar o comando Linux no ambiente aprovado antes
de publicar. Nenhum container, Procfile ou manifesto de provedor foi criado.

Com DEBUG=false, cookies de sessão/CSRF ficam Secure. Ligar redirect só com proxy/TLS
corretos para evitar loop. HSTS começa em zero; após confirmar TLS, testar um período
curto e ampliar. includeSubDomains/preload não devem ser usados para apenas calar
warnings; avaliar domínio inteiro antes. Health também deve usar HTTPS real.

Fontes: [Gunicorn](https://gunicorn.org/),
[Waitress](https://docs.pylonsproject.org/projects/waitress/en/latest/),
[checklist Django](https://docs.djangoproject.com/en/6.0/howto/deployment/checklist/).

## Static e media

WhiteNoise fica imediatamente depois de SecurityMiddleware; CORS continua acima
para adicionar headers às respostas aplicáveis. Static usa storage comprimido com
manifest e hashes. `collectstatic` atende Admin/DRF, não o frontend Electron.

`Empresa.logo` (Admin) e `Relatorio.arquivo_pdf` (modelo/serializer legado) existem.
Media não é servida pelo WhiteNoise, não tem rota pública adicionada e não foi
migrada/copiada de arquivos antigos. Antes de uploads reais, inventariar arquivos
preexistentes e definir volume persistente privado + backup ou storage externo
aprovado com downloads autorizados. Não foi criado S3 nem outro serviço.
Static gerado e media estão ignorados pelo Git.

Fonte: [WhiteNoise Django](https://whitenoise.readthedocs.io/en/stable/django.html).

## Logs, erros e health

Logs JSON da aplicação em stdout, adequados ao coletor da plataforma. Campos:
timestamp, nível, evento fixo e status HTTP quando disponível. Registram startup
WSGI, falha de banco, erros Django, rejeições/salvamento de diagnósticos e falhas de
checkout/webhook. Observação de respostas não altera transações nem regras.

Formatter não interpola mensagens arbitrárias, exceções, request, headers, query,
senha, JWT, refresh, DSN, tokens Mercado Pago, serial ou resultado técnico.
Trade-off: não há stack trace detalhado no log padrão; depuração detalhada somente
em ambiente controlado com dados fictícios. Configurar retenção/acesso a logs no
provedor. Logs do proxy/servidor precisam da mesma política, não apenas Django.
Email de produção fica dummy até existir configuração de envio aprovada, evitando
que conteúdo seja emitido pelo backend console.

`GET /health/` e HEAD são públicos, sem cache. Retorna somente `{"status":"ok"}`
com 200; por padrão faz `SELECT 1`. Falha de banco → 503 com `{"status":"unavailable"}`.
Sem host, versão, configuração ou exceção no corpo. Sonda não certifica migrations,
JWT, licença, pagamentos ou disponibilidade total. Evitar frequência excessiva.
Com DEBUG=false, erros não tratados usam resposta genérica padrão Django; testado
com falha de banco simulada. Não foi criada camada global complexa de exceptions.

## JWT, licença, pagamentos e Admin

Mantidos: access 5 minutos; refresh 1 dia; sem rotação/blacklist de refresh;
`CHECK_REVOKE_TOKEN=True` verifica alteração de senha. Nenhum tempo alterado.
Sempre enviar Authorization Bearer por HTTPS. Cliente não passa a ser autoridade:
criação de diagnóstico continua verificando licença/quota no backend e usando
request.user. A coleta física local não equivale à autorização para persistência.

Mercado Pago continua pausado. Nenhum checkout real acionado, nenhuma credencial
solicitada ou fluxo alterado. Permanecem exclusivamente no servidor:
MERCADO_PAGO_ACCESS_TOKEN, MERCADO_PAGO_WEBHOOK_SECRET, MERCADO_PAGO_SUCCESS_URL,
MERCADO_PAGO_FAILURE_URL, MERCADO_PAGO_PENDING_URL, MERCADO_PAGO_WEBHOOK_URL,
MERCADO_PAGO_USE_SANDBOX, MERCADO_PAGO_TIMEOUT_SECONDS e
MERCADO_PAGO_LICENSE_DURATION_DAYS. Retomada futura exige aprovação e URLs HTTPS,
incluindo `/api/pagamentos/mercadopago/webhook/`, preservando HMAC.

Admin permanece em `/admin/`, com sessão/CSRF, static e cookies Secure. Usar senha
forte e conta individual; restringir acesso por rede/proxy e avaliar 2FA. Não criar
nem compartilhar credenciais. Não há proteção adicional de login já implantada.

## Checklist de deploy futuro (não executado)

1. Resolver bloqueios de isolamento e abuso, aprovar provedor, custo e região.
2. Testar instalação de requirements em Linux limpo; manter versão Python validada
   (local: 3.14.3) e compatibilidade das versões fixadas, sem upgrade automático.
3. Criar banco/serviço somente com aprovação, configurar secrets, rede, TLS e backup.
4. Confirmar snapshot/backup recuperável e revisar `python manage.py migrate --plan`.
5. Em job de release único: `python manage.py migrate --noinput`.
6. Na nova release: `python manage.py collectstatic --noinput`.
7. Executar `python manage.py check --deploy`; revisar todo warning, sem silenciar.
8. Iniciar Gunicorn; validar `/health/`, Admin/static, JWT, isolamento e licença.
9. Só então abrir tráfego aprovado e observar erros, latência e uso de banco.

Não rodar migrations concorrentes em cada worker; não executar migration destrutiva
sem revisão/backup/aprovação. Nenhuma migration criada nesta etapa.

## Backups e rollback

Requisito proposto para aprovação: backup automático diário, retenção mínima de
7 dias e restauração testada antes do beta, repetida periodicamente; definir RPO/RTO
com o responsável e avaliar PITR conforme o plano. Essa é uma política proposta,
não uma garantia de serviço contratado. Incluir media quando houver uploads.

Rollback: interromper ampliação do tráfego, preservar logs/backup, voltar à release
anterior apenas se schema compatível. Não reverter migrations cegamente. Restaurar
backup em banco separado, validar integridade e trocar conexão controladamente;
nunca sobrescrever banco ativo sem plano/aprovação. Ensaiar antes do lançamento.

## Electron e primeiro instalador

Após backend online aprovado: testar `/health/` → obter URL HTTPS real → definir
`VITE_DIAGPRO_API_BASE_URL` no build desktop → `npm run build` → `npm run package`
→ login autorizado → diagnóstico físico somente em etapa autorizada com aparelho.
Rebuild obrigatório ao mudar URL. Nenhuma URL fictícia foi inserida no aplicativo.
Antes do instalador ainda faltam ADB/distribuição, assinatura, ícone/versão e smoke
autenticado contra API real conforme ETAPA 10. Nenhuma ETAPA 12 iniciada.

## Validação local

Baseline: check e makemigrations --check aprovados, 121 testes em 384,221 s, OK.
Novos testes de configuração/HTTP/log: 24 aprovados na primeira execução.
`python scripts/smoke_production.py` usa porta loopback automática, chave efêmera,
DEBUG=false, PostgreSQL local read-only e static temporário removido ao terminar.
Não grava .env, não faz login, scan, migration ou pagamento. Usa Waitress e testa
health, Admin/static, JWT obrigatório, CORS e host inválido. TLS/proxy são simulados
nos system checks; isso não certifica HTTPS real nem execução Gunicorn/Linux.

Resultados finais em 07/09/2026:

| Verificação | Resultado |
| --- | --- |
| `manage.py check` | OK no ambiente local seguro e com DEBUG=true explícito |
| `manage.py check --deploy` | W004 (HSTS=0) e W008 (redirect=false), esperados no HTTP local; não silenciados |
| Check deploy com flags HTTPS simuladas e chave efêmera forte | OK, nenhum warning; não representa TLS real |
| `manage.py makemigrations --check` | Nenhuma alteração detectada |
| `manage.py test` final | 145 testes em 382,018 s, OK; banco de testes removido pelo Django |
| `manage.py collectstatic --noinput` | 157 arquivos copiados, 453 pós-processados, OK |
| `scripts/smoke_production.py` | PASS com Waitress e banco local read-only |
| `pip check` e resolução dry-run requirements no Windows | OK; Gunicorn corretamente excluído por plataforma |
| Desktop teste/build | Não repetidos: nenhum arquivo desktop alterado nesta etapa |
| `git diff --check` | OK |
| Git | main no checkpoint 12f65c8, igual ao tracking origin/main, 6 arquivos versionados alterados e 5 novos |

O primeiro smoke encontrou ordem incorreta no próprio script: WSGI/WhiteNoise era
inicializado antes do collectstatic temporário. A ordem foi corrigida e o smoke
completo passou. Nenhum processo da simulação ficou atendendo após sua conclusão.

Arquivos alterados: `.gitignore`, `backend/.env.example`, `backend/requirements.txt`,
`backend/devicecheck_backend/settings.py`, `backend/devicecheck_backend/urls.py`,
`backend/devicecheck_backend/wsgi.py`.
Criados: este documento, `backend/core/test_production.py`,
`backend/devicecheck_backend/health.py`, `backend/devicecheck_backend/observability.py`,
`backend/scripts/smoke_production.py`. Static é saída gerada ignorada pelo Git.
Dependências declaradas: dj-database-url 3.1.2, WhiteNoise 6.12.0, Gunicorn 26.2.0
(não Windows), Waitress 3.0.2 (Windows), Pillow 12.3.0 (já instalado e usado por
ImageField, antes não declarado). Não houve atualização das dependências existentes.

**BACKEND DIAGPRO PRONTO PARA PRIMEIRO DEPLOY DE BETA: NÃO**, enquanto os bloqueios
de segurança e operação acima não forem resolvidos e validados.
