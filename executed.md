# VetorOS 2 — CRM-01 Customers

**Execução:** 4 de setembro de 2026  
**Status:** concluída e pronta para revisão

## Entrega

- Customer multitenant PF/PJ, CPF/CNPJ normalizado, inscrições, status e timestamps.
- `customer_number` sequencial por tenant, transacional e concorrente, sem `MAX()+1`.
- Endereços normalizados em `customer_addresses`, com principal e múltiplos tipos.
- Contatos normalizados em `customer_contacts` para telefone, celular, WhatsApp e e-mail.
- RLS habilitado/forçado nas tabelas novas e isolamento via Session → TenantContext → Authorization → RLS.
- Permissions `customers.read`, `customers.create`, `customers.update` usando AUTH-01/CORE-01.
- Auditoria append-only de clientes, contatos e endereços.
- API CRUD, busca prefixada, filtros/paginação e manutenção de contatos/endereço.
- Frontend em `/app/customers`, `/app/customers/new` e `/app/customers/:id`.
- Seed PF/PJ para Alpha/Beta, idempotente por ID/documento.

## Arquivos principais

Criados: `packages/db/migrations/0004_customers.sql`, `packages/db/migrations/0005_customer_contacts.sql`, `apps/api/src/customers/routes.ts`, `apps/api/tests/customers.integration.test.ts`, `apps/api/vitest.config.ts`, telas `apps/web/app/app/customers/**` e `docs/architecture/CUSTOMERS01_CUSTOMER_BASE.md`.

Alterados: `packages/db/src/schema.ts`, `packages/db/src/seed.ts`, `packages/db/migrations/meta/_journal.json`, `apps/api/src/app.ts` e `apps/web/app/app/page.tsx`.

## Validação

- `docker compose up -d --build`: passou;
- migration e seed: exit 0;
- lint/typecheck: passaram;
- testes DB: **31/31**;
- testes API: **28/28**;
- health: http://localhost:3001/health → `{"status":"ok"}`;
- login: http://localhost:3000/login → HTTP 200;
- clientes: http://localhost:3000/app/customers → protegido por sessão.

```text
api        Up (healthy)   0.0.0.0:3001->3001/tcp
web        Up (healthy)   0.0.0.0:3000->3000/tcp
postgres   Up (healthy)   5432/tcp interno
redis      Up (healthy)   6379/tcp interno
migrate    Exited (0)
seed       Exited (0)
```

O ambiente permanece em execução. Não foi criado commit.

## Escopo e legado

Equipment, Quote, Service Order, produtos, estoque, financeiro e fiscal não foram iniciados. `vetoros1` não foi alterado.
