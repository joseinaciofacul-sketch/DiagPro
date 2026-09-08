# DiagPro — ETAPAS 11 e 12: preparação e segurança da API online

## Estado e limites

Checkpoint inicial da ETAPA 12: `main`, `0c190de`, igual a `origin/main`,
working tree limpo.
Nenhum deploy, conta cloud, compra, credencial, migration de modelo, scan físico,
pagamento real, commit ou push nesta etapa. Desktop/Scanner/ADB não foram alterados.

O código da API agora possui isolamento por proprietário e throttling. A exposição
pública continua condicionada à configuração operacional de Redis, proxy/TLS,
backup e proteção de borda descrita neste documento.

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

## Condições reais antes de exposição pública

1. Provisionar Redis compartilhado. Com `DEBUG=false`, o backend exige
   `DJANGO_THROTTLE_CACHE_URL`; cache local é permitido apenas em desenvolvimento
   ou na simulação loopback explicitamente marcada.
2. Configurar a quantidade exata de proxies confiáveis em `DJANGO_NUM_PROXIES` e
   garantir que o proxy remova/sobrescreva `X-Forwarded-For`. Aplicar também limite
   de borda, tamanho máximo de body e timeouts: o throttle DRF é aproximado e não é
   defesa contra DDoS.
3. Não publicar `/media/`. Upload de PDF foi tornado somente leitura na API legada;
   download autenticado e armazenamento persistente privado ainda não existem.
4. Proteger `/admin/` com HTTPS, senha forte, conta individual e restrição no proxy;
   avaliar 2FA posteriormente. O Admin permanece fora do throttle DRF.
5. Selecionar provedor/região/plano, validar dependências e Gunicorn em Linux limpo,
   provisionar secrets fora do Git, confirmar TLS/proxy, backup e restauração.

## Segurança da API — ETAPA 12

As rotas legadas foram mantidas por compatibilidade, mas agora o proprietário é
sempre derivado de `request.user`: dispositivo por `cliente.usuario`, análise por
`dispositivo.cliente.usuario` e relatório por
`analise.dispositivo.cliente.usuario`. Listagem e lookup usam o mesmo escopo;
IDs externos retornam 404. Relações graváveis têm queryset limitado ao usuário.
`Analise.tecnico` é preenchido pelo servidor. Token QR, PDF e datas internas são
somente leitura. Diagnósticos inconsistentes de outro dono também são excluídos do
resumo de cliente.

| Endpoint | Classe | Ownership | Scope de throttle |
| --- | --- | --- | --- |
| `POST /api/token/` | público | credenciais | `auth_ip` + `auth_account` |
| `POST /api/token/refresh/` | público | refresh JWT | `refresh` |
| `GET/HEAD /health/` | público | não aplicável | `health` |
| `/api/me/`, empresas e clientes | autenticado | `request.user` | `read`/`write`; senha usa `password` |
| dispositivos | autenticado | `cliente.usuario` | `read`/`write` |
| análises legadas | autenticado | `dispositivo.cliente.usuario` | `read`/`write` |
| relatórios legados | autenticado | cadeia da análise/dispositivo/cliente | `read`/`write` |
| planos, licença e assinatura | autenticado | dados globais permitidos ou usuário | `read` |
| checkout | autenticado | pagamento criado para `request.user` | `checkout` |
| diagnósticos | autenticado | `Diagnostico.usuario` | `read`; criação usa `diagnostic` |
| associação cliente-diagnóstico | autenticado | ambos do mesmo usuário | `write` |
| findings | autenticado, somente leitura | `diagnostico.usuario` | `read` |
| remediations | autenticado | diagnóstico e finding do usuário | `remediation` |
| webhook Mercado Pago | público, HMAC obrigatório | reconciliação server-side | `webhook` |
| `/admin/` | sessão + CSRF | privilégios do Django Admin | proxy/borda |

Novos diagnósticos não podem injetar histórico de remediação, e findings novos
sempre começam em `open`. Alterações de status seguem o endpoint de remediação.
Hashes de confirmação e tokens brutos são retirados das representações da API,
sem apagar a auditoria já persistida. Toda notificação do webhook, inclusive tipo
ignorado, passa pela validação HMAC antes de receber resposta de sucesso.

Limites iniciais do beta, todos configuráveis por ambiente:

| Scope | Padrão | Identidade |
| --- | ---: | --- |
| login por IP | 30/min | IP confiável |
| login por conta | 10/min | hash do username normalizado |
| refresh | 60/min | IP confiável |
| leitura autenticada | 300/min | usuário |
| escrita autenticada | 60/min | usuário |
| criação de diagnóstico | 60/min | usuário |
| remediação | 60/min | usuário |
| troca de senha | 5/hour | usuário |
| checkout | 10/min | usuário |
| webhook | 300/min | IP confiável |
| health | 120/min | IP confiável |

