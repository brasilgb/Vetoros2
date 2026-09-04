# VetorOS 2 — Schema Lógico PostgreSQL v1.1

**Status:** consolidado após revisão crítica  
**Data:** 2 de setembro de 2026  
**Base:** Arquitetura Multitenancy + ADRs aprovados + Revisão Crítica do Schema v1  
**Stack alvo:** PostgreSQL 17 + Drizzle ORM + Fastify/TypeScript  
**Gate atual:** apto para derivação do plano de migrations, ainda não é migration SQL.

---

# 1. Objetivo da versão 1.1

Esta versão incorpora os ajustes obrigatórios identificados na revisão crítica do Schema Lógico v1.

Foram corrigidos principalmente:

- unicidade de documentos versus exceção auditada;
- modelagem de system roles e tenant roles;
- grants cross-tenant;
- cardinalidade Identity → Membership → UserProfile;
- RLS fail-closed;
- obrigatoriedade de TenantContext transacional;
- FKs compostas críticas;
- concorrência de estoque;
- transferência com estado em trânsito;
- criação de OS a partir da versão efetivamente aprovada;
- projeções financeiras e de estoque;
- separação entre numeração operacional e fiscal;
- secrets por referências de vault;
- separação de papéis PostgreSQL;
- impersonation com ator real e usuário efetivo.

---

# 2. Hierarquia definitiva

```text
Identity
  └── TenantMembership
        └── TenantUserProfile
              └── AccessGrant

Tenant
  └── Company
        └── Branch
```

Fronteiras:

- **Identity:** autenticação global.
- **Tenant:** limite absoluto de segurança SaaS.
- **Company:** limite jurídico, fiscal e financeiro.
- **Branch:** limite operacional.
- **TenantUserProfile:** perfil daquela identidade naquele Tenant.
- **AccessGrant:** autorização efetiva por escopo.

---

# 3. Convenções físicas

## 3.1 PK

Recomendação mantida:

```text
uuid
```

com geração UUIDv7 na aplicação.

## 3.2 Monetary

```text
numeric(19,4)
```

## 3.3 Quantity

```text
numeric(19,6)
```

## 3.4 Time

Todos timestamps técnicos:

```text
timestamptz
```

armazenados em UTC.

## 3.5 Estados

Preferência:

```text
text + CHECK
```

em vez de PostgreSQL ENUM para estados que podem evoluir.

---

# 4. Identidade e Membership

## 4.1 `identities`

Identidade global.

```text
id uuid PK
email_normalized text NOT NULL
password_hash text NULL
display_name text NOT NULL
status text NOT NULL
mfa_required boolean NOT NULL default false
last_login_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Constraints:

```text
UNIQUE(email_normalized)
CHECK(status IN ('active','blocked','pending'))
```

---

## 4.2 `tenants`

```text
id uuid PK
slug text NOT NULL
legal_name text NOT NULL
trade_name text NULL
status text NOT NULL
default_locale text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Constraints:

```text
UNIQUE(slug)
CHECK(status IN ('trial','active','suspended','cancelled'))
```

---

## 4.3 `tenant_memberships`

Vínculo Identity ↔ Tenant.

```text
id uuid PK
tenant_id uuid NOT NULL
identity_id uuid NOT NULL
status text NOT NULL
joined_at timestamptz NULL
expires_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Constraints:

```text
UNIQUE(tenant_id,id)
UNIQUE(tenant_id,identity_id)
FK tenant_id -> tenants(id)
FK identity_id -> identities(id)
```

---

## 4.4 `tenant_user_profiles`

Substitui o nome genérico `users`.

Cardinalidade aprovada:

```text
1 TenantMembership -> exatamente 1 TenantUserProfile
```

Campos:

```text
id uuid PK
tenant_id uuid NOT NULL
membership_id uuid NOT NULL
name text NOT NULL
phone text NULL
employee_code text NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Constraints:

