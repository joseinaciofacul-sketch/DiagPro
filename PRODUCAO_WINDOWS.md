# DiagPro — preparação Windows, ETAPA 10

## Arquitetura e limites

Recomendação: Electron/React e ADB no Windows; Django e PostgreSQL em servidor
central por HTTPS. Login, licença, pagamentos, clientes e histórico dependem dessa
API. Nenhum cliente precisa instalar Python, PostgreSQL ou Vite. Os dados Android
continuam sendo coletados via USB local. O Scanner e suas regras estão congelados.

Django/PostgreSQL embarcados aumentariam instalação, exposição de credenciais,
backup e suporte; sincronização offline exigiria conflitos e enforcement próprio.
Por isso essas alternativas não foram implementadas. Banco central requer backup
com restauração testada, migrações controladas e revisão de isolamento por usuário
e empresa antes de disponibilizar novos modelos multiempresa.

## Build e API

Em desktop, `npm run dev` inicia Vite e `npm run electron` abre desenvolvimento.
`npm test` executa testes. `npm run build` produz dist; `npm run electron:prod`
abre dist sem Vite. `npm run test:production` verifica build local, login, logos,
preload/IPC e isolamento usando perfil temporário sem credenciais ou scan.

VITE_DIAGPRO_API_BASE_URL é uma configuração PÚBLICA de build. Copiar .env.example
para .env.local em desenvolvimento. Para distribuição, definir a URL HTTPS real
em .env.production.local ou no ambiente do pipeline. Nunca inserir senhas, tokens
ou secrets em variáveis VITE_. O build deve ser refeito ao mudar o destino.

O padrão de desenvolvimento é http://127.0.0.1:8000. Não existe domínio de produção
inventado. `npm run package` gera somente uma pasta de teste em release/win-unpacked;
ela pode apontar para a API local e NÃO deve ser entregue como release comercial.
`npm run dist` exige URL HTTPS explicitamente configurada, gera NSIS sem publicar.
Não contornar esse comando usando o builder diretamente para distribuição.

## Electron

Produção usa arquivo local dist/index.html com base e imagens relativas. CSP limita
scripts aos arquivos locais e conexão à origem da API. Context isolation e sandbox
ativos, Node indisponível no renderer, DevTools desativado no build local/empacotado.
Novas janelas e permissões são negadas; navegação se restringe ao renderer esperado.
Todos os canais IPC verificam webContents, frame principal e URL. Checkout mantém
a validação de URL Mercado Pago já existente. Nenhum canal genérico de shell/Node.

file:// foi preservado incrementalmente; custom protocol com origem própria pode
ser adotado depois. No servidor atual, Electron por file pode enviar Origin:null:
se necessário, permitir somente esse valor explicitamente em CORS, ciente de que
ele representa outras origens opacas também. CORS não substitui JWT nem isolamento.
Não desativar webSecurity e não liberar CORS globalmente. CSRF segue ativo para
admin/sessões; webhook mantém tratamento servidor-servidor existente.

## Empacotamento

electron-builder 26.x, NSIS por usuário, execução asInvoker, ASAR, publish desativado.
appId com.diagpro.desktop e productName DiagPro são identificadores do produto,
não afirmações de posse de domínio. Versão 1.0.0 do manifesto foi preservada;
alinhar com a versão exibida na UI (2.1.0) antes da primeira release.

Allowlist inclui main/preload, módulos necessários e dist. Backend, .env, Git,
venv, bancos, ngrok, scripts, testes e fixtures ficam fora. Dependências de runtime
são tratadas pelo builder; ASAR não é criptografia. Auditar a lista real do ASAR
em cada release. A pasta release é ignorada pelo Git.

Existe logo PNG, mas nenhum ICO final. O pacote de teste usa ícone Electron.
Não houve redesign, instalador público, assinatura, publicação ou deploy.

## ADB

Ordem: DIAGPRO_ADB_PATH, ADB_PATH, resources/platform-tools/adb.exe, SDK conhecido,
PATH. Os overrides são administrativos locais; não são configuráveis via renderer.
Sem ADB, o estado de indisponibilidade existente informa a falha. Nenhum download
é realizado no cliente. A configuração atual do pacote não inclui ADB.

Preferência futura: binário versionado e auditado junto ao app, atualizado com a
release; isso depende de confirmar direitos de redistribuição da versão e suas
dependências. Não confundir licença AOSP com os termos do ZIP SDK Google. Estrutura
e requisitos em desktop/resources/platform-tools/README.md. Detecção de SDK/PATH
é fallback útil para beta técnico, mas exige instalação prévia. Download no primeiro
uso acrescentaria dependência de rede, integridade e consentimento; ficou pendente.
Drivers USB OEM e autorização física de depuração ainda podem ser necessários.

## Logs e offline

