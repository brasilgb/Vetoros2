# REL-01 — Descoberta

Data da análise: 2026-09-07  
Fonte: `correio.md` atual (REL-01 — Relatórios Operacionais Essenciais).

## Resultado da descoberta

O repositório já possui dados canônicos, RLS por `tenant_id` e autorização por
permissões de domínio. Não existe namespace `/reports`, contrato de relatório,
view materializada, snapshot ou permissão `reports.read`. Portanto esta etapa
registra as fontes e as decisões pendentes; nenhum endpoint, tela, cache ou
estrutura persistente de relatório foi criado.

## Inventário de fontes canônicas

| Área | Fonte/campos de evento | Status/valor canônico | Escopo e APIs observadas |
|---|---|---|---|
| OS | `service_orders.opened_at` (evento de abertura), `created_at`; `company_id`, `branch_id`, `customer_id`; técnico não é coluna direta | `open`, `in_progress`, `completed`, `canceled`; itens têm `quantity`, `unit_price`, `discount_amount`, `total_amount` gerado | RLS por tenant; `GET /service-orders` já filtra cliente/status, mas não período/filial; `service_order_items` permite derivar valor somente somando itens |
| Clientes/equipamentos | `customers.created_at`, `status`, `person_type`; `customer_assets.created_at`, `status`, cliente | Cliente: `active`/`inactive`; PF/PJ em `person_type` | RLS/consultas tenant-aware; `GET /customers` não oferece período/status; equipamentos não têm responsável ou valor |
| Vendas | `sales.sale_date` (data de negócio, `date`), `created_at`, `confirmed_at`; `company_id`, `branch_id`, `customer_id` | `draft`, `confirmed`, `cancelled`; subtotal/desconto/total são derivados dos `sale_items` (coluna gerada `total`), não há total persistido em `sales` | `GET /sales` retorna subtotal, desconto e total derivados e filtra cliente/status; não há forma de pagamento na venda, apenas pagamentos vinculados separadamente |
| Caixa/pagamentos | `cash_sessions.opened_at`, `closed_at`; `cash_movements.created_at`; `payments.created_at`; `cash_sessions` tem abertura, esperado no fechamento e contado | Sessão `open`/`closed`; movimentos `opening`, `receipt`, `refund`, `supply`, `withdrawal`; valores `amount`, `resulting_balance`, `expected_amount_at_close`, `closing_amount_informed` | RLS tenant + `branch_id`; `GET /cash-sessions`, indicadores, movimentos e pagamentos existentes; divergência é contado menos esperado, sem contagem informada por forma |
| Financeiro | `financial_transactions.occurred_at` (evento), `created_at`; `financial_account_id`, `company_id`/`branch_id` conforme migration; transferências têm data de criação | Ledger append-only: tipos e sinal devem ser lidos da função/constraint `record_financial_transaction`; `amount` positivo; transferências e reversões possuem vínculos próprios | RLS tenant; `GET /financial-accounts` e transações existentes; não inventar saldo fora da projeção do ledger |
| Recebíveis | `receivables.created_at`, parcelas `due_date`; alocações `created_at` | `original_amount`, cancelamento e valor alocado; pagamentos estornados são excluídos pelas expressões derivadas existentes | Escopo por tenant/filial; `GET /receivables` já expõe status derivado e filtros de vencimento/status |
| Pagáveis | `payables.issue_date`, `created_at`; parcelas `due_date`; pagamentos `paid_at` | `original_amount`, status `canceled` e pagamentos append-only; reversão é lançamento negativo derivado | Escopo por tenant/filial/fornecedor; `GET /payables` já calcula pago, próximo vencimento e status derivado |
| Estoque | `stock_movements.created_at`; `branch_id`, `part_id`, origem de OS/recebimento/devolução | Tipos `entry`, `exit`, `adjustment_in`, `adjustment_out`; `quantity` e `resulting_balance`; posição em `stock_balances.quantity` | RLS tenant e filial ativa; `GET /inventory/balances` e movimentos já usam ledger/função `record_stock_movement`; não existe mínimo/limiar canônico |
| Compras | `purchase_orders.issue_date`/`created_at`; recebimentos `received_at`/`confirmed_at`; devoluções `returned_at`/`confirmed_at` | Pedidos/recebimentos/devoluções: `draft`, `approved`/`confirmed`, `cancelled`; pedido tem `subtotal`, `discount_total`, frete, outros custos e `total` recalculado por trigger | Listagens e filtros de status/fornecedor/filial existem em `/purchase-orders`, `/purchase-receipts` e `/purchase-returns`; quantidade recebida/devolvida é por itens e confirmação atômica |
| Agenda | `schedules.starts_at`, `ends_at`, `created_at`; responsável, OS e filial | `scheduled`, `canceled` | `GET /schedules` usa intervalo semiaberto `[from,to)` em `starts_at`, responsável/status e filial ativa; não é relatório operacional prioritário do escopo, mas é fonte inventariada |

