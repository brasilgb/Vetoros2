# VetorOS 2 — Multitenancy e ownership de dados

Este documento operacionaliza, sem substituir, a especificação normativa preservada em `docs/architeture/MULTITENANCY_AND_DATA_OWNERSHIP.md`.

## Hierarquia

```text
Identity ──< TenantMembership ── Tenant ──< Company ──< Branch
                         └── TenantUserProfile ──< AccessGrant
```

- `Identity` é global e pode participar de vários tenants.
- `Tenant` é a fronteira absoluta de segurança SaaS.
- `Company` é o escopo jurídico/fiscal e sempre pertence a um tenant.
- `Branch` é o escopo operacional e pertence à combinação tenant/company.
- Membership representa participação; perfil representa a pessoa naquele tenant; grant representa autorização. Lotação em filial não concede autorização.

## Classificação DB-01

| Escopo | Tabelas |
|---|---|
| Global/control plane | `identities`, `tenants`, `permissions`, `system_role_templates`, `system_role_template_permissions` |
| Tenant-owned/data plane | `tenant_memberships`, `tenant_user_profiles`, `companies`, `branches`, `tenant_roles`, `tenant_role_permissions`, `access_grants`, `branch_memberships`, `audit_events` |

Toda tabela tenant-owned possui `tenant_id NOT NULL`, chave candidata iniciada por tenant, FKs compostas quando cruza entidades tenant-owned e RLS fail-closed. A redundância de `tenant_id` é deliberada para permitir que PostgreSQL valide o ownership sem depender de joins ou somente da aplicação.

## Autorização

RLS garante isolamento entre tenants, não autorização funcional. A API deve validar permission + grant + escopo no backend. O tenant ativo virá de sessão autenticada na futura AUTH-01 e será instalado exclusivamente por transação. `company_id` e `branch_id` enviados pelo cliente são recursos a validar, jamais fonte de autoridade.

## Decisões futuras

Clientes, catálogo, estoque, orçamentos, ordens, financeiro e fiscal permanecem fora da DB-01. Seu ownership aprovado continua documentado na especificação normativa e só deve virar schema em gates posteriores.