```text
UNIQUE(tenant_id,id)
UNIQUE(tenant_id,membership_id)
FK (tenant_id,membership_id)
  -> tenant_memberships(tenant_id,id)
```

---

# 5. Company e Branch

## 5.1 `companies`

```text
id uuid PK
tenant_id uuid NOT NULL
legal_name text NOT NULL
trade_name text NULL
tax_id_type text NOT NULL
tax_id_normalized text NOT NULL
state_registration text NULL
municipal_registration text NULL
tax_regime text NULL
currency_code char(3) NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Constraints:

```text
UNIQUE(tenant_id,id)
UNIQUE(tenant_id,tax_id_type,tax_id_normalized)
```

---

## 5.2 `branches`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
code text NOT NULL
name text NOT NULL
timezone text NOT NULL
status text NOT NULL
is_default boolean NOT NULL default false
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Constraints:

```text
UNIQUE(tenant_id,company_id,id)
UNIQUE(tenant_id,company_id,code)

FK (tenant_id,company_id)
  -> companies(tenant_id,id)
```

---

# 6. Roles e Permissions

## 6.1 `permissions`

Catálogo global e estável.

```text
id uuid PK
code text UNIQUE NOT NULL
module text NOT NULL
description text NULL
created_at timestamptz NOT NULL
```

---

## 6.2 `system_role_templates`

Templates globais, read-only no data plane.

```text
id uuid PK
code text UNIQUE NOT NULL
name text NOT NULL
scope_type text NOT NULL
inherits_descendants boolean NOT NULL
is_active boolean NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Não possui `tenant_id`.

Runtime tenant não possui INSERT/UPDATE/DELETE nesta tabela.

---

## 6.3 `system_role_template_permissions`

```text
role_template_id uuid
permission_id uuid
PRIMARY KEY(role_template_id,permission_id)
```

---

## 6.4 `tenant_roles`

Roles efetivas do Tenant.

Uma role pode nascer de um template de sistema, mas vira entidade tenant-owned.

```text
id uuid PK
tenant_id uuid NOT NULL
system_role_template_id uuid NULL
code text NOT NULL
name text NOT NULL
scope_type text NOT NULL
inherits_descendants boolean NOT NULL
is_system_managed boolean NOT NULL default false
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Constraints:

```text
UNIQUE(tenant_id,id)
UNIQUE(tenant_id,code)
```

Isso elimina ambiguidade de role global versus role customizada.

---

## 6.5 `tenant_role_permissions`

```text
tenant_id uuid NOT NULL
role_id uuid NOT NULL
permission_id uuid NOT NULL
created_at timestamptz NOT NULL

PRIMARY KEY(tenant_id,role_id,permission_id)
FK (tenant_id,role_id)
  -> tenant_roles(tenant_id,id)
```

---

# 7. Access Grants

## 7.1 `access_grants`

```text
id uuid PK
tenant_id uuid NOT NULL
user_profile_id uuid NOT NULL
role_id uuid NOT NULL
scope_type text NOT NULL
company_id uuid NULL
branch_id uuid NULL
valid_from timestamptz NOT NULL
valid_until timestamptz NULL
status text NOT NULL
granted_by_user_profile_id uuid NULL
created_at timestamptz NOT NULL
```

Constraints:

```text
UNIQUE(tenant_id,id)

FK (tenant_id,user_profile_id)
  -> tenant_user_profiles(tenant_id,id)

FK (tenant_id,role_id)
  -> tenant_roles(tenant_id,id)
```

Isso torna fisicamente impossível referenciar role de outro Tenant.

Checks:

```text
TENANT  -> company_id IS NULL AND branch_id IS NULL
COMPANY -> company_id IS NOT NULL AND branch_id IS NULL
BRANCH  -> company_id IS NOT NULL AND branch_id IS NOT NULL
```

FKs adicionais:

```text
(tenant_id,company_id)
  -> companies(tenant_id,id)

