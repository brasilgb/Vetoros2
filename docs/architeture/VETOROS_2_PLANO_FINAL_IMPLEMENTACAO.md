# VetorOS 2 — Plano Final de Implementação e Migrations PostgreSQL v1

**Status:** APROVADO PARA EXECUÇÃO CONTROLADA  
**Data:** 2 de setembro de 2026  
**Base normativa:** Arquitetura Multitenancy/Ownership + ADR-001..020 + Schema Lógico PostgreSQL v1.1  
**Stack alvo:** Node.js + Fastify + TypeScript + Next.js + Drizzle ORM + PostgreSQL 17 + Redis + Docker Compose

---

# 1. Objetivo

Executar a reconstrução do VetorOS 2 sobre a arquitetura aprovada, com:

- multitenancy real;
- multiempresa e multifilial;
- segurança desde a fundação;
- orçamento separado da OS;
- estoque por filial;
- caixa por terminal/sessão;
- financeiro por empresa;
- fiscal nativo no domínio;
- RLS PostgreSQL;
- FKs compostas;
- idempotência;
- auditoria;
- evolução incremental sem big-bang migration.

Nenhuma fase posterior pode contornar ou enfraquecer os gates de segurança das fases anteriores.

---

# 2. Princípio de execução

Cada fase segue obrigatoriamente:

```text
INSPECIONAR
→ IMPLEMENTAR
→ MIGRAR
→ TESTAR
→ REVISAR SEGURANÇA
→ DOCUMENTAR
→ GATE
→ COMMIT
```

É proibido:

- implementar várias fases sem gate intermediário;
- aceitar teste quebrado como "pendente";
- criar atalhos sem TenantContext;
- deixar RLS para o final;
- usar frontend como autorização;
- usar `tenant_id` recebido do cliente como autoridade;
- introduzir dual-write sem estratégia explícita;
- alterar migrations já aplicadas em ambiente compartilhado;
- usar `MAX(numero)+1`;
- armazenar secrets em claro;
- permitir bypass RLS ao runtime comum.

---

# 3. Estratégia de branches e commits

Sugestão:

```text
main
└── feat/v2-foundation-multitenancy
└── feat/v2-master-data
└── feat/v2-operations
└── feat/v2-commercial-finance
└── feat/v2-fiscal
└── feat/v2-saas-infra
└── feat/v2-hardening-release
```

Commits devem ser pequenos e semanticamente isolados.

Exemplo:

```text
feat(db): add tenant identity foundation
feat(auth): add tenant context transaction
feat(db): enable tenant RLS policies
test(security): add cross-tenant isolation suite
```

---

# 4. FASE 0 — Descoberta e baseline do repositório

## Objetivo

Antes de escrever migrations, entender exatamente o estado real do VetorOS atual.

## Executar

1. mapear monorepo/workspaces;
2. confirmar versões reais de Node, pnpm/npm, Fastify, Next.js, Drizzle e PostgreSQL;
3. localizar:
   - schemas Drizzle;
   - migrations;
   - auth;
   - users/roles;
   - clientes;
   - OS;
   - produtos;
   - Docker/Compose;
   - testes;
4. listar tabelas existentes;
5. localizar código legado que assume single-tenant;
6. verificar banco vazio versus dados que precisam de migração;
7. executar baseline:
   - install;
   - typecheck;
   - lint;
   - tests;
   - build;
   - docker compose config;
8. registrar falhas preexistentes separadamente.

## Entregável

```text
VETOROS_2_BASELINE_REPOSITORIO.md
```

## Gate 0

Não iniciar DB-01 se:

- build baseline não for compreendido;
- migrations atuais não estiverem mapeadas;
- houver dados existentes sem estratégia;
- auth atual não estiver identificada.

---

# 5. FASE DB-01 — Fundação Multitenant e Segurança

**Prioridade:** CRÍTICA.

## Tabelas

```text
identities
tenants
tenant_memberships
tenant_user_profiles
companies
branches

permissions
system_role_templates
system_role_template_permissions
tenant_roles
tenant_role_permissions
access_grants
branch_memberships

audit_events
```

## Infra de banco

