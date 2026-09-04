# DB-01 — Relatório de execução

Data: 3 de setembro de 2026.

## Resumo e estrutura

Foi criado em `vetoros2` um monorepo pnpm independente com API Fastify, web Next.js/Tailwind, packages de contratos/configuração/banco, Compose para PostgreSQL 17 e Redis 8, schema Drizzle, duas migrations versionadas, seed idempotente, TenantContext, RLS e documentação.

```text
apps/{api,web}
packages/{config,contracts,db,eslint-config}
docker/postgres/init
docs/architecture
compose.yaml
```

## Banco e migrations

- `0000_db01_multitenancy.sql`: 14 tabelas, FKs compostas, índices, RLS forçada/fail-closed, grants de runtime e auditoria append-only.
- `0001_seed_role_templates.sql`: nove templates idempotentes.

O contexto é sempre transacional e usa `set_config(..., true)`. O runtime não recebe `BYPASSRLS`, DDL, escrita em templates globais ou mutação de auditoria.

## Verificações executadas

| Comando | Resultado | Testes |
|---|---|---:|
| `pnpm lint` | passou | 5 projetos com fonte |
| `pnpm typecheck` | passou | 5 projetos TypeScript |
| `pnpm test` | passou | 32 (31 banco + 1 API) |
| `pnpm build` | passou | API, web e 3 packages |
| `pnpm db:migrate` | passou | banco limpo + repetição idempotente |
| `pnpm db:seed` | passou | duas execuções idempotentes |

Os testes cobrem health, TenantContext, contrato estrutural e 13 cenários reais em PostgreSQL 17 sob roles separadas.

## Isolamento exigido

A migration protege leitura, insert, update e delete cross-tenant, ausência de contexto, Company/Branch, perfil/membership e grant/role/branch. Esses cenários, a reutilização de conexão e a concorrência do pool passaram em PostgreSQL real.

## Compatibilidade e legado

Arquivos alterados em `vetoros1`: **nenhum**. Não há migração nem acoplamento com Laravel/MySQL.

## Pendência, risco e gate

Durante a validação foram corrigidos o privilégio `CREATE` da role de migration e um default grant excessivo que concedia DML sobre tabelas globais. O bootstrap final passou após recriação dos volumes.

**DB-01 APROVÁVEL.** Todos os gates obrigatórios da fase estão verdes.

Próxima etapa após fechar este gate: **AUTH-01 — Authentication + Session + Tenant Selection**. Não foi implementada.
