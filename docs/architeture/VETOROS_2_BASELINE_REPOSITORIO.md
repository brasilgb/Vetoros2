# VetorOS 2 — Baseline do repositório

Data da coleta: 2026-09-02 (America/Sao_Paulo).

## Conclusão executiva

O repositório inspecionado não contém a stack do VetorOS 2 definida pelo prompt. Trata-se do sistema legado, em Laravel 12, PHP, React/Inertia e MySQL. Não há workspace Node/Fastify/Next, schema Drizzle, migrations PostgreSQL ou infraestrutura de RLS. Quatro documentos normativos prioritários também estão ausentes. Portanto, este baseline não autoriza implementar DB-01 neste diretório sem uma decisão explícita sobre o repositório alvo e sem as especificações normativas faltantes.

## Estrutura e stack encontradas

- Aplicação principal monolítica: Laravel em `app/`, rotas em `routes/`, migrations em `database/migrations/`, frontend React/TypeScript em `resources/js/`.
- Aplicações auxiliares: `vetor-atendimento/` e `vetor-tecnico/`, ambas com orientações locais próprias.
- Gerenciadores: Composer (`composer.lock`) e npm (`package-lock.json`). Também existe `yarn.lock`, mas a CI e os comandos documentados usam npm.
- Runtime observado: PHP 8.4.24, Composer 2.9.5, Node 24.18.0 e npm 11.16.0.
- Frameworks instalados: Laravel 12.68.0, React 19.2.0, Inertia React 2.2.19, TypeScript 5.9.3 e Vite 6.4.1.
- Ausentes: Fastify, Next.js e Drizzle.
- Banco configurado em `.env.example`: MySQL na porta 3306. O `Dockerfile` instala `pdo_mysql`; não há bootstrap PostgreSQL.
- Auth: Laravel Auth/Sanctum, especialmente `app/Http/Controllers/Auth`, `config/auth.php` e `app/Models/User.php`.
- Usuários/papéis: um `users.tenant_id` e papel numérico em `users.roles`; permissões são arrays definidos no model. Não existem identities, memberships, grants ou papéis por empresa/filial.
- Testes: 44 arquivos PHP em `tests/`; CI executa typecheck e PHPUnit com SQLite em memória.

## Documentos normativos

Na ordem exigida pelo prompt:

1. `VETOROS_2_ARQUITETURA_MULTITENANCY_ADRS_APROVADOS.md`: ausente.
2. `VETOROS_2_SCHEMA_LOGICO_POSTGRESQL_V1_1.md`: ausente.
3. `VETOROS_2_PLANO_FINAL_IMPLEMENTACAO.md`: ausente.
4. `VETOROS_2_REVISAO_CRITICA_SCHEMA_V1.md`: ausente.
5. `docs/architecture/MULTITENANCY_AND_DATA_OWNERSHIP.md`: presente, não versionado no estado inicial.

## Inventário de banco

Foram encontrados 144 arquivos de migration. As tabelas criadas pelo histórico são:

`account_payable_logs`, `accounts_payable`, `accounts_receivable`, `admin_fiscal_documents`, `admin_fiscal_settings`, `branches`, `budgets`, `cache`, `cache_locks`, `cash_session_logs`, `cash_session_movements`, `cash_sessions`, `checklists`, `companies`, `customers`, `equipment`, `expense_logs`, `expenses`, `failed_jobs`, `features`, `fiscal_documents`, `fiscal_settings`, `help_topics`, `images`, `job_batches`, `jobs`, `maintenance_contract_logs`, `maintenance_contracts`, `messages`, `operational_audits`, `order_commissions`, `order_items`, `order_logs`, `order_parts`, `order_payments`, `order_status_history`, `orders`, `others`, `part_movements`, `parts`, `password_reset_tokens`, `payments`, `periods`, `personal_access_tokens`, `plan_leads`, `plans`, `receipts`, `sale_items`, `sale_logs`, `sales`, `schedule_images`, `schedules`, `sessions`, `settings`, `technician_push_tokens`, `technician_schedule_status_logs`, `tenant_feedbacks`, `tenant_improvement_requests`, `tenants`, `users` e `whatsapp_messages`.

A lista nominal completa das migrations é o conteúdo de `database/migrations/`; nenhuma migration DB-01 foi adicionada.

## Assumptions e riscos single-tenant

- Cada usuário possui no máximo um `tenant_id`; uma identidade não participa de vários tenants.
- `Company` e `Branch` possuem `tenant_id` nullable, e `Branch` não possui `company_id`; a hierarquia Tenant → Empresa → Filial não é garantida fisicamente.
- Chaves primárias são inteiros incrementais, não UUID.
- O isolamento é feito por global scope do Eloquent (`Tenantable`/`TenantScope`) e filtros manuais. Se não houver contexto, o scope não adiciona predicado: não existe fail-closed estrutural.
- Não há RLS, `SET LOCAL app.tenant_id`, roles PostgreSQL nem transação tenant-aware obrigatória.
- IDs relacionados não são protegidos sistematicamente por FKs compostas carregando `tenant_id`.
- Papéis são inteiros globais no registro do usuário e não variam por empresa/filial.
- Há diversas colunas `tenant_id` nullable nas tabelas operacionais antigas.

## Baseline de qualidade

Dependências já existiam; instalação não foi necessária.

| Comando | Resultado | Quantidade | Duração |
|---|---|---:|---:|
| `npm run types` | passou | 0 erros | 99,034 s |
| `npx eslint .` | falhou | 559 erros, 14 avisos, 126/364 arquivos afetados | 14,415 s na coleta JSON |
| `php artisan test` | falhou por ambiente | 4 passaram, 246 falharam, 5 assertions | 54,509 s (suíte: 32,44 s) |
| `npm run build` | passou | build Vite produzido | duração não preservada pelo runner |
| `php artisan migrate:status --no-interaction` | falhou por ambiente/sandbox | conexão MySQL negada (`SQLSTATE[HY000] [2002]`) | 6,4 s junto da coleta |

Todos os testes Feature falharam com `could not find driver` para SQLite em memória; os quatro testes que não dependem desse driver passaram. A CI declara `pdo_sqlite`/`sqlite3`, mas o PHP local não os possui. O lint foi executado sem `--fix` para preservar o baseline. O build remove temporariamente arquivos estáticos de `public/`; eles foram restaurados após o comando.

## Gate do baseline

O baseline está concluído. DB-01 permanece bloqueada tecnicamente neste diretório porque a stack e o banco divergem da arquitetura aprovada, e faltam os quatro documentos de maior precedência. O próximo passo seguro é fornecer o repositório do VetorOS 2 (Node/PostgreSQL) e os documentos normativos, ou autorizar formalmente uma revisão da arquitetura para Laravel.