(tenant_id,company_id,branch_id)
  -> branches(tenant_id,company_id,id)
```

---

# 8. Branch Memberships

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
user_profile_id uuid NOT NULL
job_type text NULL
starts_at timestamptz NOT NULL
ends_at timestamptz NULL
status text NOT NULL
created_at timestamptz NOT NULL
```

Lotação não substitui autorização.

---

# 9. Parties

## 9.1 `parties`

```text
id uuid PK
tenant_id uuid NOT NULL
party_type text NOT NULL
name text NOT NULL
legal_name text NULL
document_type text NULL
document_normalized text NULL
document_verified_at timestamptz NULL
duplicate_exception_reason text NULL
duplicate_exception_approved_by uuid NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
deleted_at timestamptz NULL
```

Constraints:

```text
UNIQUE(tenant_id,id)
```

## 9.2 Política de duplicidade

Não usar UNIQUE absoluto de documento que torne impossível a exceção auditada.

Fluxo:

```text
documento verificado encontrado
→ bloquear criação normal
→ sugerir cadastro existente

exceção
→ capability específica
→ reason obrigatório
→ approved_by obrigatório
→ audit event obrigatório
```

Pode existir índice não-unique para busca:

```text
(tenant_id,document_type,document_normalized)
```

---

## 9.3 `party_contacts`

```text
id uuid PK
tenant_id uuid NOT NULL
party_id uuid NOT NULL
type text NOT NULL
value text NOT NULL
normalized_value text NULL
is_primary boolean NOT NULL
is_verified boolean NOT NULL
consent_status text NULL
provenance text NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

FK:

```text
(tenant_id,party_id)
  -> parties(tenant_id,id)
```

---

## 9.4 `party_addresses`

Mesma regra de FK composta por Tenant.

---

# 10. Company Customers

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
party_id uuid NOT NULL
customer_number bigint NOT NULL
status text NOT NULL
credit_limit numeric(19,4) NULL
payment_terms_id uuid NULL
salesperson_user_profile_id uuid NULL
private_notes text NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Constraints:

```text
UNIQUE(tenant_id,company_id,id)
UNIQUE(tenant_id,company_id,party_id)
UNIQUE(tenant_id,company_id,customer_number)

FK (tenant_id,company_id)
  -> companies(tenant_id,id)

FK (tenant_id,party_id)
  -> parties(tenant_id,id)
```

---

# 11. Equipment

## 11.1 `equipment`

```text
id uuid PK
tenant_id uuid NOT NULL
party_id uuid NOT NULL
category_id uuid NULL
brand_id uuid NULL
model_id uuid NULL
serial_number text NULL
asset_tag text NULL
description text NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Equipment não recebe `company_id` obrigatório.

FK:

```text
(tenant_id,party_id)
  -> parties(tenant_id,id)
```

---

## 11.2 `equipment_ownership_events`

Recomendado para preservar troca de proprietário.

```text
id uuid PK
tenant_id uuid NOT NULL
equipment_id uuid NOT NULL
from_party_id uuid NULL
to_party_id uuid NOT NULL
reason text NULL
actor_user_profile_id uuid NOT NULL
occurred_at timestamptz NOT NULL
created_at timestamptz NOT NULL
```

---

# 12. Produtos

## 12.1 `products`

```text
id uuid PK
tenant_id uuid NOT NULL
type text NOT NULL
name text NOT NULL
description text NULL
category_id uuid NULL
brand_id uuid NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

---

## 12.2 `skus`

```text
id uuid PK
tenant_id uuid NOT NULL
product_id uuid NOT NULL
sku_code text NOT NULL
barcode text NULL
unit_code text NOT NULL
variant_name text NULL
track_stock boolean NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Constraints:

```text
UNIQUE(tenant_id,id)
UNIQUE(tenant_id,sku_code)

FK (tenant_id,product_id)
  -> products(tenant_id,id)
```

---

