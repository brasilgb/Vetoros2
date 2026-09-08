# PRD-01 — Production Readiness & Operational Hardening

Data: 2026-09-08.

## Estado anterior

O produto é um monorepo pnpm com API Fastify, Web Next.js, PostgreSQL 17 e Redis
8. O Dockerfile gera uma imagem única. O Compose existente é adequado ao
desenvolvimento local: usa credenciais locais com defaults, executa migrate e
seed, expõe API/Web e mantém volumes. Não havia manifesto separado de produção,
procedimento de backup/restore ou usuário não-root na imagem.

`@vetoros/config` validava URLs obrigatórias de runtime, porta e TTL, mas aceitava
qualquer texto em `COOKIE_SECURE`, não conhecia `TRUST_PROXY` e permitia iniciar
`NODE_ENV=production` com HTTP/cookie inseguro. A API restringia CORS a uma origem
configurada e o cookie já era `HttpOnly`, `SameSite=Strict`, com `Secure`
configurável. Next removia `X-Powered-By` e já emitia CSP, nosniff e referrer
policy. A API não emitia headers equivalentes.

Fastify já fornecia logs JSON e request IDs, mas o handler global encaminhava o
erro desconhecido ao framework e podia expor sua mensagem. `/health` era somente
liveness estático. PostgreSQL e Redis tinham healthchecks no Compose, porém a API
não expunha readiness das dependências. Redis estava configurado, mas não era
conectado pelo processo. `onClose` encerrava os dois pools PostgreSQL; não havia
tratamento explícito de SIGTERM/SIGINT.

Migrations são append-only via Drizzle e usam credencial dedicada. O init cria
roles distintos de migration, runtime e auth com `NOINHERIT`/`NOBYPASSRLS`.
As migrations aplicam grants mínimos, revogam acesso público e habilitam/forçam
RLS nas tabelas tenant-scoped. A suíte DB já testa FKs same-tenant, RLS, RBAC,
imutabilidade e funções concorrentes. Não há uploads ou armazenamento de arquivos.
Reports usa consulta compartilhada para JSON/CSV, com tenant RLS e company/branch
da sessão.

Web tem componentes comuns de loading, empty/error state, confirmação, ações
assíncronas e proteção de contexto. Existem 13 specs Playwright cobrindo login,
shell, contexto, seletores, diálogos, mobile, usuários, roles, auditoria, caixa,
receivables, payables, contas financeiras e vendas. Não havia uma jornada única
ligando CRM, orçamento, OS, estoque, venda, recebimento e relatório.

## Lacunas comprovadas e solução mínima

- Manifesto de produção separado, sem seed automático e sem defaults secretos.
- Validação de boot que exige HTTPS/cookie seguro em produção e valida protocolos.
- `trustProxy` explícito para operação atrás do proxy TLS.
- Imagem executada como usuário `node`.
- Headers de segurança e correlação também na API.
- 5xx sanitizado, com log estruturado por request ID sem mensagem/payload secreto.
- `/ready` consultando auth DB, runtime DB e Redis; `/health` permanece liveness.
- shutdown explícito fechando listener, pools e Redis.
- scripts/documentação de backup e restore sem sobrescrever banco corrente.
- teste de jornada real sobre a persistência existente.

Nenhuma migration é necessária: as estruturas, constraints, FKs, índices, RLS,
imutabilidade e locks existentes são suficientes. PRD-01 corrige configuração,
operação e integração; não adiciona persistência nem capacidade comercial.

## Invariantes preservadas

Tenant continua derivado da sessão e imposto por transação/RLS forçada. Empresa e
filial continuam selecionadas no servidor e validadas contra grants. Permissions
continuam verificadas por ação e escopo. Escritas críticas mantêm as constraints,
locks, idempotência e auditoria existentes. Migration, runtime e auth permanecem
em roles separados; apenas o job migrate recebe a URL privilegiada. QA-01 mantém
quatro workers e paralelismo entre arquivos.

Durante a prova, a primeira tentativa mostrou que privilégios de nível de
database não fazem parte do dump. Após concedê-los, um dump sem ownership ainda
restaurou os schemas como administrador e impediu o role migration de acessar
`drizzle`. O procedimento final concede `CONNECT, CREATE` ao role migration,
somente `CONNECT` aos roles runtime/auth e preserva ownership/ACLs do dump. Os
bancos isolados das tentativas falhas foram mantidos para auditoria e não são
usados como evidência de sucesso. Não houve mudança de schema.

## Evidências finais

- A imagem `vetoros2-app:local` foi reconstruída e executou como
  `uid=1000(node) gid=1000(node)`.
- Um banco vazio, `vetoros_prd01_fresh`, recebeu migrations, seed de validação e
  uma segunda execução de migrations sem pendências.
- O dump custom-format do banco com dados representativos foi restaurado em
  `vetoros_prd01_restore_v2`; migrations foram aplicadas duas vezes após o
  restore. O role runtime permaneceu sem `CREATE` público e sem `BYPASSRLS`, as
  53 tabelas protegidas continuaram com RLS forçada e uma consulta cross-tenant
  conhecida retornou zero linhas.
- A jornada crítica real passou tanto no banco de origem quanto no restaurado:
  login/contexto, cliente, equipamento, orçamento aprovado, conversão em OS,
  entrada de estoque, venda confirmada com baixa, caixa/recebimento e relatório
  JSON/CSV.
- Após recriação dos serviços, `/health`, `/ready` e `/login` responderam com
  sucesso e os logs recentes de API/Web não continham erro, fatal ou exception.
- Gates finais: API 315/315 em 24 arquivos, DB 239/239 em 23 arquivos,
  configuração 3/3, Playwright 18/18, lint, typecheck, build e `git diff --check`.
  A suíte unitária Web não possui arquivos e encerrou com código zero, conforme
  sua configuração `--passWithNoTests`.

O Playwright também revelou duas fragilidades antigas dos testes em banco limpo
ou acumulado: a tela omite o seletor quando há um único caixa, e o combobox de
cliente já realça a primeira opção antes de `ArrowDown`. Os locators passaram a
esperar a carga real, aceitar a ausência válida do seletor, limitar resultados
duplicados ao primeiro elemento visível e sincronizar a escolha do cliente com
a resposta da busca.
