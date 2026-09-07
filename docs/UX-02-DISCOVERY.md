# UX-02 — Descoberta da experiência operacional

Data da análise: 2026-09-07.

## Escopo analisado

Foram inspecionados o App Router inteiro de `apps/web/app`, os componentes compartilhados de
`apps/web/components`, o tratamento de autorização/contexto operacional, os testes E2E e os
componentes de navegação do VetorOS 1. O legado foi usado apenas para identificar conceitos
familiares; sua aparência e suas limitações não são uma especificação para o VetorOS 2.

## Inventário de rotas

Rotas públicas e de sessão:

* `/`, `/login` e `/select-tenant`.

Shell operacional:

* `/app` — visão geral;
* `/app/customers`, `/app/customers/new`, `/app/customers/[id]`;
* `/app/assets`, `/app/assets/new`, `/app/assets/[id]`;
* `/app/service-orders`, `/app/service-orders/new`, `/app/service-orders/[id]`;
* `/app/schedules`, `/app/schedules/new`, `/app/schedules/[id]`;
* `/app/quotes`, `/app/quotes/new`, `/app/quotes/[id]`;
* `/app/inventory`, `/app/inventory/parts`, `/app/inventory/parts/new`,
  `/app/inventory/parts/[id]` e `/app/inventory/movements`;
* `/app/suppliers`, `/app/suppliers/new`, `/app/suppliers/[id]`;
* `/app/purchase-orders`, `/app/purchase-orders/new`, `/app/purchase-orders/[id]`;
* `/app/purchase-receipts`, `/app/purchase-receipts/new`,
  `/app/purchase-receipts/[id]`;
* `/app/purchase-returns`, `/app/purchase-returns/new`, `/app/purchase-returns/[id]`;
* `/app/sales`, `/app/sales/new`, `/app/sales/[id]`;
* `/app/cash` e `/app/cash/sessions/[id]`;
* `/app/payments` e `/app/payments/[id]`;
* `/app/receivables` e `/app/receivables/[id]`;
* `/app/payables`, `/app/payables/new`, `/app/payables/[id]`;
* `/app/financial-accounts`, `/app/financial-accounts/new`,
  `/app/financial-accounts/[id]`;
* `/app/companies`, `/app/companies/new`, `/app/companies/[id]`;
* `/app/branches`, `/app/branches/new`, `/app/branches/[id]`;
* `/app/users`, `/app/users/new`, `/app/users/[id]`;
* `/app/roles`, `/app/roles/new`, `/app/roles/[id]`;
* `/app/audit-logs` e `/app/audit-logs/[id]`.

## Classificação dos fluxos

Entidades complexas, mantidas em listagem e páginas dedicadas de criação/detalhe:

* clientes, equipamentos, ordens de serviço, agenda, orçamentos, peças/produtos;
* fornecedores, pedidos, recebimentos e devoluções de compra;
* vendas, lançamentos/contas financeiras, contas a receber e contas a pagar;
* empresas, filiais, usuários e papéis/permissões.

Entidades simples ou consultas especializadas:

* movimentos de estoque, pagamentos, auditoria e sessões de caixa são consultas/detalhes
  contextuais e não ganham um CRUD artificial;
* o índice de estoque é uma entrada de domínio, não uma tabela do banco exposta no menu.

Operações contextuais, mantidas em diálogo, confirmação ou seção da entidade:

* ativar/inativar, cancelar, mudar status, receber, estornar, movimentar estoque, adicionar item,
  abrir/fechar caixa e registrar observação.

## Estrutura e componentes encontrados

* `AppShell` já fornece uma moldura única para todo `/app`.
* `AppSidebar` já é retrátil no desktop, vira drawer no mobile, mantém a rota ativa, oferece
  tooltip quando recolhida e persiste a preferência em `localStorage`.
* `AppHeader` concentra breadcrumb, empresa, filial e usuário, sem duplicar ações locais.
* `nav-config.ts` já agrupa recursos implementados por domínio operacional.
* `PageHeader`, `SearchToolbar`, `DataTable`, `DataTablePagination`, `FormSection`, `FormField`,
  `FormActions`, `StatusBadge`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `FormDialog`,
  `Menu` e `RowActionsMenu` formam o design system efetivamente reutilizado.
* Dialogs e a sidebar mobile cobrem as necessidades atuais de modal/drawer. Não existe fluxo
  com volume de informação que justifique tabs neste marco.
* As listagens principais já usam a mesma hierarquia e o `DataTable`; colunas secundárias usam
  prioridades responsivas, preservando identificação, status e ação em telas pequenas.

## Inconsistências e duplicações

* Agenda ainda usava `window.confirm` no cancelamento.
* Clientes e fornecedores ainda usavam `window.alert` quando a alteração de status falhava.
* Os três casos quebravam o padrão visual e produziam feedback pouco contextual.
* Não foi encontrada duplicação estrutural de sidebar, header, tabela, vazio, erro ou diálogo.
  Tabelas locais em detalhes representam itens específicos da entidade ou relatórios imprimíveis,
  portanto não devem ser transformadas em listagens CRUD.

## Responsividade e acessibilidade

* O shell prioriza desktop/notebook e oferece drawer no mobile.
* Tabelas preservam rolagem horizontal como fallback e escondem progressivamente colunas menos
  importantes onde aplicável.
* Campos mantêm labels visíveis; dialogs nativos tratam Escape, backdrop e restauração de foco.
* Estados de carregamento, vazio, erro e acesso negado já existem. O ajuste do UX-02 deve remover
  os últimos diálogos nativos do navegador e manter mensagens próximas da ação.

## Permissões

* A UI trata `401`, `403` e ausência de contexto operacional nos fluxos já instrumentados.
* O contexto conhecido destaca empresa/filial ausentes e evita oferecer um fluxo impossível.
* A API continua sendo a autoridade: ocultar ou desabilitar controles na UI não substitui RBAC.

## Familiaridade preservada do VetorOS 1

São preservados sidebar recolhível, agrupamento mental dos módulos, breadcrumb, paginação e
vocabulário operacional. Não são copiados o desenho visual, a proliferação de componentes, os
formulários extensos sem hierarquia nem a navegação guiada por detalhes internos.

## Decisão de implementação

O marco é uma consolidação, não um redesenho. A estrutura atual satisfaz o padrão arquitetural;
as mudanças ficam restritas aos desvios objetivos identificados, sem alterar API, schema, regras
de negócio ou criar módulos.