## 12.3 `company_product_profiles`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
sku_id uuid NOT NULL
enabled boolean NOT NULL
commercial_description text NULL
fiscal_description text NULL
ncm text NULL
cest text NULL
service_code text NULL
origin_code text NULL
tax_profile_id uuid NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Constraints:

```text
UNIQUE(tenant_id,company_id,sku_id)
```

---

## 12.4 `branch_product_availability`

```text
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
sku_id uuid NOT NULL
enabled boolean NOT NULL
sales_enabled boolean NOT NULL
service_usage_enabled boolean NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

---

# 13. Preços

## 13.1 `price_tables`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NULL
name text NOT NULL
currency_code char(3) NOT NULL
valid_from timestamptz NOT NULL
valid_until timestamptz NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

---

## 13.2 `price_entries`

```text
id uuid PK
tenant_id uuid NOT NULL
price_table_id uuid NOT NULL
sku_id uuid NOT NULL
amount numeric(19,4) NOT NULL
valid_from timestamptz NOT NULL
valid_until timestamptz NULL
created_at timestamptz NOT NULL
```

Vigências conflitantes devem ser impedidas na camada de domínio e, quando viável, com exclusion constraint.

---

# 14. Estoque

## 14.1 Fonte oficial

```text
stock_movements
```

é o ledger oficial.

```text
stock_balances
```

é projeção operacional reconstruível.

---

## 14.2 `stock_locations`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
code text NOT NULL
name text NOT NULL
type text NOT NULL
technician_user_profile_id uuid NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

---

## 14.3 `stock_movements`

Append-only.

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
location_id uuid NOT NULL
sku_id uuid NOT NULL
movement_type text NOT NULL
quantity numeric(19,6) NOT NULL
unit_cost numeric(19,4) NULL
source_type text NOT NULL
source_id uuid NULL
correlation_id uuid NULL
idempotency_key text NOT NULL
actor_user_profile_id uuid NULL
reason text NULL
occurred_at timestamptz NOT NULL
created_at timestamptz NOT NULL
```

Constraints:

```text
CHECK(quantity <> 0)
UNIQUE(tenant_id,idempotency_key)
```

---

## 14.4 `stock_balances`

```text
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
location_id uuid NOT NULL
sku_id uuid NOT NULL
physical_quantity numeric(19,6) NOT NULL
reserved_quantity numeric(19,6) NOT NULL
version bigint NOT NULL
updated_at timestamptz NOT NULL
```

PK:

```text
(tenant_id,branch_id,location_id,sku_id)
```

Checks:

```text
physical_quantity >= 0
reserved_quantity >= 0
reserved_quantity <= physical_quantity
```

Não existe CRUD livre nesta tabela.

---

## 14.5 Reserva concorrente

Reserva deve ser feita atomicamente.

Padrão preferencial:

```sql
UPDATE stock_balances
SET reserved_quantity = reserved_quantity + :qty,
    version = version + 1
WHERE tenant_id = :tenant
  AND branch_id = :branch
  AND location_id = :location
  AND sku_id = :sku
  AND physical_quantity - reserved_quantity >= :qty
RETURNING *;
```

Se zero linhas forem retornadas:

```text
estoque insuficiente
```

---

## 14.6 `stock_reservations`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
location_id uuid NOT NULL
sku_id uuid NOT NULL
source_type text NOT NULL
source_id uuid NOT NULL
quantity numeric(19,6) NOT NULL
status text NOT NULL
expires_at timestamptz NULL
idempotency_key text NOT NULL
created_at timestamptz NOT NULL
released_at timestamptz NULL
consumed_at timestamptz NULL
```

---

# 15. Transferência de Estoque

## 15.1 `stock_transfers`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
from_branch_id uuid NOT NULL
to_branch_id uuid NOT NULL
status text NOT NULL
requested_by uuid NOT NULL
approved_by uuid NULL
shipped_at timestamptz NULL
received_at timestamptz NULL
cancelled_at timestamptz NULL
created_at timestamptz NOT NULL
```

