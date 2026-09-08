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

## Backup

O backup lógico usa formato custom e umask 077. Ownership e ACLs são
preservados; as roles devem existir no cluster de destino antes do restore:

`ENV_FILE=/caminho/seguro.env ./ops/backup.sh /backups/vetoros-AAAA-MM-DD.dump`

Armazene o arquivo fora do host da aplicação, cifrado, com retenção e teste
periódico de restauração. O dump contém dados pessoais e financeiros.

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
- Rotacione credenciais separadamente: administrador PostgreSQL, migration,
  runtime, auth e Redis. A aplicação nunca recebe a credencial administrativa.
- O role runtime não pode criar/alterar schema e está sujeito a RLS forçada; use
  migration apenas no job dedicado.
- Não execute `db:seed` em produção. Provisionamento inicial de tenant/admin deve
  seguir procedimento administrativo próprio antes de onboarding real.
