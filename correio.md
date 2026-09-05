# COM-04 — Devolução de Mercadorias ao Fornecedor

## Objetivo

Implementar no `vetoros2` o domínio de **Devolução de Mercadorias ao Fornecedor**, preservando integralmente os marcos já aprovados:

* DB-01;
* AUTH-01;
* CORE-01;
* CRM-01;
* CRM-02;
* OS-01;
* OS-02;
* CRM-03;
* EST-01;
* EST-02;
* COM-01;
* COM-02;
* COM-03.

Esta fase deve permitir devolver ao fornecedor, de maneira controlada e rastreável, mercadorias que tenham sido efetivamente recebidas através de Recebimentos de Pedidos de Compra.

A devolução deve produzir a saída correspondente no estoque somente quando for confirmada.

Não alterar `vetoros1`.

Não implementar funcionalidades fiscais ou financeiras nesta fase.

Não criar commit ao final. Entregar para revisão.

---

# 1. Descoberta obrigatória antes da implementação

Antes de criar qualquer migration ou alterar código, revisar pelo menos:

* `suppliers`;
* `purchase_orders`;
* `purchase_order_items`;
* `purchase_receipts`;
* `purchase_receipt_items`;
* `inventory_parts`;
* `stock_movements`;
* `stock_balances`;
* `record_stock_movement`;
* `confirm_purchase_receipt`;
* contexto Tenant / Company / Branch;
* RLS;
* RBAC;
* auditoria;
* padrões de numeração transacional existentes;
* frontend de Compras;
* testes COM-01, COM-02, COM-03, EST-01 e EST-02.

Responder explicitamente no `executed.md`:

1. Existe atualmente alguma entidade que represente devolução física ao fornecedor de forma inequívoca?
2. Existe algum mecanismo existente que possa ser reutilizado para retirar estoque atomicamente?
3. `record_stock_movement` suporta de forma segura uma saída originada por devolução de compra?
4. Existe hoje vínculo inequívoco entre `stock_movements` e uma eventual devolução?
5. A quantidade devolvível pode ser derivada integralmente dos recebimentos confirmados e devoluções confirmadas?
6. Existe necessidade real de armazenar `returned_quantity` em `purchase_receipt_items` ou `purchase_order_items`?
7. A devolução deve obrigatoriamente apontar para um recebimento específico ou apenas para o pedido?
8. Company e Branch devem ser herdados do recebimento original?
9. Há algum ponto do COM-03 que precisará ser alterado para suportar devoluções?
10. Existe risco de corrida entre duas devoluções simultâneas do mesmo item recebido?
11. Existe risco de uma devolução simultânea a outra operação de estoque causar saldo inconsistente?
12. Quais invariantes precisam estar garantidos no banco e não somente na API?

Não criar schema antes de concluir essa análise.

---

# 2. Modelo conceitual obrigatório

A cadeia operacional deve ficar explicitamente:

`Fornecedor`
→ `Pedido de Compra`
→ `Recebimento`
→ `Entrada no Estoque`
→ `Devolução ao Fornecedor`
→ `Saída do Estoque`

A devolução não substitui, edita, apaga ou reabre o recebimento original.

Um recebimento confirmado é um fato histórico.

Uma devolução posterior é outro fato histórico.

Portanto:

**é proibido implementar devolução alterando a quantidade do recebimento original ou removendo seu `stock_movement`.**

---

# 3. Regra fundamental de origem

A devolução deve estar vinculada a um **Recebimento de Compra confirmado**.

Preferencialmente adotar:

* `purchase_return`

  * pertence a um `purchase_receipt`;
* cada `purchase_return_item`

  * pertence a um `purchase_receipt_item`.

Isso fornece rastreabilidade exata da mercadoria fisicamente recebida que está sendo devolvida.

Não usar apenas `purchase_order_id` como origem caso isso permita perder a relação com qual recebimento originou a entrada.

Caso a arquitetura existente demonstre uma alternativa melhor, justificar detalhadamente no `executed.md`.

---

# 4. Entidades esperadas

Avaliar a criação de:

## `purchase_return_number_counters`

Contador transacional por tenant, seguindo os padrões já existentes.

## `purchase_returns`

Campos mínimos esperados:

