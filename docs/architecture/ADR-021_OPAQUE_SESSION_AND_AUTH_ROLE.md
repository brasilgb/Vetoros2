# ADR-021 — Sessão opaca e role global mínima de autenticação

**Status:** aprovado na AUTH-01  
**Data:** 3 de setembro de 2026

## Decisão

Usar sessão opaca server-side, armazenando somente hash SHA-256 do token, e separar a conexão global `vetoros_auth` da conexão tenant-owned `vetoros_runtime`.

`vetoros_auth` não possui `BYPASSRLS`. A descoberta de memberships usa policies restritas ao `app.actor_identity_id`, definido após a identidade ser comprovada por senha ou sessão. Toda operação de domínio continua exigindo `withTenantTransaction`.

## Consequências

Revogação e mudança de tenant têm efeito imediato, e cookies não se tornam fonte de autorização. Há uma consulta ao banco por request autenticado e uma role adicional para operar/rotacionar. Esta separação evita relaxar a RLS da DB-01 para acomodar login global.