Logs JSON em app.getPath('userData')/logs/diagpro.log (normalmente
%APPDATA%/desktop/logs enquanto o name do manifesto permanecer desktop). Rotação de aproximadamente 1 MiB com uma cópia
anterior. Apenas códigos e metadados operacionais; não gravar bodies, URLs completas,
JWT, refresh, senha, serial, confirmationToken ou conteúdo Android. Falhas de escrita
não bloqueiam a operação. Perfil do teste fica no TEMP, sem credenciais.

API possui timeout de 15 segundos. Falta de internet permite detecção ADB local,
mas login e autorização de novo scan continuam dependendo da API. Persistência
falha não transforma resultado técnico em falha de coleta e não finge salvamento.
Não há fila/sincronização offline. JWT/refresh/enforcement não foram redesenhados.
Comportamento legado: resposta HTTP não-ok ao refresh limpa sessão; falha de rede
retorna indisponível. Rever especificamente respostas 5xx em etapa de autenticação.

## Servidor antes de produção

Obrigatórios: SECRET_KEY própria e forte, DEBUG=false, hosts reais, HTTPS no proxy,
credenciais PostgreSQL com privilégio mínimo, CORS explícito, backups e restauração,
server WSGI/ASGI de produção (não runserver), collectstatic, logs sem payloads e
monitoramento. Dependências CORS e SimpleJWT usadas pelo projeto foram declaradas
com as versões já instaladas. Isolamento deve continuar baseado em request.user.

Settings expõem DJANGO_SECURE_SSL_REDIRECT, DJANGO_SECURE_HSTS_SECONDS,
DJANGO_CSRF_TRUSTED_ORIGINS e DJANGO_TRUST_PROXY_SSL_HEADER. Cookies de sessão e
CSRF ficam secure quando DEBUG=false. Static root definido como backend/staticfiles.
Só confiar em X-Forwarded-Proto atrás de proxy conhecido que sobrescreva esse header.
HSTS começar apenas após validar HTTPS; não habilitar preload/subdomínios cegamente.
Rodar manage.py check --deploy com o ambiente efetivo do servidor.

Dependem de hospedagem: domínio/certificado TLS, proxy, SSL do banco, rede privada,
armazenamento/backups, SMTP e observabilidade. Email atual é console; configurar
provedor antes de oferecer envio real. UTC no banco e conversão local na interface.
Rate limiting de login/webhook e proteção de borda devem ser definidos no provedor;
não foi implantado throttle novo. Mercado Pago permanece exclusivamente no servidor.

## Atualização e assinatura

Recomendação futura: electron-updater com NSIS, releases HTTPS, metadados e assinatura
Authenticode verificada; nunca habilitar verificação falsa ou updater sem origem
definida. Não foi instalado nem habilitado updater nesta etapa.

Assinatura futura precisa de identidade do publicador, certificado/serviço de code
signing confiável, chave protegida, timestamp e validação do executável e instalador.
Secrets de assinatura ficam no pipeline. SmartScreen também considera reputação;
assinatura não garante eliminação imediata de avisos. Pacote atual não assinado.

## Referências oficiais

- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electron.build/v26/configuration.html
- https://www.electron.build/v26/docs/features/auto-update/
- https://developer.android.com/tools/releases/platform-tools
- https://docs.djangoproject.com/en/6.1/howto/deployment/checklist/

## Pendências de entrega ao cliente

API online real e configuração CORS/HTTPS testadas; origem/licenças e distribuição
ADB aprovadas; ICO final; versão comercial alinhada; assinatura; validação de login
e navegação autenticada contra servidor real; instalação/desinstalação NSIS em Windows
limpo. Nenhuma dessas verificações deve ser considerada concluída pelo teste local.

## Validação executada em 05/09/2026

- Base inicial: main, 4cde968, árvore limpa, mesma revisão de origin/main.
- Backend: check sem problemas, nenhuma migration pendente, 121 testes aprovados.
- Desktop: 162 testes aprovados; build Vite aprovado.
- Smoke pelo build local: login, logo, preload, chamada IPC read-only, Node isolado
  e tentativa de abrir DevTools bloqueada. Perfil temporário sem autenticação.
- Pacote Windows x64 --dir gerado em release/win-unpacked; DiagPro.exe abriu a
  tela de login com assets corretos. Porta Vite 5173 indisponível durante validação.
- API local reiniciada para teste; endpoint protegido retornou 401 sem token.
  Autenticação e navegação pós-login no pacote não foram automatizadas.
- ASAR auditado: nenhum .env, teste, fixture, Git, venv, log ou ngrok. Somente
  dependências React/lucide/scheduler em node_modules; nenhum empacotador distribuído.
- Get-AuthenticodeSignature: NotSigned. Nenhum instalador NSIS foi gerado/publicado.
- Guarda de release recusou corretamente a ausência de API HTTPS configurada.
- Git diff --check sem erros; apenas avisos de conversão de fim de linha Windows.

A estrutura de empacotamento está operacional. A geração de um instalador beta para
entregar ao cliente permanece bloqueada pela API HTTPS real ausente e pelas decisões
de distribuição ADB/identidade. O pacote local não elimina essa dependência de API.
