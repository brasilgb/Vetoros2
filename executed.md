# Execução de `correio.md`

Data: 2026-09-09

## Comparação

`correio.md` está diferente da versão anterior registrada no Git.

A versão atual autoriza exclusivamente a criação da cobertura automatizada do **OS-ADV-01 — Ordem de Serviço Operacional Completa e Retorno em Garantia**. Ela proíbe nova tentativa de Docker neste executor, não permite continuar CRM-02/CAD-01 e exige manter o marco como `TODO`.

## Implementação desta rodada

Arquivos criados:

- `apps/api/tests/service-order-warranty.integration.test.ts`
- `packages/db/tests/os-adv01-contract.test.ts`

A suíte dedicada contém 12 testes e cobre campos operacionais, técnico e ownership, os três snapshots de garantia, retorno após conclusão/entrega, preservação da OS original, múltiplos retornos, histórico, append-only, isolamento por tenant, FK composta e RBAC.

Nenhum código de domínio, migration ou roadmap foi alterado nesta rodada.

## Validações estáticas

| Comando | Resultado |
|---|---|
| `pnpm --filter @vetoros/db exec vitest run tests/os-adv01-contract.test.ts tests/customer-assets-contract.test.ts` | Passou: 6/6 testes |
| `pnpm --filter @vetoros/api lint` | Passou |
| `pnpm --filter @vetoros/api typecheck` | Passou |
| `pnpm --filter @vetoros/db typecheck` | Passou |
| `pnpm --filter @vetoros/web lint` | Passou |
| `pnpm --filter @vetoros/web typecheck` | Passou |
| `pnpm build` | Passou: builds de DB, web e API concluídos |
| `git diff --check` | Passou |

## Suíte específica de integração

Comando executado:

```text
pnpm --filter @vetoros/api exec vitest run tests/service-order-warranty.integration.test.ts
```

Foram coletados 12 testes: 2 validações locais passaram e 10 não puderam ser concluídos por dependência de banco. Os erros foram `connect EPERM 127.0.0.1:5432` e respostas de autenticação sem PostgreSQL seedado. O Docker não foi tentado novamente, conforme instrução atual.

Ainda é necessário executar externamente, na rede Compose com `postgres` como hostname:

- migration 0032 em PostgreSQL limpo;
- suíte dedicada completa;
- suítes DB/API completas;
- RLS, FK, append-only, RBAC, concorrência e isolamento cross-tenant reais.

## Gate

Os contratos e validações estáticas passaram, mas o gate funcional não pode ser fechado sem PostgreSQL real.

**OS-ADV-01 NÃO APROVÁVEL**

Manter `OS-ADV-01` como `TODO`. Não marcar como `DONE`, não abrir próximo marco, não reabrir CAD-01, não continuar CRM-02 e não fazer commit.