* `id`;
* `tenant_id`;
* `company_id`;
* `branch_id`;
* `purchase_receipt_id`;
* número sequencial por tenant;
* `status`;
* `returned_at`;
* `reason`;
* `notes`;
* `confirmed_at`;
* `created_by`;
* `updated_by`;
* timestamps.

Status mínimos:

* `draft`;
* `confirmed`;
* `cancelled`.

## `purchase_return_items`

Campos mínimos esperados:

* `id`;
* `tenant_id`;
* `purchase_return_id`;
* `purchase_receipt_id`;
* `purchase_receipt_item_id`;
* `inventory_part_id`;
* descrição snapshot;
* `quantity numeric(...)`;
* timestamps.

Quantidade obrigatoriamente maior que zero.

Evitar armazenamento redundante de informações que possam ser derivadas inequivocamente.

---

# 5. Integridade estrutural no banco

Garantir no banco, preferencialmente com FKs compostas, que:

1. a devolução pertence ao mesmo tenant do recebimento;
2. o item da devolução pertence à própria devolução;
3. o `purchase_receipt_item_id` pertence ao mesmo `purchase_receipt_id` da devolução;
4. a peça pertence ao mesmo tenant;
5. quando necessário, a peça do item devolvido corresponda estruturalmente à peça do item recebido;
6. Company e Branch não possam divergir da origem.

Não depender exclusivamente de validações TypeScript para essas invariantes.

Se necessário adicionar constraints ou índices únicos auxiliares em entidades anteriores para permitir FKs compostas, fazê-lo somente de forma backward-compatible e justificar.

---

# 6. Company e Branch

A devolução deve herdar:

* `tenant_id`;
* `company_id`;
* `branch_id`;

do recebimento original.

A API não deve aceitar Company ou Branch arbitrários vindos do cliente para decidir a origem física da devolução.

O contexto operacional ativo da sessão continua sendo exigido conforme os gates já existentes, mas não deve sobrescrever a Branch física do recebimento original.

---

# 7. Quantidade devolvível

A quantidade máxima devolvível por `purchase_receipt_item` deve ser:

`quantidade recebida confirmada`
−
`quantidade já devolvida em devoluções confirmadas`

Não persistir `returned_quantity` no recebimento se ela puder ser derivada corretamente.

Exemplo:

Recebimento R1:

* item A: 10 unidades.

Devolução D1 confirmada:

* item A: 3.

Situação:

* recebido: 10;
* devolvido: 3;
* devolvível: 7.

Nova devolução de 8 deve falhar.

Nova devolução de 7 deve ser permitida.

---

# 8. Recebimentos múltiplos

O sistema precisa respeitar a origem específica.

Pedido:

* item A: 20.

Recebimento R1:

* 8 unidades.

Recebimento R2:

* 12 unidades.

Uma devolução vinculada a R1 não pode devolver mais de 8 unidades desse recebimento, mesmo que o pedido inteiro tenha recebido 20.

Não agregar implicitamente recebimentos distintos em uma devolução caso isso destrua a rastreabilidade.

Caso futuramente seja desejável devolver itens de múltiplos recebimentos em um único documento, isso fica fora deste escopo, salvo se a arquitetura atual permitir isso de maneira natural e inequívoca.

---

# 9. Confirmação e estoque

Nenhuma criação ou edição de devolução em `draft` pode alterar:

* `stock_movements`;
* `stock_balances`.

Somente a confirmação da devolução pode movimentar estoque.

A confirmação deve:

1. validar a devolução;
2. validar o recebimento de origem;
3. validar quantidades devolvíveis;
4. confirmar o documento;
5. gerar uma saída de estoque por item;
6. atualizar `stock_balances`;
7. registrar a origem da movimentação;
8. ocorrer atomicamente.

Se qualquer item falhar, toda a operação deve fazer rollback.

Não permitir confirmação parcial do documento.

---

# 10. Ledger de estoque

Reutilizar `record_stock_movement` se tecnicamente adequado.

Não criar uma segunda implementação concorrente de atualização de saldo.

Caso `stock_movements` ainda não possua origem para devolução, avaliar adicionar campos nullable como:

* `purchase_return_id`;
* `purchase_return_item_id`.

Manter compatibilidade com as origens já existentes:

* movimentos manuais;
* Ordem de Serviço;
* Recebimento de Compra;
* outras já implementadas.

