# VetorOS2 — operação controlada em produção

## Preparação e deploy

1. Copie `.env.production.example` para um arquivo fora do repositório e troque
   todos os placeholders. Senhas em URLs devem estar percent-encoded.
2. Construa a imagem com a URL pública definitiva da API:

   `docker build --build-arg NEXT_PUBLIC_API_URL=https://api.exemplo -t vetoros2-app:TAG .`

3. Valide a configuração sem iniciar serviços:

   `docker compose --env-file /caminho/seguro.env -f compose.production.yaml config --quiet`

4. Inicie os serviços. O job `migrate` termina antes da API. O seed de
   desenvolvimento não faz parte do boot de produção:

   `docker compose --env-file /caminho/seguro.env -f compose.production.yaml up -d`

5. Publique as portas loopback 3000/3001 por reverse proxy TLS. Preserve
   `X-Forwarded-For` e `X-Forwarded-Proto`. A API confia no proxy em produção,
   aceita apenas `WEB_ORIGIN`, usa cookie `Secure`, `HttpOnly`, `SameSite=Strict`
   e responde `X-Request-Id`.

`GET /health` comprova que o processo responde. `GET /ready` consulta as duas
conexões PostgreSQL e Redis; use somente `/ready` para retirar/adicionar instâncias
ao balanceador. Erros inesperados retornam um identificador correlacionável sem
detalhes internos. SIGTERM/SIGINT fecham listener, pools e Redis.

## Primeiro tenant e administrador

Depois de `migrate` concluir e antes de abrir o onboarding, execute uma única
vez, com um arquivo de ambiente seguro e sem registrar o comando no histórico:

`set -a; . /caminho/seguro/bootstrap.env; set +a; docker compose --env-file /caminho/seguro.env -f compose.production.yaml run --rm --no-deps migrate corepack pnpm db:bootstrap`

O arquivo deve conter `NODE_ENV=production`, `BOOTSTRAP_CONFIRM=I_UNDERSTAND`,
`MIGRATION_DATABASE_URL`, `BOOTSTRAP_TENANT_SLUG`, `BOOTSTRAP_TENANT_NAME`,
`BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`
(mínimo de 12 caracteres), `BOOTSTRAP_COMPANY_TAX_ID` (11 ou 14 dígitos) e,
opcionalmente, `BOOTSTRAP_COMPANY_NAME` e `BOOTSTRAP_BRANCH_NAME`. A rotina
recusa executar fora de produção e recusa qualquer banco que já tenha tenant;
não há senha padrão, tenant demo ou dependência do `db:seed`. Remova o arquivo
após o uso e faça login para validar o contexto criado.

## Dados mínimos e primeiro acesso

O bootstrap cria somente os itens obrigatórios para o primeiro login: tenant,
administrador ativo com papel `administrator`, permissões, empresa e filial
principal. Formas de pagamento básicas são catálogo global criado pelas migrations;
não são dados comerciais fictícios. Fornecedor, cliente, equipamento, usuários
adicionais, caixa e demais cadastros são criados pelo administrador conforme a
operação real exigir.

Checklist do primeiro cliente:

1. executar o bootstrap e remover o arquivo de bootstrap;
2. fazer login e confirmar Empresa/Filial no cabeçalho;
3. revisar papéis e criar usuários individuais, sem senha compartilhada;
4. configurar/confirmar formas de pagamento e abrir caixa quando aplicável;
5. cadastrar fornecedor, cliente e equipamento reais;
6. criar uma OS, adicionar item, executar atendimento, concluir e entregar;
7. validar histórico, comprovante não fiscal e fluxo financeiro utilizado pelo cliente.

## Smoke do piloto

Com credenciais de staging/piloto fornecidas fora do repositório, validar login,
logout, contexto, capability/RBAC (menu ausente e URL proibida retornando 403),
cliente, equipamento, OS, financeiro, venda/PDV e compra conforme o escopo usado.
Repetir `/ready`, o smoke HTTP (`./ops/smoke.sh`) e o procedimento de backup/restore
em banco separado. O smoke HTTP não substitui o smoke autenticado.