`OPTIONS` não consome cota. Excesso retorna 429 com `Retry-After`; falta de JWT
continua 401, relação inválida do próprio request retorna 400 e objeto de outro
usuário/inexistente retorna 404 para reduzir enumeração. O cache do throttle usa
Redis em produção e LocMem apenas em desenvolvimento/teste. O algoritmo do DRF
usa operações de cache não atômicas e pode ter pequena imprecisão sob concorrência;
manter proteção de borda. Referências: [throttling DRF](https://www.django-rest-framework.org/api-guide/throttling/)
e [cache Django](https://docs.djangoproject.com/en/6.1/topics/cache/).

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
| `DJANGO_THROTTLE_CACHE_URL` | Obrigatória com DEBUG=false; URL privada `redis://` ou `rediss://` do cache compartilhado |
| `DJANGO_REQUIRE_SHARED_THROTTLE_CACHE` | Padrão true quando DEBUG=false; override false é interno ao smoke loopback e não deve existir no servidor |
| `DJANGO_NUM_PROXIES` | Número exato de proxies confiáveis; padrão 0 ignora X-Forwarded-For |
| `DJANGO_THROTTLE_*_RATE` | Overrides dos limites da tabela; formato positivo como `30/min` |

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
continua sem JWT e com validação HMAC obrigatória antes de qualquer tipo ser aceito.

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

`GET /health/` e HEAD são públicos, sem cache e limitados de forma leve. Retorna somente `{"status":"ok"}`
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
nem compartilhar credenciais. Login JWT possui cotas por IP e por conta; Admin deve
receber uma política própria no proxy porque não passa pelo DRF.

## Checklist de deploy futuro (não executado)

1. Provisionar Redis/proxy de borda e aprovar provedor, custo e região.
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
autenticado contra API real conforme ETAPA 10.

## Validação local

O baseline anterior à ETAPA 12 permaneceu aprovado: `check`, ausência de migrations
e 145 testes. Os testes desta etapa usam o banco temporário criado e destruído pelo
Django; os cenários A/B não alteraram usuários, diagnósticos físicos ou registros do
banco de desenvolvimento.

Resultados finais em 08/09/2026:

| Verificação | Resultado |
| --- | --- |
| `manage.py check` | OK com `DJANGO_DEBUG=true` explícito |
| `manage.py check --deploy` | Somente W004 (HSTS=0) e W008 (redirect=false), esperados sem HTTPS real; nenhum warning silenciado |
| `manage.py makemigrations --check` | Nenhuma alteração detectada |
| `manage.py test core.test_api_security` | 33 testes em 2,074 s, OK |
| `manage.py test` | 182 testes em 162,169 s, OK; banco temporário removido |
| `scripts/smoke_production.py` | PASS: Waitress, PostgreSQL `SELECT 1`, health, Admin/static, JWT e CORS em HTTP loopback |
| `pip check` | OK para o ambiente instalado |
| Cliente Redis no venv local | Ainda não instalado; `redis==8.1.0` está declarado para a próxima instalação de requirements |
| Redis compartilhado/TLS/proxy/Gunicorn Linux | Não provisionados nem validados nesta etapa |
| Desktop teste/build | Não executados: nenhum arquivo desktop foi alterado |
| `git diff --check` | OK; apenas avisos informativos de conversão LF/CRLF no Windows |

Cobertura de segurança adicionada: isolamento bidirecional entre usuários A/B em
listas, detalhes, POST, PATCH, PUT e DELETE; tentativa por ID, serial e query string;
relações cruzadas; diagnóstico, cliente, finding e remediação; campos controlados
pelo servidor; redaction de segredos; idempotência; login, refresh, leitura, escrita,
diagnóstico, remediação, webhook e health com respostas 429 e `Retry-After`.

Arquivos alterados na ETAPA 12: este documento, `backend/.env.example`,
`backend/core/security_projection.py`, `backend/core/serializers.py`,
`backend/core/test_production.py`, `backend/core/urls.py`, `backend/core/views.py`,
`backend/devicecheck_backend/health.py`, `backend/devicecheck_backend/observability.py`,
`backend/devicecheck_backend/settings.py`, `backend/devicecheck_backend/urls.py`,
`backend/requirements.txt` e `backend/scripts/smoke_production.py`.

Arquivos criados na ETAPA 12: `backend/core/auth_views.py`,
`backend/core/test_api_security.py` e `backend/core/throttling.py`.

Não houve alteração de modelo ou migration. Não houve scan, conexão ADB, remoção,
pagamento real, deploy, commit ou push.

**API DIAGPRO SEGURA O SUFICIENTE PARA PRIMEIRO DEPLOY DE BETA: NÃO.** O isolamento
e a proteção de abuso no código estão aprovados, mas a API não deve receber tráfego
público até Redis compartilhado, topologia confiável de proxy/IP, TLS/redirecionamento,
proteção de borda, backup/restauração e política de media privada serem provisionados
e testados no ambiente real. O download autenticado de relatórios privados também
continua como pendência; `/media/` não deve ser publicado.