Não alterar historicamente movimentos existentes.

---

# 11. Tipo de movimento

A devolução ao fornecedor representa saída física.

Reutilizar um tipo de movimento existente somente se a semântica for inequívoca.

Caso o ledger possua apenas algo como `out`, manter o tipo e usar os campos de origem para identificar que se trata de devolução ao fornecedor.

Não criar enums desnecessariamente específicos se a arquitetura do ledger separa corretamente:

* direção/tipo da movimentação;
* origem da movimentação.

Documentar a decisão.

---

# 12. Saldo insuficiente

Uma devolução confirmada não pode produzir saldo inválido.

Exemplo:

* foram recebidas 10 unidades;
* 6 ainda estão disponíveis;
* 4 já foram consumidas por OS;
* usuário tenta devolver 10.

A devolução deve falhar caso a política atual de estoque não permita saldo negativo.

Reutilizar as regras vigentes do EST-01/EST-02.

Não criar exceção para Compras.

A existência de 10 unidades historicamente recebidas não significa necessariamente que 10 unidades ainda estão fisicamente disponíveis para devolução.

Portanto existem **duas validações independentes**:

1. quantidade devolvida não pode superar a quantidade efetivamente recebida ainda não devolvida;
2. o estoque atual deve possuir saldo suficiente conforme as regras do módulo EST.

---

# 13. Concorrência

Este é critério crítico de aceite.

Devem ser analisadas e protegidas duas formas de concorrência:

## A. Duas devoluções simultâneas sobre o mesmo item recebido

Exemplo:

Recebido:

* 10.

Duas devoluções simultâneas:

* D1 = 6;
* D2 = 6.

Resultado obrigatório:

* somente uma pode confirmar;
* a outra deve falhar;
* total devolvido nunca pode chegar a 12.

## B. Devolução concorrente com consumo de estoque

Exemplo:

Saldo atual:

* 10.

Ao mesmo tempo:

* devolução tenta retirar 8;
* Ordem de Serviço tenta consumir 5.

O ledger/saldo deve permanecer consistente e respeitar a política vigente sobre saldo negativo.

A implementação deve usar locking determinístico e transação adequada.

Reaproveitar os mecanismos já usados em:

* `record_stock_movement`;
* `confirm_purchase_receipt`;
* EST-02;

sempre que aplicável.

Evitar locks adquiridos em ordens diferentes que possam criar deadlock.

Documentar no `executed.md`:

* quais linhas são travadas;
* em qual ordem;
* quando as quantidades são recalculadas;
* por que não ocorre over-return;
* por que o saldo não fica inconsistente.

---

# 14. Idempotência da confirmação

Confirmar novamente uma devolução já `confirmed` não pode:

* gerar nova saída;
* duplicar `stock_movements`;
* reduzir novamente `stock_balances`.

Pode retornar HTTP 200 com indicação de operação idempotente, seguindo o padrão adotado no COM-03.

A proteção deve existir no backend/banco.

Não depender de botão desabilitado no frontend.

---

# 15. Cancelamento

Uma devolução em `draft` pode ser cancelada.

Uma devolução `confirmed` não deve ser cancelada por simples mudança de status.

Uma devolução confirmada já provocou fato físico e movimento de estoque.

Portanto:

**não implementar estorno de devolução confirmada nesta fase.**

Se futuramente for necessário desfazer uma devolução, isso deverá ser modelado como operação inversa explícita e auditável, não como edição destrutiva do histórico.

---

# 16. Imutabilidade após confirmação

Depois de `confirmed`:

* cabeçalho não pode ser alterado;
* itens não podem ser criados;
* itens não podem ser alterados;
* itens não podem ser removidos;
* quantidade não pode ser modificada;
* recebimento de origem não pode ser trocado.

A devolução passa a ser somente leitura.

---

# 17. RBAC

Criar permissões no padrão vigente:

* `purchase_returns.read`;
* `purchase_returns.create`;
* `purchase_returns.update`;
* `purchase_returns.confirm`.

Cancelamento de `draft` pode utilizar `.update`, se isso estiver consistente com COM-02 e COM-03.

Atualizar:

* catálogo de permissões;
* templates/papéis pertinentes;
* seed.