## Variáveis por finalidade

- Aplicação: `IMAGE_TAG`, `NODE_ENV`.
- Banco: `MIGRATION_DATABASE_URL`, `DATABASE_URL`, `AUTH_DATABASE_URL`.
- Redis: `REDIS_URL` e `REDIS_PASSWORD`.
- URLs/proxy: `WEB_ORIGIN`, `NEXT_PUBLIC_API_URL`, `COOKIE_SECURE`, `TRUST_PROXY`.
- Bootstrap, somente uma vez: `BOOTSTRAP_CONFIRM` e `BOOTSTRAP_*`; nunca manter
  essas variáveis no ambiente permanente da API.
- Backup: caminho do arquivo e `BACKUP_RETENTION_DAYS`.
- Fiscal: `FOCUS_NFE_API_KEY` permanece vazio enquanto FIS-NFCE-01 estiver suspenso.

Não há armazenamento de uploads no produto atual; o backup de dados é PostgreSQL.
Se uploads forem adicionados futuramente, deverão ter rotina de backup/restore
própria antes de o piloto ser marcado como GO.

## GO / NO-GO

Marque `PILOT-02 — GO` somente depois de migrations, bootstrap, login/contexto,
RBAC/RLS, OS, financeiro usado no piloto, backup e restore isolado passarem em
staging. Com a infraestrutura indisponível, a classificação correta é
`PILOT-02 — READY PARA VALIDAÇÃO EM STAGING`; não confundir gates estáticos com
validação operacional.

## Backup

O backup lógico usa formato custom e umask 077. Ownership e ACLs são
preservados; as roles devem existir no cluster de destino antes do restore:

`ENV_FILE=/caminho/seguro.env ./ops/backup.sh /backups/vetoros-AAAA-MM-DD.dump`

O nome deve conter data e hora, por exemplo
`/backups/vetoros-2026-09-11-2300.dump`. Armazene o arquivo fora do host da
aplicação, cifrado, e teste periodicamente a restauração. Para retenção local
opcional, defina `BACKUP_RETENTION_DAYS=30`; somente arquivos explícitos
`vetoros-*.dump` no diretório do backup são removidos após esse prazo. O dump
contém dados pessoais e financeiros.

## Restore validado em banco isolado

O script recusa sobrescrever banco existente. O nome de destino aceita apenas
letras, números e underscore. Ele cria o banco e concede somente os privilégios
de database esperados aos roles migration, runtime e auth antes de restaurar:

`ENV_FILE=/caminho/seguro.env ./ops/restore.sh /backups/vetoros-AAAA-MM-DD.dump vetoros_restore_check`

Depois, aponte temporariamente `MIGRATION_DATABASE_URL`, `DATABASE_URL` e
`AUTH_DATABASE_URL` ao banco restaurado, execute `db:migrate` para confirmar que
não há migrations pendentes destrutivas, inicie API/Web e valide `/ready`, login,
tenant/contexto, clientes, OS, estoque, pagamentos, auditoria e relatórios.
Nunca teste restore sobre o banco corrente.

## Rotina operacional

- Faça backup antes de migration e confirme restore regularmente.
- Monitore reinícios, respostas 503 de `/ready` e logs 5xx por `requestId`.
- Após cada deploy, execute `API_URL=http://127.0.0.1:3001 WEB_URL=http://127.0.0.1:3000 ./ops/smoke.sh`.
- Rotacione credenciais separadamente: administrador PostgreSQL, migration,
  runtime, auth e Redis. A aplicação nunca recebe a credencial administrativa.
- O role runtime não pode criar/alterar schema e está sujeito a RLS forçada; use
  migration apenas no job dedicado.
- Não execute `db:seed` em produção; use o bootstrap protegido acima somente para
  a primeira instalação.