Estados:

```text
DRAFT
APPROVED
SHIPPED
IN_TRANSIT
RECEIVED
CANCELLED
```

---

## 15.2 Custódia em trânsito

A transferência não faz diretamente:

```text
Branch A -> Branch B
```

mas:

```text
Branch A
  ↓
TRANSIT location
  ↓
Branch B
```

Isso preserva ownership durante transporte.

---

# 16. Orçamento

## 16.1 `quotes`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
quote_number bigint NOT NULL
company_customer_id uuid NOT NULL
party_id uuid NOT NULL
equipment_id uuid NULL
currency_code char(3) NOT NULL
status text NOT NULL
current_version integer NOT NULL
valid_until timestamptz NULL
source_channel text NULL
created_by_user_profile_id uuid NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Constraint:

```text
UNIQUE(tenant_id,company_id,quote_number)
```

---

## 16.2 `quote_versions`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
quote_id uuid NOT NULL
version_number integer NOT NULL
subtotal numeric(19,4) NOT NULL
discount_total numeric(19,4) NOT NULL
tax_total numeric(19,4) NOT NULL
grand_total numeric(19,4) NOT NULL
terms_snapshot jsonb NULL
sent_at timestamptz NULL
created_by_user_profile_id uuid NOT NULL
created_at timestamptz NOT NULL
```

Constraint:

```text
UNIQUE(tenant_id,quote_id,version_number)
UNIQUE(tenant_id,quote_id,id)
```

---

## 16.3 `quote_items`

Snapshot.

---

## 16.4 `quote_decisions`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
quote_id uuid NOT NULL
quote_version_id uuid NOT NULL
decision text NOT NULL
actor_type text NOT NULL
actor_user_profile_id uuid NULL
capability_id uuid NULL
channel text NOT NULL
evidence jsonb NULL
idempotency_key text NOT NULL
occurred_at timestamptz NOT NULL
created_at timestamptz NOT NULL
```

A decisão sempre aponta à versão exata.

---

# 17. Ordem de Serviço

## 17.1 `work_orders`

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
work_order_number bigint NOT NULL
source_quote_id uuid NULL
source_quote_version_id uuid NULL
source_quote_decision_id uuid NULL
company_customer_id uuid NOT NULL
party_id uuid NOT NULL
equipment_id uuid NULL
status text NOT NULL
priority text NULL
assigned_technician_user_profile_id uuid NULL
opened_at timestamptz NOT NULL
started_at timestamptz NULL
completed_at timestamptz NULL
closed_at timestamptz NULL
created_by_user_profile_id uuid NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Constraints:

```text
UNIQUE(tenant_id,company_id,work_order_number)

UNIQUE(tenant_id,source_quote_id)
WHERE source_quote_id IS NOT NULL
```

FK crítica:

```text
(tenant_id,company_id,source_quote_id)
  -> quotes(tenant_id,company_id,id)
```

A versão também deve pertencer ao mesmo quote.

A criação da OS utiliza:

```text
source_quote_decision_id
→ quote_decisions.quote_version_id
```

Não usa `quotes.current_version` como autoridade.

---