Não criar permissões fiscais ou financeiras.

---

# 18. RLS

Todas as novas tabelas devem ter:

* RLS habilitado;
* RLS forçado;
* isolamento por `vetoros_current_tenant_id()`;
* `USING`;
* `WITH CHECK`;

seguindo os módulos anteriores.

Adicionar testes cross-tenant explícitos.

---

# 19. Auditoria

Registrar pelo menos:

* `purchase_return.created`;
* `purchase_return.updated`;
* `purchase_return.confirmed`;
* `purchase_return.cancelled`;
* `purchase_return_item.created`;
* `purchase_return_item.updated`;
* `purchase_return_item.deleted`.

Na confirmação, incluir metadata suficiente para rastrear:

* fornecedor;
* pedido;
* recebimento;
* devolução;
* usuário;
* Branch;
* idempotência, quando aplicável.

Não duplicar no audit log o ledger quantitativo.

`stock_movements` continua sendo a fonte de verdade da movimentação física.

---

# 20. API esperada

Avaliar implementar:

* `GET /purchase-returns`;
* `POST /purchase-returns`;
* `GET /purchase-returns/:id`;
* `PATCH /purchase-returns/:id`;
* `POST /purchase-returns/:id/cancel`;
* `POST /purchase-returns/:id/confirm`;

Itens:

* `GET /purchase-returns/:id/items`;
* `POST /purchase-returns/:id/items`;
* `PATCH /purchase-returns/:id/items/:itemId`;
* `DELETE /purchase-returns/:id/items/:itemId`.

Origem:

* `GET /purchase-receipts/:id/returns`;

Opcionalmente estender o detalhe do recebimento para expor:

* `returned_quantity`;
* `returnable_quantity`;
* estado de devolução, se houver significado inequívoco.

Não criar estado artificial se apenas as quantidades forem suficientes.

---

# 21. Criação da devolução

Preferencialmente iniciar a devolução a partir de:

`/app/purchase-receipts/:id`

Exibir ação:

**Devolver mercadorias**

somente quando:

* recebimento estiver `confirmed`;
* houver ao menos um item com quantidade ainda devolvível.

Ao criar, carregar apenas itens potencialmente devolvíveis.

Não permitir iniciar devolução sobre:

* recebimento `draft`;
* recebimento `cancelled`.

---

# 22. Frontend

Criar interface mínima consistente com módulos anteriores.

## `/app/purchase-returns`

Listagem com pelo menos:

* número;
* fornecedor;
* pedido;
* recebimento;
* filial;
* data;
* status.

Filtros mínimos:

* status;
* busca quando compatível com padrão atual.

## `/app/purchase-returns/new?purchaseReceiptId=...`

Mostrar:

* fornecedor;
* Pedido de Compra;
* número do recebimento;
* Branch;
* itens recebidos;
* quantidade recebida;
* quantidade já devolvida;
* quantidade ainda devolvível;
* saldo atual quando útil;
* campo “devolver agora”.

Usar `max` no frontend quando aplicável, mas autoridade final sempre no backend/banco.

## `/app/purchase-returns/:id`

Mostrar:

* cabeçalho;
* fornecedor;
* pedido;
* recebimento de origem;
* Branch;
* status;
* motivo;
* observações;
* itens;
* recebido;
* já devolvido antes;
* devolvido nesta ocorrência;
* restante devolvível.

Enquanto `draft`:

* editar;
* incluir/remover itens;
* confirmar;
* cancelar.

Após `confirmed`:

* somente leitura.

Adicionar navegação “Devoluções” ou nomenclatura equivalente dentro de Compras.

---

# 23. Detalhe do Recebimento

Estender `/app/purchase-receipts/:id` para tornar visível a consequência das devoluções.

Por item, quando aplicável:

* quantidade recebida;
* quantidade devolvida confirmada;
* quantidade ainda devolvível.

Exibir histórico/lista de devoluções relacionadas.

Não alterar a quantidade original do recebimento.

---

# 24. Relação com Pedido de Compra

Não alterar retroativamente a quantidade pedida.

Não utilizar devolução para mudar:

* quantidade solicitada;
* preço negociado;
* status comercial original do Pedido de Compra.

O Pedido representa o documento comercial.

O Recebimento representa o fato físico de entrada.

