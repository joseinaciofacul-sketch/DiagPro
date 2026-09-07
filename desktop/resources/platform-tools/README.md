# ADB para distribuição

Nenhum binário é incluído nesta etapa. A redistribuição do ZIP do SDK Google não
deve ser presumida permitida: revisar os termos da versão escolhida e todas as
licenças/NOTICE das dependências. Alternativa: build AOSP reproduzível com auditoria
das licenças de cada componente. Isso exige aprovação antes da inclusão.

Estrutura futura: resources/platform-tools/adb.exe e DLLs exigidas pela versão
aprovada, acompanhados de LICENSE/NOTICE, origem, versão e hashes SHA-256.
Depois da aprovação, configurar extraResources para copiar apenas esses arquivos
para resources/platform-tools no aplicativo instalado (fora do ASAR).

Hoje o resolvedor reconhece esse caminho futuro, depois tenta SDK/PATH existentes.
DIAGPRO_ADB_PATH e ADB_PATH são overrides administrativos locais. Nenhum download
acontece no primeiro uso e o instalador ainda não fornece ADB automaticamente.
Drivers USB de alguns fabricantes podem ser necessários separadamente.