Criar papéis PostgreSQL separados:

```text
vetoros_runtime
vetoros_worker
vetoros_migration
vetoros_control_plane
```

Runtime:

```text
NO BYPASSRLS
NO DDL
```

## TenantContext

Implementar abstraction única:

```ts
withTenantTransaction(context, callback)
```

Responsabilidades:

1. BEGIN;
2. instalar `SET LOCAL app.tenant_id`;
3. instalar actor/effective user;
4. executar callback;
5. commit/rollback;
6. garantir ausência de estado residual.

Repositories tenant-owned recebem somente transaction/context.

## RLS

Habilitar nas tabelas tenant-owned desde esta fase.

Policy:

```text
sem tenant context = deny
tenant correto = permitido pelo RLS
tenant diferente = invisível/bloqueado
```

Avaliar/adotar:

```sql
FORCE ROW LEVEL SECURITY
```

nas tabelas tenant-owned do data plane.

## Seed inicial

Criar catálogo estável de permissions e templates de roles:

```text
owner
administrator
attendance
technician
inventory
cashier
finance
fiscal
read_only
```

Templates não são diretamente grants globais; cada Tenant possui `tenant_roles`.

## Testes obrigatórios

### Tenant

- A não lê B;
- A não insere B;
- A não atualiza B;
- A não deleta B;
- contexto ausente retorna zero/deny;
- `tenant_id` malicioso no body não muda contexto;
- pool não reaproveita contexto anterior.

### Hierarquia

- Branch de Tenant A não referencia Company B;
- Company não muda de Tenant;
- grant de Tenant A não referencia role de B;
- grant Branch não aponta Branch de outra Company.

### Roles

- template global read-only;
- runtime não altera system role template;
- tenant role limitada ao próprio Tenant.

## Gate DB-01

Obrigatório:

```text
typecheck PASS
lint PASS
tests PASS
build PASS
RLS tests PASS
FK cross-tenant tests PASS
pool isolation PASS
```

**Sem DB-01 verde, nenhuma outra tabela de negócio é liberada.**

---

# 6. FASE DB-02 — Cadastros Mestres

## Tabelas

```text
parties
party_contacts
party_addresses
company_customers

equipment
equipment_ownership_events
equipment_categories
equipment_brands
equipment_models

products
skus
company_product_profiles
branch_product_availability

price_tables
price_entries

number_sequences
```

## Regras críticas

### Party

`party` pertence ao Tenant.

`company_customer` pertence à Empresa.

Não criar `UNIQUE` absoluto incompatível com exceção auditada de CPF/CNPJ.

Fluxo de documento:

```text
match normal
→ reutilizar

exceção
→ permission
→ reason
→ approved_by
→ audit
```

### Equipment

Histórico de ownership.

OS antiga preserva snapshot e não muda retroativamente.

### Product

```text
Product/SKU = Tenant
Fiscal profile = Company
Price = Company/Branch
Availability = Branch
```

### Number sequence

Operacional somente.

```text
QUOTE
WORK_ORDER
SALE
INTERNAL_RECEIPT
```

Nunca fiscal.

## Testes

- party cross-tenant;
- company_customer cross-company;
- duplicate document normal;
- duplicate exception auditada;
- SKU unique por Tenant;
- sequence concorrente;
- equipment ownership history.

## Gate DB-02

Todo cadastro deve funcionar com:

```text
Tenant A
  Company A1
  Company A2
Tenant B
```

sem vazamento de dados.

---

# 7. FASE DB-03 — Estoque + Orçamento + OS + Agenda

Esta é a primeira fase de núcleo operacional.

## 7.1 Estoque

Tabelas:

```text
stock_locations
stock_movements
stock_balances
stock_reservations
stock_transfers
stock_transfer_items
```

Fonte oficial:

```text
stock_movements
```

Projeção:

```text
stock_balances
```

### Regras

- sem estoque negativo;
- reserva atômica;
- saldo não tem CRUD manual;
- ajuste sempre gera ledger;
- idempotency key;
- transferência via localização TRANSIT.

### Concorrência

Criar testes paralelos reais para:

```text
última peça
2 requests
apenas 1 reserva deve vencer
```

