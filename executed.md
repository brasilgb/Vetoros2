# VetorOS 2 — CRM-01 Customers

**Execução:** 4 de setembro de 2026  
**Status:** concluída para revisão

CRM-01 está implementada em `vetoros2` sobre DB-01, AUTH-01 e CORE-01: Customer PF/PJ multitenant, documentos normalizados, numeração sequencial por tenant, endereços e contatos normalizados, RLS, permissions, auditoria, API CRUD com busca/paginação e telas de clientes.

O seed Alpha/Beta é idempotente e módulos posteriores não foram iniciados.

## Validação

- Build Docker, migrations e seed: passaram;
- lint/typecheck: passaram;
- DB: **31/31 testes**;
- API: **28/28 testes**;
- Frontend login: HTTP 200 em http://localhost:3000/login;
- Health: `{"status":"ok"}` em http://localhost:3001/health.

```text
api        Up (healthy)   0.0.0.0:3001->3001/tcp
web        Up (healthy)   0.0.0.0:3000->3000/tcp
postgres   Up (healthy)   5432/tcp interno
redis      Up (healthy)   6379/tcp interno
migrate    Exited (0)
seed       Exited (0)
```

Ambiente permanece em execução. Nenhum commit foi criado.

`vetoros1` não foi alterado.

## Login faker local

Foi adicionada uma identidade de desenvolvimento para validação visual:

- e-mail: `andersonbrasil72@gmail.com`;
- senha padrão: `12345678` (configurável por `DEV_FAKER_PASSWORD`);
- tenant: Alpha;
- resultado validado: login e sessão HTTP autenticados.

A credencial é criada com hash Argon2 e fica bloqueada sem membership quando `NODE_ENV=production`. O serviço `seed` recebe `NODE_ENV` pelo Compose para preservar essa proteção.