# 18. Work Order Transfer

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
work_order_id uuid NOT NULL
from_branch_id uuid NOT NULL
to_branch_id uuid NOT NULL
status text NOT NULL
reason text NOT NULL
requested_by uuid NOT NULL
executed_by uuid NULL
occurred_at timestamptz NOT NULL
metadata jsonb NULL
```

A policy bloqueia transferência se houver efeitos irreversíveis.

---

# 19. Agenda

Mantida como branch-owned.

```text
appointments
```

deve carregar:

```text
tenant_id
company_id
branch_id
```

com FK composta para Branch.

---

# 20. Venda e PDV

`Sales` continuam branch-owned.

Numeração:

```text
tenant + branch + sale_number
```

---

# 21. Caixa

## 21.1 `cash_terminals`

Branch-owned.

## 21.2 `cash_sessions`

Constraint parcial:

```text
UNIQUE(tenant_id,branch_id,terminal_id)
WHERE status='OPEN'
```

Após CLOSED:

```text
imutável
```

Ajustes posteriores geram novos fatos.

---

## 21.3 `cash_entries`

Append-only.

Sem delete/update retroativo de fato consolidado.

---

# 22. Financeiro

## 22.1 Receivables

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NOT NULL
company_customer_id uuid NULL
party_id uuid NULL
source_type text NOT NULL
source_id uuid NOT NULL
document_number text NULL
currency_code char(3) NOT NULL
original_amount numeric(19,4) NOT NULL
open_amount numeric(19,4) NOT NULL
due_at timestamptz NOT NULL
status text NOT NULL
idempotency_key text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

`open_amount` é projeção controlada.

Não é campo editável em CRUD comum.

---

## 22.2 Receipts

Fato append-only/reversível por evento.

---

## 22.3 Receipt allocations

Fonte para liquidação parcial.

```text
original_amount
- allocations válidas
+ reversões
= open_amount
```

---

## 22.4 Payables

Company-owned; Branch opcional como dimensão.

---

# 23. Comissões

Mantidas como regras versionadas + fatos imutáveis.

`commission_facts` pode referenciar o receipt que adquiriu a comissão.

Estorno:

```text
reverses_commission_fact_id
```

---

# 24. Fiscal

## 24.1 Certificados

### `fiscal_certificates`

Guardar somente metadados + referências ao vault.

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
type text NOT NULL
fingerprint text NOT NULL
serial_number text NULL
issuer text NULL
valid_from timestamptz NOT NULL
valid_until timestamptz NOT NULL
certificate_secret_ref text NOT NULL
password_secret_ref text NOT NULL
status text NOT NULL
created_by_user_profile_id uuid NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Não armazenar blob cifrado diretamente se a infraestrutura possuir vault apropriado.

---

## 24.2 Fiscal Series

Responsável pela numeração fiscal.

```text
id uuid PK
tenant_id uuid NOT NULL
company_id uuid NOT NULL
branch_id uuid NULL
model text NOT NULL
series text NOT NULL
next_number bigint NOT NULL
environment text NOT NULL
status text NOT NULL
version bigint NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Não duplicar esse contador em `number_sequences`.

---

## 24.3 Fiscal Documents

Mantém `provider_code` e `provider_reference` apenas como metadados de transmissão.

Provider não entra na identidade do domínio.

---

# 25. Number Sequences

Somente para numeração operacional.

Exemplos:

```text
QUOTE
WORK_ORDER
SALE
INTERNAL_RECEIPT
```

Não usar para NF-e/NFC-e/NFS-e.

Campos:

```text
id
tenant_id
scope_type
scope_id
document_type
series
next_value
version
updated_at
```

Semântica:

```text
next_value = próximo número ainda não alocado
```

Teste concorrente obrigatório.

---

# 26. Settings

Settings genéricos não armazenam secrets.

Secrets:

```text
secret_ref
```

em estruturas próprias ou secret service.

Herança só para chaves declaradas `INHERITABLE`.

---

# 27. Auditoria

## 27.1 `audit_events`

Append-only.

Campos adicionais para impersonation:

```text
actor_identity_id
effective_user_profile_id
support_access_session_id
```

O ator real nunca é substituído pelo usuário efetivo.

---

# 28. Support Access

## 28.1 `support_access_sessions`

```text
id uuid PK
tenant_id uuid NOT NULL
support_identity_id uuid NOT NULL
effective_user_profile_id uuid NOT NULL
reason text NOT NULL
ticket_reference text NULL
scope_type text NOT NULL
company_id uuid NULL
branch_id uuid NULL
starts_at timestamptz NOT NULL
expires_at timestamptz NOT NULL
ended_at timestamptz NULL
status text NOT NULL
created_at timestamptz NOT NULL
```

