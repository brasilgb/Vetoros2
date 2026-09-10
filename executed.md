# Execução de correio.md

Data: 2026-09-10

## Comparação

`correio.md` mudou de novo: marco novo, `PDV-ADV-01 — Frente de Caixa Operacional Completa`, endereçando diretamente o "PARCIAL" que o relatório do VEN-ADV-01 anterior tinha deixado registrado (faltava uma ação de "Receber pagamento" direta na tela de venda).

## PDV-ADV-01 — resultado

### Descoberta

Antes de qualquer código, auditei o que já existia:

- **Código de barras**: `inventory_parts.barcode_ean` já existe (CAD-01, migration 0031), com índice único por tenant, e `GET /inventory/parts?search=` já casa contra `sku`, `description` **e** `barcode_ean`. Nenhuma coluna nova foi necessária — a busca de balcão por leitor USB já tem onde bater.
- **Formas de pagamento**: `payment_methods` já tem um `code` estável (`cash`, `pix`, `credit_card`, `debit_card`, `bank_transfer`, `other`) — o suficiente para o PDV saber qual método é dinheiro (troco) sem precisar de coluna nova.
- **Múltiplas formas de pagamento**: `payments` já não tem limite de 1 por venda — múltiplos `POST /payments` com o mesmo `saleId` já era mecanicamente possível e testado (confirmado na auditoria do VEN-ADV-01 anterior).
- **Caixa aberto**: `GET /cash-registers` já embute `current_session_id`/`current_session_expected_balance` por registro (LEFT JOIN LATERAL) — o suficiente para o PDV saber se há sessão aberta na filial sem endpoint novo.
- **Confirmação/estoque/cancelamento**: toda a lógica de VEN-02/VEN-03 (baixa real na confirmação, reversão no cancelamento, locks, idempotência, índice único estrutural contra saída duplicada) já está madura e não foi tocada.

**Lacuna real confirmada**: **não existia orquestração atômica entre confirmar a venda e registrar o(s) pagamento(s)**. O frontend precisaria de N chamadas HTTP independentes (`POST /sales/:id/confirm` + N × `POST /payments`), com janela real de inconsistência entre elas (queda de rede depois de confirmar e antes de pagar deixaria a venda "confirmada sem pagamento que deveria existir" — exatamente o estado que a seção 21 proíbe). Também não havia nenhuma trava contra registrar pagamentos somando mais que o total da venda (`receive_payment` não valida isso — confirmado na auditoria anterior, mas só se tornou um requisito explícito de bloqueio nesta rodada, seção 19). E não existia nenhuma tela operacional de balcão — `/app/sales` é puramente administrativo (nenhuma leitura de código de barras, nenhum painel de pagamento/troco, nenhum "nova venda" em loop).

### Implementação

**API** (`apps/api/src/sales/routes.ts`): novo `POST /sales/:id/checkout` — orquestrador transacional, não duplica nenhuma regra:
- Reaproveita exatamente a mesma lógica de confirmação de `/sales/:id/confirm` (mesma baixa de estoque via `record_stock_movement`, mesmo lock `for update`, mesma idempotência) e exatamente a mesma função `receive_payment` de FIN-01 para cada pagamento — tudo dentro de uma única transação (`withAuthenticatedTenant`), então uma falha em qualquer etapa desfaz tudo (estoque incluído).
- Bloqueia pagamentos que somem mais que o restante da venda (`payment_exceeds_total`, 409) — validado **antes** de confirmar, para nunca deixar a venda presa em `confirmed` sem o pagamento ter sido aceito.
- A validação do teto é consciente de idempotência: um `idempotencyKey` que já tem pagamento gravado não conta de novo contra o saldo — um retry (duplo clique) do checkout inteiro nunca é confundido com uma tentativa de pagar acima do total.
- Reusa exatamente as mesmas permissions existentes (`sales.confirm` + `payments.create`) — nenhum namespace `pos.*` foi criado, conforme a seção 39 exige.
- Troco nunca entra no lançamento: quem calcula "valor entregue − troco" é o cliente (Web); o endpoint só aceita o valor que efetivamente quita a venda.
- Reaproveita a mesma checagem de filial da sessão de caixa já usada por `POST /payments` (`cash/routes.ts`), que `receive_payment` por si só não valida.

**Web** (`apps/web/app/app/pos/page.tsx`, novo): tela dedicada de balcão, no mesmo domínio de `sales`. Campo de leitura de código de barras (Enter dispara busca imediata, sem debounce de digitação humana — compatível com leitor USB); busca manual por combobox como alternativa; carrinho com quantidade/preço/desconto editáveis; cliente opcional; painel de pagamento com múltiplas formas, calculadora de troco para dinheiro; aviso + link para abrir caixa quando não há sessão aberta na filial; finalização via `POST /sales/:id/checkout`; comprovante imprimível (reaproveita o padrão `.print-hidden`/`window.print()` já usado pelo fechamento de caixa do CAI-04) com botão "Nova venda" para reiniciar o ciclo sem sair da tela. Entrada adicionada em `nav-config.ts` (grupo "Vendas").