A Devolução representa um novo fato físico de saída.

Manter essas fronteiras explícitas.

---

# 25. Estado físico do Pedido

Não modificar automaticamente `purchase_orders.status` por causa de devoluções, salvo se houver regra já existente e inequívoca que exija isso.

O `receipt_state` do COM-03 representa quanto do pedido foi recebido.

Uma devolução posterior não deve transformar historicamente um pedido que foi recebido em “não recebido”.

Exemplo:

Pedido:

* 10.

Recebido:

* 10.

Depois devolvido:

* 10.

Historicamente o Pedido **foi recebido**.

Portanto o `receipt_state` pode continuar `received`.

Se for necessário apresentar o estoque líquido decorrente de compras/devoluções, isso deve ser outra informação derivada, não adulteração semântica de `receipt_state`.

Documentar essa decisão explicitamente.

---

# 26. Testes obrigatórios de banco

Criar suíte dedicada, por exemplo:

`packages/db/tests/purchase-returns-contract.test.ts`

Cobrir ao menos:

1. existência das entidades;
2. contador transacional;
3. Tenant/Company/Branch;
4. FK para recebimento;
5. FK para item do recebimento;
6. item não pode pertencer a outro recebimento;
7. peça same-tenant;
8. quantidade positiva;
9. RLS habilitado;
10. RLS forçado;
11. origem da devolução no ledger;
12. reutilização de `record_stock_movement`;
13. ausência de alteração direta de `stock_balances`;
14. locking da confirmação;
15. idempotência;
16. bloqueio de recebimento não confirmado;
17. bloqueio de over-return;
18. imutabilidade após confirmação;
19. ausência de escopo fiscal/financeiro;
20. invariantes de same-tenant.

---

# 27. Testes obrigatórios de API

Criar suíte dedicada, por exemplo:

`apps/api/tests/purchase-returns.integration.test.ts`

Cobrir no mínimo:

### Autenticação/contexto

1. sem sessão → 401;
2. sem tenant → erro esperado;
3. sem contexto operacional → erro esperado;
4. sem permissão → 403.

### Origem

5. recebimento inexistente → 404;
6. recebimento cross-tenant → invisível/404;
7. recebimento `draft` → rejeitar;
8. recebimento `cancelled` → rejeitar;
9. recebimento `confirmed` → permitir;
10. item não pertencente ao recebimento → rejeitar;
11. peça cross-tenant → rejeitar.

### Quantidade

12. zero → rejeitar;
13. negativa → rejeitar;
14. acima da quantidade recebida → rejeitar;
15. acima da quantidade ainda devolvível → rejeitar;
16. quantidade válida parcial → permitir;
17. múltiplas devoluções até atingir exatamente o recebido → permitir;
18. devolução adicional depois de atingir o limite → rejeitar.

### Estoque

19. criar `draft` não altera estoque;
20. editar `draft` não altera estoque;
21. cancelar `draft` não altera estoque;
22. confirmar gera saída;
23. `stock_balance` é atualizado;
24. movimento contém origem da devolução;
25. reconfirmar não duplica movimento;
26. saldo insuficiente bloqueia devolução;
27. falha em um item faz rollback de todos.

### Estado

28. editar confirmado → bloquear;
29. incluir item em confirmado → bloquear;
30. alterar item confirmado → bloquear;
31. remover item confirmado → bloquear;
32. confirmar cancelado → bloquear;
33. confirmar vazio → bloquear;
34. cancelar confirmado → bloquear.

### Consulta

35. listagem;
36. busca;
37. paginação;
38. detalhe;
39. 404;
40. isolamento cross-tenant;
41. listagem por recebimento.

---

# 28. Testes obrigatórios de concorrência

Estes testes são critério de aceite.

## Cenário 1 — over-return

Recebimento confirmado:

* 10 unidades.

Criar duas devoluções `draft`:

* D1 = 6;
* D2 = 6.

Confirmá-las concorrentemente.

Resultado esperado:

* exatamente uma confirmação bem-sucedida;
* exatamente uma rejeitada;
* total devolvido confirmado = 6;
* saldo reduzido apenas uma vez;
* jamais 12.

## Cenário 2 — limite exato

Recebimento confirmado:

* 10.

D1:

* 5.

D2:

* 5.

Confirmar concorrentemente.

