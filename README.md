# VetorOS 2

Fundação independente do VetorOS legado, em monorepo pnpm com Fastify, Next.js, PostgreSQL/Drizzle e Redis. O escopo atual termina no gate DB-01: identidade global, hierarquia Tenant → Company → Branch, autorização relacional, auditoria e isolamento por RLS.

## Pré-requisitos

- Node.js 24+
- pnpm 11+
- Docker Compose com integração habilitada no ambiente

## Desenvolvimento

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm test
pnpm dev
```

Web: `http://localhost:3000`. API: `http://localhost:3001`; health check: `GET /health`.

## Ambiente Docker para validação visual

```bash
docker compose up -d --build
docker compose ps
```

- Frontend: `http://localhost:3000` → `web:3000` (Next.js em `0.0.0.0`).
- Login: `http://localhost:3000/login`.
- API: `http://localhost:3001` → `api:3001` (Fastify em `0.0.0.0`).
- Health: `http://localhost:3001/health`.
- PostgreSQL (`postgres:5432`) e Redis (`redis:6379`) ficam somente na rede interna do Compose, sem publicação no host.

Chamadas executadas dentro da rede Docker devem usar nomes de serviço. A API usa `postgres:5432` e `redis:6379`; uma futura chamada server-side do Next deve usar `API_INTERNAL_URL=http://api:3001`. O frontend atual faz chamadas diretamente do navegador e, por isso, usa separadamente `NEXT_PUBLIC_API_URL=http://localhost:3001`, com CORS restrito a `WEB_ORIGIN=http://localhost:3000` e cookies com credenciais.

Os serviços one-shot `migrate` e `seed` terminam com código zero antes de a API iniciar. Os healthchecks da API e do frontend controlam a ordem de subida.

## Comandos

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

`db:migrate` exige `MIGRATION_DATABASE_URL`; a API usa somente `DATABASE_URL`, configurada para a role `vetoros_runtime` sem `BYPASSRLS`. Nunca use a role de migration como runtime.

PostgreSQL e Redis são publicados somente em `127.0.0.1` no Compose de desenvolvimento. Em produção, remova as portas e mantenha-os apenas na rede interna.

## Regra tenant-aware

Qualquer acesso a tabela tenant-owned deve ocorrer por `withTenantTransaction`, que instala `app.tenant_id`, ator real e perfil efetivo via `set_config(..., true)`. O terceiro argumento `true` restringe o contexto à transação. IDs recebidos em body ou query nunca definem a autoridade do tenant.

As decisões estão em [docs/architecture/DB01_MULTITENANCY_IMPLEMENTATION.md](docs/architecture/DB01_MULTITENANCY_IMPLEMENTATION.md).