---

## 7.2 Orçamento

Tabelas:

```text
quotes
quote_versions
quote_items
quote_decisions
```

Estados:

```text
DRAFT
SENT
APPROVED
REJECTED
EXPIRED
CANCELLED
```

Versão enviada é imutável.

Aprovação referencia versão exata.

---

## 7.3 Ordem de Serviço

Tabelas:

```text
work_orders
work_order_items
work_order_status_events
work_order_transfers
work_order_checklists
work_order_checklist_items
work_order_diagnostics
attachments
```

Numeração:

```text
Company scope
```

Invariante:

```text
1 quote → no máximo 1 work order
```

OS gerada usa:

```text
quote_decision
→ quote_version aprovada
```

Não usa `current_version` livremente.

### Transferência

Permitida conforme efeitos:

```text
sem movimento       ALLOW
reserva             CONTROLLED
estoque consumido   REVERSAL FLOW
recebimento         RESTRICT
fiscal autorizado   DENY
closed              DENY
```

---

## 7.4 Agenda

```text
appointments
```

Branch-owned.

Timezone por Branch.

## Gate DB-03

Testes obrigatórios:

- reserva concorrente;
- ledger reconciliation;
- transferência em trânsito;
- quote version imutável;
- aprovação idempotente;
- duas criações simultâneas da mesma OS;
- branch/company mismatch;
- OS direta sem quote;
- transferência bloqueada no estágio correto.

---

# 8. FASE DB-04 — Venda, Caixa e Financeiro

## Tabelas

```text
sales
sale_items

cash_terminals
cash_sessions
cash_entries

payment_methods
company_payment_method_profiles

financial_accounts
receivables
receipts
receipt_allocations
payables
financial_events

commission_rules
commission_facts
```

## Caixa

```text
Branch
→ Terminal
→ Session
→ Entries
```

Constraint:

```text
1 sessão OPEN por terminal
```

Closed = imutável.

## Financeiro

Credor:

```text
Company
```

Origem:

```text
Branch
```

`open_amount` é projeção controlada, não campo livre.

Pagamento parcial é nativo.

Correção = reversão.

## Comissão

Padrão:

```text
aquisição por recebimento
```

Guardar snapshot da regra.

Estorno gera fato inverso.

## Gate DB-04

- dois cash opens simultâneos;
- closed cash immutable;
- partial receipt;
- receipt reversal;
- open_amount reconciliation;
- cross-company financial isolation;
- commission partial receipt;
- commission reversal;
- money never float.

---

# 9. FASE DB-05 — Fiscal Nativo e Integrações

## Fiscal domain

Tabelas:

```text
fiscal_certificates
fiscal_series
fiscal_tax_profiles
fiscal_documents
fiscal_document_items
fiscal_events
```

Preparar:

```text
NFSE
NFE
NFCE
```

Prioridade funcional:

```text
1. NFS-e
2. NF-e
3. NFC-e
```

## FiscalProvider

Domínio independente do vendor.

Adapters externos implementam interface.

O provider não decide:

- ownership;
- tributação;
- autorização;
- numeração interna;
- permission.

## Certificate A1

Banco guarda:

```text
metadata
certificate_secret_ref
password_secret_ref
```

Não guarda segredo recuperável pelo frontend/API normal.

## Fiscal numbering

```text
fiscal_series
```

é responsável pela numeração fiscal.

Não usar `number_sequences`.

## Integrações

```text
integrations
api_keys
webhook_endpoints
integration secrets
```

Secrets armazenados por referência.

Webhooks:

- assinatura;
- anti-replay;
- idempotência;
- reconciliação ativa.

## Gate DB-05

- certificate cross-company FAIL;
- secret never logged;
- fiscal sequence concurrency;
- duplicate issue idempotency;
- duplicate webhook idempotency;
- provider swap não exige schema change;
- authorized fiscal doc immutable.

---

# 10. FASE DB-06 — SaaS, Configuração e Infra Operacional

## Tabelas

```text
settings
templates

plans
plan_features
tenant_subscriptions
tenant_entitlements
usage_events

outbox_events
idempotency_records
support_access_sessions
```