TenantContext impersonado:

```ts
{
  tenantId,
  actorIdentityId,
  effectiveUserProfileId,
  supportAccessSessionId
}
```

---

# 29. Outbox

## 29.1 `outbox_events`

Tenant-owned.

Worker lê eventos disponíveis, mas antes de tocar dados de domínio:

```text
carrega tenant_id do evento
→ abre TenantTransaction
→ instala contexto
→ processa
```

Worker não recebe bypass irrestrito do data plane.

---

# 30. Papéis PostgreSQL

Separação recomendada:

## `vetoros_runtime`

- API normal;
- sem BYPASSRLS;
- sem DDL;
- sem acesso a control-plane global.

## `vetoros_worker`

- acesso restrito a filas/outbox;
- sem acesso arbitrário a todos os dados;
- instala contexto de Tenant antes de operar domínio.

## `vetoros_migration`

- DDL;
- migrations;
- não usado por API.

## `vetoros_control_plane`

- operações administrativas específicas da plataforma;
- separado do runtime;
- auditado.

## `vetoros_readonly_ops`

Opcional para observabilidade operacional segura.

---

# 31. RLS Fail-Closed

## 31.1 Princípio

```text
sem tenant context
→ nenhuma linha
→ nenhuma escrita
```

Policy conceitual:

```sql
USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
```

A expressão final deve ser testada para contexto ausente e inválido.

---

## 31.2 FORCE RLS

Recomendação:

```text
avaliar e preferencialmente adotar
FORCE ROW LEVEL SECURITY
```

nas tabelas tenant-owned do data plane.

O owner das tabelas não deve ser usado pela aplicação normal.

---

# 32. Tenant Transaction

Toda operação tenant-owned deve ocorrer dentro de wrapper único.

Exemplo conceitual:

```ts
await withTenantTransaction(context, async (tx) => {
  return useCase.execute(tx);
});
```

Internamente:

```text
BEGIN
SET LOCAL app.tenant_id = ...
SET LOCAL app.identity_id = ...
SET LOCAL app.user_profile_id = ...
...
COMMIT
```

Repositories de domínio recebem `tx`.

Não recebem conexão global livre.

---

# 33. FKs compostas obrigatórias

Exemplos:

```text
branches
(tenant_id,company_id)
  -> companies(tenant_id,id)

company_customers
(tenant_id,party_id)
  -> parties(tenant_id,id)

company_customers
(tenant_id,company_id)
  -> companies(tenant_id,id)

quotes
(tenant_id,company_id,branch_id)
  -> branches(tenant_id,company_id,id)

work_orders
(tenant_id,company_id,branch_id)
  -> branches(tenant_id,company_id,id)

work_orders
(tenant_id,company_id,source_quote_id)
  -> quotes(tenant_id,company_id,id)

stock_movements
(tenant_id,company_id,branch_id,location_id)
  -> stock_locations(...)

fiscal_documents
(tenant_id,company_id,branch_id)
  -> branches(...)
```

---

# 34. Projeções controladas

São projeções e não fontes históricas:

```text
stock_balances
receivables.open_amount
tenant_usage summaries
dashboard aggregates
```

Fonte oficial:

```text
stock_movements
receipt_allocations / financial facts
usage_events
domain events
```

Toda projeção deve ser reconstruível ou reconciliável.

---

# 35. Idempotência

Unicidade por Tenant:

```text
UNIQUE(tenant_id,idempotency_key)
```

quando o escopo for global no Tenant.

Quando um mesmo token puder existir em contextos diferentes:

```text
UNIQUE(tenant_id,scope,idempotency_key)
```

Aplicar especialmente:

- quote approval;
- create OS from quote;
- stock movement;
- receipt;
- fiscal command;
- webhook;
- usage event;
- external integration.