Resultado esperado:

* ambas podem confirmar;
* total devolvido = 10;
* retorno disponível = 0;
* estoque reduzido exatamente em 10.

## Cenário 3 — concorrência com estoque

Preparar saldo de forma que duas operações concorrentes não possam ambas ocorrer sem violar o saldo disponível.

Executar em paralelo:

* confirmação de devolução;
* outra saída legítima de estoque, preferencialmente fluxo EST-02 existente.

Resultado esperado:

* serialização consistente;
* nenhuma perda de atualização;
* saldo final correto;
* nenhum saldo inválido conforme regras existentes.

Se o teste de integração contra a API não for a melhor camada para o cenário 3, criar teste específico de banco/transação, mas ele deve existir.

---

# 29. Critérios de aceite

COM-04 somente pode ser considerado concluído quando:

* devolução estiver vinculada inequivocamente ao recebimento;
* nenhuma devolução puder exceder a quantidade recebida não devolvida;
* nenhuma saída ocorrer antes da confirmação;
* confirmação for atômica;
* estoque for movimentado através do mecanismo oficial existente;
* ledger identificar inequivocamente a devolução;
* reconfirmação for idempotente;
* concorrência não permitir over-return;
* concorrência não corromper saldo;
* RLS estiver habilitado e forçado;
* RBAC estiver aplicado;
* auditoria estiver implementada;
* frontend mínimo estiver funcional;
* suítes anteriores continuarem verdes;
* banco puder ser recriado do zero;
* build Docker de produção passar;
* `vetoros1` permanecer intacto;
* nenhum commit for criado.

---

# 30. Itens explicitamente fora de escopo

Não implementar nesta fase:

* NF-e de devolução;
* XML;
* SEFAZ;
* manifestação;
* chave de acesso;
* DANFE;
* CFOP;
* CST;
* CSOSN;
* ICMS;
* ICMS-ST;
* IPI;
* PIS;
* COFINS;
* cálculo tributário;
* natureza de operação fiscal;
* contas a pagar;
* crédito financeiro com fornecedor;
* estorno financeiro;
* parcelas;
* caixa;
* PIX;
* boleto;
* conciliação;
* custo médio;
* reprocessamento de custo;
* FIFO;
* LIFO;
* lote;
* validade;
* serial;
* inspeção de qualidade;
* RMA;
* autorização formal do fornecedor;
* frete de devolução;
* transportadora;
* coleta;
* devolução fiscal;
* troca por outro produto;
* estorno de devolução confirmada;
* aprovação multinível.

Esses domínios serão tratados em fases posteriores.

---

# 31. Preservação dos gates anteriores

Ao final confirmar explicitamente que permanecem preservados:

* DB-01;
* AUTH-01;
* CORE-01;
* CRM-01;
* CRM-02;
* OS-01;
* OS-02;
* CRM-03;
* EST-01;
* EST-02;
* COM-01;
* COM-02;
* COM-03.

Especial atenção para não quebrar:

* chamadas existentes de `record_stock_movement`;
* confirmação de recebimentos;
* consumo/devolução de estoque da OS;
* RLS;
* same-tenant FKs;
* seeds;
* permissões;
* rotas já existentes.

---

# 32. Validação final obrigatória

Executar e registrar no `executed.md`:

* migrations desde banco zerado;
* seed;
* lint;
* typecheck;
* testes DB completos;
* testes API completos;
* testes de concorrência;
* build Docker de produção;
* health da API;
* smoke test do frontend;
* rotas novas no build;
* confirmação de que Postgres/Redis continuam sem exposição indevida no host.

Se algum defeito for encontrado durante a execução, corrigir antes de declarar a fase concluída e documentar:

* sintoma;
* causa raiz;
* correção;
* teste que comprova a correção.

---

# Entrega

Ao concluir:

1. atualizar `executed.md` com relatório completo;
2. listar migrations e arquivos principais criados/alterados;
3. responder às perguntas de descoberta;
4. explicar arquitetura de locking e idempotência;
5. informar os resultados dos testes;
6. informar qualquer bug encontrado e corrigido;
7. confirmar os itens explicitamente não implementados;
8. não criar commit;
9. entregar para revisão.

**Gate COM-04: Devolução de Mercadorias ao Fornecedor.**