## Settings

Resolução somente quando chave permite:

```text
Branch → Company → Tenant → System
```

Nunca herdar implicitamente:

```text
fiscal
legal
secrets
```

## SaaS

Separar:

```text
ENTITLEMENTS
QUOTAS
RATE LIMITS
```

## Outbox

Worker:

```text
lê envelope
→ obtém tenant_id
→ abre TenantTransaction
→ processa domínio
```

Sem BYPASSRLS irrestrito.

## Impersonation

Guardar:

```text
real actor
effective user
tenant
scope
reason
expiration
```

Secrets continuam inacessíveis.

## Gate DB-06

- quota idempotency;
- setting inheritance tests;
- forbidden fiscal inheritance;
- support expiration;
- support actor audit;
- worker cross-tenant processing;
- outbox retry idempotency.

---

# 11. FASE APP-01 — Auth e Seleção de Escopo

Após DB-01, atualizar aplicação.

## Backend

Endpoints/casos de uso:

```text
login
list memberships
select tenant
list companies
select company
list branches
select branch
effective capabilities
```

Session/token não confia em scope recebido arbitrariamente.

## Frontend

Tenant/company/branch switcher.

O frontend apenas adapta UX.

O backend continua autoridade.

---

# 12. FASE APP-02 — Cadastros

Interfaces:

- clientes;
- contatos;
- endereços;
- equipamentos;
- produtos;
- SKUs;
- perfis por Empresa;
- preços.

UX deve tornar escopo atual visível.

---

# 13. FASE APP-03 — Novo fluxo Orçamento → OS

Este é um dos maiores ajustes funcionais.

## Orçamento

Tela própria:

```text
Novo Orçamento
→ itens
→ versão
→ enviar
→ aprovar/reprovar
```

Após aprovação:

```text
Gerar Ordem de Serviço
```

idempotente.

## OS

OS continua podendo ser aberta diretamente quando operação não exige orçamento.

Na OS originada:

```text
Orçamento #...
Versão aprovada ...
```

visível e imutável.

---

# 14. FASE APP-04 — Estoque, Caixa, Venda e Financeiro

Construir sobre os ledgers, nunca sobre CRUD simplificado.

UX específica para:

- entrada;
- ajuste;
- reserva;
- consumo;
- transferência;
- sessão de caixa;
- recebimento parcial;
- estorno;
- comissão.

---

# 15. FASE APP-05 — Fiscal

Tela de configuração por Empresa:

- regime;
- certificado;
- séries;
- modelos habilitados;
- ambiente homologação/produção;
- status de integrações.

Tela/documentos:

- emitir;
- consultar;
- cancelar;
- acompanhar eventos;
- baixar representação permitida;
- nunca baixar secrets/certificado.

---

# 16. FASE SECURITY-01 — Security Hardening v1

Obrigatória antes de produção externa.

Cobrir:

- autenticação;
- sessões/JWT/cookies;
- MFA quando aplicável;
- CSRF quando aplicável;
- CSP;
- CORS restrito;
- rate limiting;
- validação Zod/server-side;
- autorização backend;
- headers;
- secrets;
- uploads;
- logs/redaction;
- auditoria;
- dependências;
- Docker hardening;
- PostgreSQL/Redis não públicos;
- TLS/Nginx;
- backup/restore;
- RLS penetration tests;
- tenant isolation;
- webhook security;
- fiscal secrets.

Gate:

```text
nenhum CRITICAL/HIGH aberto sem aceite formal
```

---

# 17. FASE QUALITY-01 — Testes de Sistema

Criar cenários E2E com pelo menos:

```text
Tenant Alpha
  Company Alpha-1
    Branch A
    Branch B
  Company Alpha-2
    Branch C

Tenant Beta
  Company Beta-1
    Branch D
```

Matriz:

- users com diferentes grants;
- clientes compartilhados;
- histórico isolado;
- produtos Tenant;
- preço Company/Branch;
- estoque Branch;
- orçamento Company number/Branch operation;
- OS;
- caixa;
- financeiro;
- fiscal.

Executar tentativa deliberada de atravessar cada fronteira.

---