## Consultas, funções, índices e segurança

- As consultas atuais são SQL parametrizado em rotas Fastify; não há views de
  relatório. Funções canônicas relevantes: `record_stock_movement`,
  `confirm_purchase_receipt`, `confirm_purchase_return`, funções de caixa,
  `record_financial_transaction`, geração/alocação de títulos e expressões de
  status derivado em recebíveis/pagáveis.
- Existem índices tenant-first para listagens, status, filial, datas, contas,
  clientes/fornecedores e movimentos (migrations 0004–0030). Antes de qualquer
  relatório novo será necessário medir a consulta real e revisar `EXPLAIN`;
  nenhuma medição foi feita nesta fase porque não há query de relatório
  semanticamente aprovada.
- `withAuthenticatedTenant` configura o contexto usado pelo RLS. O contexto
  ativo também restringe empresa/filial; rotas de estoque, caixa, títulos e
  agenda aplicam filial explicitamente quando a operação é filial-local.
- Permissões existentes são por domínio (`service_orders.read`, `sales.read`,
  `cash.read`, `payments.read`, `receivables.read`, `payables.read`,
  `financial_accounts.read`, `inventory.read`, permissões de compras e
  `customers.read`). `reports.read` não existe. A decisão entre permissão única
  e composição por domínio deve preceder a API; não há exceção especial para
  owner/administrator além do modelo atual.

## Evidência do VetorOS 1

O legado contém telas/listagens e conceitos de dashboard/relatórios, mas não é
fonte de verdade para os cálculos do VetorOS 2. Foi considerado apenas como
indício de navegação e linguagem funcional; nenhuma regra ou saldo foi copiado.

## Métricas confirmadas e pendências

Confirmadas para eventual primeira implementação: contagens e distribuição de
OS por status; vendas por `sale_date`/filial/status com total derivado dos itens;
sessões de caixa e diferença contado–esperado; créditos/débitos/saldo por
`financial_transactions`; entradas/saídas e posição por `stock_movements` e
`stock_balances`; pedidos/recebimentos/devoluções por suas datas, status e
valores; clientes por `created_at`, status e PF/PJ.

Pendências que impedem inventar comportamento:

1. Definir se “período” de cada relatório usa a data de negócio (`sale_date`,
   `issue_date`, `received_at`) ou o timestamp de criação/confirmação, e o
   timezone/locale da conversão.
2. Confirmar o responsável/técnico de OS: não há coluna de responsável em
   `service_orders`; a agenda tem responsável, mas não deve ser misturada sem
   regra de negócio.
3. Confirmar o sinal/tipos exibidos no relatório financeiro e a inclusão de
   transferências/reversões sem duplicar lançamentos.
4. Definir política de escopo quando o usuário possuir acesso de empresa/tenant
   e solicitar várias filiais; o contexto ativo atual é filial única em várias
   rotas.
5. Decidir `reports.read` único versus composição das permissões de domínio.
6. CSV é opcional; se aprovado, deverá ter o mesmo contrato, filtros, limites e
   escopo da visualização.
7. “Estoque baixo” não está confirmado: não existe parâmetro de estoque mínimo.
8. “Valor de OS” e “valor líquido de vendas” precisam de definição explícita;
   total de venda confirmado pode ser derivado, mas não se deve reconstruir
   fluxo financeiro a partir dele.

## Próximo passo autorizado

Somente após resolver as pendências e manter as definições neste documento,
implementar o menor conjunto de endpoints `/reports/...` de leitura, contratos
tipados, UI e testes de isolamento/RBAC.

## Decisões desta implementação

- `from`/`to` são datas ISO e usam intervalo semiaberto `[from,to)`;
- foi criado `GET /reports/summary`, somente leitura e protegido por
  `reports.read`, com OS, vendas, clientes e movimentos de estoque;
- totais são derivados dos itens/ledger existentes; SLA, técnico de OS, estoque
  baixo, lucro, margem, valor líquido e forma de pagamento ficaram fora;
- a UI inicial é `/app/reports`, com KPIs e distribuição por status.
