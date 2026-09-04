# ADR-022 — OperationalContext persistido na sessão

**Status:** aprovado na CORE-01  
**Data:** 3 de setembro de 2026

## Decisão

Persistir `active_company_id` e `active_branch_id` na sessão opaca após validação server-side. A escolha é uma preferência operacional, não uma nova fronteira de segurança.

Toda troca revalida Tenant, RLS, status, parentesco Company/Branch e scopes do grant. FKs compostas na sessão impedem combinações inconsistentes. TenantContext continua obrigatório e é derivado exclusivamente da identidade/membership persistidas.

## Consequências

O frontend não precisa repetir contexto em toda navegação e alterações de contexto podem ser auditadas. Em contrapartida, a sessão é atualizada a cada troca e operações concorrentes devem sempre recarregar a sessão, impedindo uso de snapshots antigos após mudança.