# 18. FASE MIGRATION-LEGACY — Dados do VetorOS atual

Executar somente depois da fundação estabilizada.

## Estratégia

Não fazer dual-write indiscriminado.

Mapear legado:

```text
legacy tenant/account
legacy company
legacy branch
legacy users
legacy customers
legacy products
legacy stock
legacy orders
legacy finance
```

Criar:

```text
migration_mapping
migration_runs
migration_errors
```

Processo:

```text
extract
→ normalize
→ validate
→ transform
→ load
→ reconcile
→ report
```

Dados inconsistentes:

```text
não "consertar silenciosamente"
→ registrar migration issue
```

Saldo legado incorreto:

```text
opening/implementation adjustment
```

auditado.

---

# 19. Observabilidade e operações

Desde DB-01:

- structured logs;
- correlation/request ID;
- tenant ID apenas como identificador técnico permitido;
- nunca PII/secrets desnecessários;
- health/readiness;
- metrics;
- audit;
- backup.

Monitorar:

- RLS errors;
- permission denies;
- transaction errors;
- stock reconciliation;
- financial reconciliation;
- fiscal failures;
- webhook retries;
- outbox lag.

---

# 20. Definition of Done de cada fase

Uma fase só está concluída quando:

```text
[ ] implementação completa
[ ] migrations reproduzíveis
[ ] rollback/forward strategy documentada
[ ] typecheck PASS
[ ] lint PASS
[ ] unit PASS
[ ] integration PASS
[ ] security isolation PASS
[ ] build PASS
[ ] Docker PASS
[ ] documentação atualizada
[ ] nenhum TODO crítico
[ ] nenhum teste skip para esconder falha
[ ] relatório de entrega produzido
[ ] commit efetuado
```

---

# 21. Política de migrations

1. migration é append-only depois de compartilhada;
2. nunca editar migration aplicada;
3. cada migration tem escopo pequeno;
4. DDL e backfill pesado podem ser separados;
5. índices grandes considerar criação apropriada ao ambiente;
6. evitar locks prolongados;
7. migration precisa funcionar em banco limpo;
8. restore test deve funcionar;
9. seed de permissions/templates é idempotente;
10. RLS deve ser testado após migration.

---

# 22. Ordem final de execução

```text
PHASE 0
Baseline

↓
DB-01
Identity + Tenant + Company + Branch
Roles + Grants + Audit + RLS
TENANT TRANSACTION

↓ GATE CRÍTICO

DB-02
Master Data

↓
DB-03
Stock + Quote + Work Order + Agenda

↓
DB-04
Sales + Cash + Finance + Commission

↓
DB-05
Fiscal + Integrations

↓
DB-06
SaaS + Settings + Outbox + Support

↓
APP phases
UX/API per module

↓
SECURITY HARDENING

↓
E2E / Isolation / Performance

↓
LEGACY MIGRATION

↓
STAGING

↓
PRODUCTION
```

---

# 23. Primeiro ciclo autorizado

A execução deve começar **somente por FASE 0 + DB-01**.

O CTO/Codex deve:

1. inspecionar o repositório;
2. produzir baseline;
3. implementar fundação multitenant;
4. implementar RLS e TenantTransaction;
5. executar testes;
6. entregar relatório;
7. PARAR no gate.

Não avançar automaticamente para DB-02.

Essa interrupção é intencional: a fundação será revisada antes de permitir propagação do padrão para dezenas de tabelas.

---

# 24. Critério executivo

O VetorOS 2 não será considerado "multi-tenant" apenas por possuir `tenant_id`.

Ele só será considerado multi-tenant quando:

```text
tenant_id
+ backend authorization
+ TenantContext
+ RLS
+ FKs compostas
+ cache/storage namespaces
+ worker isolation
+ audit
+ cross-tenant tests
```

estiverem todos implementados e testados.

---

# 25. Decisão final

**AUTORIZADO iniciar a execução controlada do VetorOS 2.**

Escopo autorizado neste primeiro ciclo:

```text
FASE 0 + DB-01
```

Gate obrigatório após a entrega.

Nenhuma fase posterior é automaticamente autorizada antes da revisão do resultado da fundação.