**Testes** (`apps/api/tests/sales-checkout.integration.test.ts`, novo, 14 casos): venda simples à vista; múltiplas formas de pagamento; dinheiro com troco (provando que o valor lançado é o que quita a venda, nunca o valor entregue); rejeição de pagamento acima do total; pagamento parcial + geração de recebível pelo restante (reaproveitando `POST /receivables/generate` sem reimplementar); estoque insuficiente com rollback integral (nenhum pagamento criado, venda permanece `draft`); caixa fechado/sessão de outra filial; duplo clique/retry idempotente; concorrência (duas vendas disputando 1 unidade — só uma confirma); venda cancelada rejeitada; isolamento cross-tenant; RBAC negativo; rastreabilidade caixa/pagamento/venda.

### Decisões de domínio

- **Formas de pagamento**: nenhuma estrutura `payment_splits` foi criada — múltiplos `payments` com o mesmo `sale_id` já representam isso corretamente, como a seção 16 pedia para confirmar antes de inventar algo novo.
- **Troco**: nunca é um lançamento financeiro. É puramente uma exibição client-side (`valor entregue − valor que quita a venda`); o endpoint só aceita o segundo número.
- **Pagamento acima do total**: bloqueado sempre, sem exceção especial "para dinheiro" no backend — a exceção da seção 19 (troco) é resolvida inteiramente calculando o valor certo antes de enviar, não afrouxando a validação do lado do servidor.
- **Venda a prazo**: continua sendo resolvida por `generate_receivables` (FIN-ADV-01), sem nenhuma duplicação — o checkout permite pagamento parcial (ou nenhum) e deixa o restante para o fluxo de recebíveis já existente.
- **Rascunho pendente**: não criei conceito de "venda suspensa" — `draft` já cumpre esse papel; a tela do PDV linka para `/app/sales?status=draft` (listagem administrativa já existente) em vez de reimplementar uma segunda listagem.
- **Comprovante**: página imprimível via `window.print()` do navegador (mesmo padrão já usado pelo fechamento de caixa) — nenhuma integração com impressora térmica, conforme a seção 30 pede para não fazer neste marco.

### Estoque

Preservado 100% — o checkout chama a mesma sequência de `record_stock_movement` que `/confirm` já chamava, na mesma ordem estável de `inventory_part_id`, com o mesmo lock. Nenhuma lógica de baixa foi duplicada na camada Web.

### Financeiro

`POST /sales/:id/checkout` chama exatamente `receive_payment` (FIN-01) para cada pagamento — mesmo idempotency, mesmo ledger append-only em `cash_movements`, mesma rastreabilidade `sale_id`/`cash_session_id`. Pagamento parcial deixa o restante disponível para `generate_receivables` (FIN-ADV-01) sem nenhuma duplicação de contabilização.

### Concorrência e idempotência

Provados nesta rodada especificamente para o checkout: duas finalizações disputando a última unidade de estoque (só uma confirma), e retry do checkout inteiro com as mesmas `idempotencyKey`s (nem estoque nem pagamento duplicam). A proteção de estoque em si (locks, índice único) já vinha de VEN-02/VEN-03 e não precisou de nenhuma alteração.

### RBAC

Nenhuma permission nova. `POST /sales/:id/checkout` exige exatamente `sales.confirm` + `payments.create`, as mesmas já usadas por `/confirm` e `/payments` separadamente — testado negativamente (403, venda permanece `draft`, nada é criado).

### Web

Fluxo completo: abrir `/app/pos` → ler código de barras ou buscar produto → item entra no carrinho (rascunho criado só no primeiro item) → ajustar quantidade/preço/desconto → cliente opcional → escolher forma(s) de pagamento (com troco calculado para dinheiro) → finalizar → comprovante na tela com opção de imprimir → "Nova venda" reinicia sem sair da página. Se não há caixa aberto na filial, a tela avisa e linka para `/app/cash`, mas ainda permite montar o carrinho (só bloqueia finalizar).

### PDV

```text
PDV operacional básico: SIM
```

Com o `checkout` atômico e a tela dedicada, o fluxo completo da seção 47 — abrir caixa → iniciar venda → localizar/escanear produtos → ajustar itens → cliente opcional → receber em uma ou várias formas → calcular troco → finalizar atomicamente → baixar estoque → registrar caixa/financeiro → comprovante → próxima venda — está coberto de ponta a ponta sobre o mesmo núcleo de `sales` já consolidado pelo VEN-ADV-01. Não implementei atalhos de teclado além de Enter no campo de código de barras (seção 31 é uma lista de "avaliar", não obrigatória) nem testes E2E Web novos (não havia suíte Playwright estável para vendas para estender sem criar infraestrutura nova) — registrado aqui para decisão futura, não construído por suposição.

### Gates

```text
DB: 253/253 PASS
API: 357/357 PASS
PDV-ADV-01 (sales-checkout): 14/14 PASS
lint: PASS
typecheck: PASS
build: PASS (inclui rota /app/pos)
git diff --check: PASS

ROADMAP:
PDV-ADV-01 = DONE
```

Todos reproduzidos em ambiente Docker Compose oficial resetado do zero (`down -v && up -d --build`), hostname `postgres` em todas as conexões internas. Nenhuma falha pré-existente apareceu para investigar.

## Conclusão

PDV-ADV-01 APROVADO E ENCERRADO

Não foi feito commit.
