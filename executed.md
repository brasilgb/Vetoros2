# Execução de `correio.md`

Data: 2026-09-11

## Comparação

`correio.md` está diferente da versão anterior no Git: 402 linhas adicionadas e
348 removidas. O novo marco é `UX-05 — Padronização Final de Botões de Ação e Tabs`.

## UX-05 — Padronização Final de Botões de Ação e Tabs

Comandos executados na raiz do projeto:

```text
pwd: /home/anderson/projects/laravel/vecos/vetoros2
git diff --stat -- correio.md: PASS — 402 linhas adicionadas, 348 removidas
git diff --check: PASS
pnpm --filter @vetoros/web lint: PASS
pnpm --filter @vetoros/web typecheck: PASS (repetido após o build)
pnpm --filter @vetoros/web test: PASS — nenhum teste unitário Web encontrado (`--passWithNoTests`)
pnpm --filter @vetoros/web build: PASS — todas as rotas Web compiladas
```

Resultados:

- Componentes criados: `apps/web/components/button.tsx` e `apps/web/components/tabs.tsx`.
- Componentes alterados: `AsyncButton`, `FormActions`, `ConfirmDialog` e `RowActionsMenu` passaram a usar a base comum, com variantes semânticas, tamanhos, foco visível e estado disabled.
- Tabs: a tablist da tela de detalhe de OS foi migrada para `Tabs`/`Tab`, com aba ativa evidente, `aria-selected`, foco e overflow horizontal mobile.
- Telas auditadas: dashboard, clientes, equipamentos, OS, orçamentos, agenda, estoque, fornecedores, compras/recebimentos/devoluções, vendas/PDV, caixa, contas a receber/pagar, tesouraria, relatórios, usuários, papéis, empresas, filiais e auditoria/configuração operacional.
- RBAC/estados: nenhuma regra de permissão ou negócio foi alterada; `AsyncButton`, `ConfirmDialog` e condicionais existentes foram preservados.
- Ações destrutivas: continuam usando `ConfirmDialog`; não foram introduzidos `alert()` ou `confirm()`.

## Correções e testes

Foi consolidado o design system mínimo de ações e tabs e corrigido o typecheck
do novo `Button` com `forwardRef`, necessário para manter o foco do diálogo de
confirmação. Nenhuma regra de negócio, API, módulo fiscal ou permissão foi
alterada.

## Pendência objetiva

Ainda existem telas com botões legados implementados por classes inline e a
padronização completa de todas as ações de tabela exige migração incremental
adicional. Não foi marcado `DONE` porque o critério do UX-05 exige que nenhuma
tela permaneça fora do padrão.

## Classificação

`UX-05 — PARTIAL`

Os primitives compartilhados, a tab de OS e os gates Web passaram, mas ainda
há ações inline em parte das telas; portanto a conclusão integral do UX-05
permanece pendente.

`FIS-NFCE-01 permanece suspenso.`

Nenhum commit foi realizado.
