# E2E (Playwright)

Suíte mínima e permanente para proteger os padrões de UX construídos em UX-01/UX-02/UX-03
(shell, contexto operacional, seletor de entidades, diálogos, mobile) — não tenta cobrir o
VetorOS inteiro (seção 15 do `correio.md` UX-03).

## Pré-requisitos

Como o resto do projeto, precisa da aplicação **de verdade** rodando — Postgres + API + Web —,
não só do frontend isolado:

```bash
# na raiz do Vetoros2, com um Postgres local de pé (ver compose.yaml/.env.example)
pnpm db:migrate
pnpm db:seed
pnpm --filter @vetoros/api dev &
pnpm --filter @vetoros/web dev &
```

## Rodando

```bash
pnpm --filter @vetoros/web test:e2e
```

Na primeira vez, instale o navegador do Playwright:

```bash
pnpm --filter @vetoros/web exec playwright install chromium
```

Variáveis de ambiente opcionais: `E2E_BASE_URL` (padrão `http://localhost:3000`), `E2E_EMAIL` e
`E2E_PASSWORD` (padrão: usuário de desenvolvimento seedado por `packages/db/src/seed.ts`).

## O que está coberto

| Arquivo | Seção do correio.md |
|---|---|
| `01-login-and-shell.spec.ts` | 15.1 — login, shell, navegação |
| `02-operational-context.spec.ts` | 15.2 — bloqueio/orientação proativa, seleção de contexto |
| `03-customer-combobox.spec.ts` | 15.3 — seleção de Cliente por busca, sem ID digitado |
| `04-confirm-dialog.spec.ts` | 15.4 — abrir/cancelar/confirmar diálogo |
| `05-mobile.spec.ts` | 15.5 — drawer, contexto pelo menu, sem overflow horizontal |

Todos os testes usam dados já seedados (`Company Alpha`, `Branch Alpha`, `Cliente Alpha PF`) em
vez de criar registros novos — determinístico entre execuções, sem depender de limpeza de banco
entre rodadas. O teste de diálogo restaura o status que alterou ao final, para poder rodar
repetidamente sem acumular efeito.