---

# 36. Índices críticos

## OS

```text
(tenant_id,branch_id,status,created_at DESC)
UNIQUE(tenant_id,company_id,work_order_number)
```

## Quotes

```text
(tenant_id,branch_id,status,created_at DESC)
UNIQUE(tenant_id,company_id,quote_number)
```

## Stock

```text
(tenant_id,branch_id,sku_id,location_id)
```

## Finance

```text
(tenant_id,company_id,status,due_at)
```

## Agenda

```text
(tenant_id,branch_id,starts_at)
(tenant_id,technician_user_profile_id,starts_at)
```

## Audit

```text
(tenant_id,aggregate_type,aggregate_id,occurred_at DESC)
(tenant_id,effective_user_profile_id,occurred_at DESC)
```

## Fiscal

```text
UNIQUE(access_key) WHERE access_key IS NOT NULL
(tenant_id,company_id,model,series,number)
```

---

# 37. Regras de imutabilidade

Append-only/reversal:

```text
stock_movements
cash_entries
receipt facts
commission_facts
fiscal_events
audit_events
work_order_status_events
quote_decisions
```

Entidades fechadas não são reescritas silenciosamente.

---

# 38. ADR → Estrutura final

| ADR | Estrutura v1.1 |
|---|---|
| 001 | identities + tenant_memberships + tenant_user_profiles |
| 002 | parties + company_customers |
| 003 | document lookup + exception auditada |
| 004 | grants cross-company explícitos |
| 005 | number_sequences por Company |
| 006 | terminals + sessions |
| 007 | ledger sem negativo |
| 008 | reservations |
| 009 | unique quote→work_order |
| 010 | work_order_transfers |
| 011 | receivables company-owned |
| 012 | commission rules/facts |
| 013 | settings catalog |
| 014 | fiscal domain multi-model |
| 015 | secret refs |
| 016 | retention/audit policies |
| 017 | support_access_sessions |
| 018 | entitlements/usage |
| 019 | branch timezone/company currency |
| 020 | catalog + company profile + branch availability |

---

# 39. Testes obrigatórios do schema

## RLS

- contexto ausente;
- Tenant A lendo Tenant B;
- Tenant A escrevendo Tenant B;
- pool reuse;
- worker context;
- support session.

## Roles

- grant para role de outro Tenant deve falhar fisicamente;
- role template global não pode ser editada pelo runtime;
- role tenant não pode referenciar Tenant diferente.

## Party

- duplicidade normal bloqueada;
- exceção permitida apenas com capability;
- exceção gera audit event.

## Stock

- reserva concorrente;
- consumo concorrente;
- transferência em trânsito;
- reconciliação balance x ledger.

## Quote/OS

- duas criações simultâneas;
- versão aprovada correta;
- branch mismatch;
- company mismatch.

## Fiscal

- certificado de outra Empresa;
- sequência concorrente;
- idempotência;
- provider webhook duplicado.

## Finance

- pagamento parcial;
- reversão;
- open_amount reconciliado;
- caixa fechado imutável.

---

# 40. Gate de aprovação

Após os ajustes da v1.1:

```text
ARQUITETURA DE DOMÍNIO        APROVADA
OWNERSHIP                     APROVADO
MULTITENANCY                  APROVADO
IDENTITY/MEMBERSHIP           APROVADO
ROLES/GRANTS                  APROVADO
RLS                           APROVADO CONCEITUALMENTE
SCHEMA LÓGICO POSTGRESQL v1.1 APTO PARA PLANO DE MIGRATIONS
```

Ainda não é autorização para o CTO escrever migrations diretamente.

Próximo artefato obrigatório:

> **VetorOS 2 — Plano de Migrations PostgreSQL v1 + Testes de Isolamento + Ordem de Implementação**

Depois desse plano:

> prompt técnico para Codex/CTO implementar por fases, com gates de teste e sem big-bang migration.
