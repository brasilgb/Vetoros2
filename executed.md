# FIN-04 — Contas Financeiras / Bancárias e Movimentações de Tesouraria — executed.md

Data de execução: 2026-09-07.

Este documento segue exatamente a estrutura pedida na seção 32 do `correio.md` (29 itens).

---

## 1. Diagnóstico inicial

Antes de qualquer migration, o repositório foi lido integralmente nas áreas relevantes:
`apps/api/src/cash`, `apps/api/src/receivables`, `apps/api/src/payables`, `apps/api/src/audit`,
`apps/api/src/roles`, `apps/api/src/core`, `apps/api/src/auth/service.ts`, `packages/db/src/schema.ts`,
`packages/db/src/seed.ts`, todas as migrations `0000`–`0024`, todos os testes de banco (`packages/db/tests`)
e de API (`apps/api/tests`) desses domínios, e os padrões de frontend (`apps/web/app/app/payables`,
`apps/web/app/app/receivables`, `apps/web/components/nav-config.ts`, `apps/web/lib/permission-labels.ts`,
`apps/web/lib/audit-labels.ts`).

Estado do working tree ao iniciar: FIN-01 (Caixa), FIN-02 (Recebíveis) e FIN-03 (Pagáveis) já
estavam implementados e presentes no working tree (não commitados — `git log` mostra o último
commit real como `feat(finance): add cash registers payments and financial ledger`, e as migrations
0023/0024 e o restante de FIN-02/FIN-03 estavam como arquivos não rastreados). Nenhum desses três
marcos foi alterado nesta rodada, exceto os três pontos estritamente necessários e documentados no
item 29 (registro de módulo em `app.ts`, permissões em `seed.ts`, rótulos em `permission-labels.ts`/
`audit-labels.ts`, item de menu em `nav-config.ts`, e a extensão do arquivo de teste cross-tenant
`postgres-integration.test.ts` com um `describe` novo — nenhuma linha de FIN-01/02/03 foi
modificada, apenas acrescentada).

Conclusão da descoberta: **não existe hoje nenhuma estrutura reaproveitável para representar uma
conta bancária/financeira ou o dinheiro dela** (ver item 2). FIN-04 precisa ser um domínio novo,
exatamente como o `correio.md` antecipa nas seções 2/3.

---

## 2. Respostas às 10 perguntas da descoberta (seção 1 do correio.md)

**1. Existe hoje alguma entidade que represente inequivocamente uma conta bancária ou conta
financeira?**
Não. Buscas por `bank`, `pix`, `agencia`/`agência`, `account_number` em todo `packages/db/migrations`
e `packages/db/src/schema.ts` não retornam nenhuma tabela/coluna. `cash_registers` (FIN-01) é o
único candidato próximo e não serve (ver pergunta 2).

**2. `cash_registers` representa: uma conta financeira, um caixa físico, ou só um dispositivo/local
operacional de caixa?**
Um caixa físico/operacional, preso a `tenant→company→branch`, cujo único estado mutável é
`status active/inactive`; todo movimento de dinheiro depende de uma `cash_sessions` aberta
(`cash_sessions_one_open_per_register`, migration 0022) e os valores vivem em `cash_movements`,
sempre com `cash_session_id not null`. Não tem nenhum campo bancário, não representa "patrimônio
financeiro disponível" fora de uma sessão — é a "gaveta física", não a "conta corrente".

**3. `cash_movements` pode ser reaproveitado como ledger geral financeiro?**
Não, e o `correio.md` já proíbe isso explicitamente (seção 2). Confirmado pela modelagem real:
`cash_movements.cash_session_id` é `not null` e referencia `cash_sessions(tenant_id,id)` — usar essa
tabela para uma transferência bancária forçaria toda transferência a "pertencer" a uma sessão de
caixa aberta, o que não tem nenhum sentido de negócio (transferência bancária não abre/fecha
caixa). `type` também já está fechado num `check` específico de caixa
(`opening,receipt,refund,supply,withdrawal`) que não cobre `credit`/`debit`/transferência.

**4. Existe conceito persistido de banco, agência, número de conta, PIX ou instituição financeira?**
Não, em nenhuma tabela (`payment_methods`, `cash_registers`, `suppliers`, `companies` — todas
inspecionadas). Tudo isso é novo em `financial_accounts` (migration 0025).

**5. Existe algum campo atual que represente saldo financeiro fora de uma sessão de caixa?**
Não. `cash_sessions.opening_amount`/`cash_movements.resulting_balance` só existem dentro do
contexto de uma sessão específica; não há nenhum "saldo" persistido em nível de company/tenant.

**6. `payment_methods` tem relação com conta de destino/origem, ou é só a forma de pagamento?**
Só forma/meio (`cash`,`pix`,`debit_card`,`credit_card`,`bank_transfer`,`other` — migration 0022,
seed). Nenhuma coluna aponta para uma conta financeira. `financial_accounts` não foi modelado como
extensão de `payment_methods`, e `payment_methods` não foi alterado nesta rodada — exatamente a
separação pedida na seção 16 (`PIX`/`dinheiro`/`cartão` são formas; `Banco do Brasil — Conta 12345`
é conta).

**7. Há alguma estrutura para registrar transferência bancária, PIX, TED, boleto pago, débito
automático, depósito, tarifa ou ajuste financeiro?**
Não, nenhuma. `financial_transactions`/`financial_transfers` (migration 0025) cobrem isso de forma
genérica: qualquer um desses eventos é, na modelagem, um `credit`/`debit` manual com
`description`/`reference` livres, ou uma transferência entre duas `financial_accounts` — sem criar
uma enumeração de "tipo de evento bancário" que a seção 3 do `correio.md` pede para evitar
("não criar enumeração excessiva sem necessidade real").

**8. Existe alguma arquitetura previamente aprovada para integração de FIN-02/FIN-03 com
caixa/banco?**
Não. FIN-02 (`receivable_allocations`) só liga um título a um `payments` (recebimento em caixa,
FIN-01) — nunca a uma conta bancária. FIN-03 (`payable_payments`) é o próprio ledger de pagamento a
fornecedor, sem nenhum vínculo com `cash_movements` nem com qualquer conceito de conta bancária —
o próprio comentário da migration 0024 já registra isso ("não existe hoje conceito de conta
bancária... a integração fica para um marco específico"). Nenhuma integração automática foi
implementada nesta rodada (ver itens 15/16/17).

**9. Há alguma razão inequívoca para a conta financeira pertencer ao Tenant, à Company ou à
Branch?**
Não há nenhum contrato/uso existente que force `branch_id`. Ao contrário: uma conta corrente
empresarial é tipicamente compartilhada por várias filiais da mesma empresa — o próprio
`correio.md` (seção 4) já registra essa preferência arquitetural. Decisão: `Tenant → Company →
FinancialAccount`, sem `branch_id` (ver item 3).

**10. Qual escopo deve ser usado para uma conta bancária corporativa usada por mais de uma filial?**
A própria Company — uma única linha em `financial_accounts` com `company_id`, sem nenhuma tabela
de associação conta↔filial (nada no domínio hoje justifica N:N). Qualquer filial dessa empresa
acessa a mesma conta; o controle de acesso é por RBAC de escopo `company`/`tenant` (grants
`branch`-scoped da MESMA empresa também são aceitos — ver item 21).

Nenhuma entidade redundante foi criada: a busca acima confirma que não havia nada reaproveitável.

---

## 3. Decisão Tenant/Company/Branch

`financial_accounts.tenant_id` + `financial_accounts.company_id`, **sem `branch_id`**.

- `foreign key (tenant_id,company_id) references companies(tenant_id,id)` garante integridade
  same-tenant fisicamente (não só via RLS — seção 21).
- `financial_transactions`/`financial_transfers` seguem o mesmo padrão: `company_id` é herdado da
  conta no momento da escrita (nunca um segundo valor que possa divergir), e todo FK usa o padrão
  composto `(tenant_id, foreign_id) → target(tenant_id, id)`.
- O frontend continua exigindo Empresa **e** Filial selecionadas no cabeçalho antes de liberar a
  tela (`RequireOperationalContext`/`hasFullContext`), por consistência de UX com o resto do app —
  mesmo que `branch_id` não exista no domínio (decisão documentada no item 23/API).

---

## 4. Distinção Caixa × Conta Financeira

| | FIN-01 — Caixa (`cash_registers`/`cash_sessions`/`cash_movements`) | FIN-04 — Conta Financeira (`financial_accounts`/`financial_transactions`) |
|---|---|---|
| O que representa | Local físico/operacional de dinheiro em espécie | Onde o dinheiro está de fato (banco) — patrimônio financeiro |
| Escopo | Tenant→Company→**Branch** | Tenant→**Company** (sem branch) |
| Depende de sessão? | Sim — todo movimento exige `cash_session_id` de uma sessão **aberta** | Não — nenhum conceito de sessão/abertura/fechamento |
| Saldo | Por sessão (fecha/reabre a cada expediente) | Contínuo, nunca "fecha" |
| Tipos de movimento | `opening,receipt,refund,supply,withdrawal` (vocabulário de caixa físico) | `credit,debit` (vocabulário de tesouraria), com `origin` distinguindo a natureza |

Nenhuma alteração foi feita em FIN-01. `cash_movements` nunca foi usado como ledger de
`financial_accounts` — são tabelas e domínios inteiramente separados.

---

## 5. Modelo de conta (`financial_accounts`)

```
id, tenant_id, company_id, name,
type text default 'bank_account' check (type in ('bank_account')),
bank_code, bank_name, branch_number, account_number, account_digit, pix_key,  -- todos nullable
status text default 'active' check (status in ('active','inactive')),
created_by_identity_id, updated_by_identity_id, created_at, updated_at
unique(tenant_id,id), unique(tenant_id,company_id,name)
foreign key (tenant_id,company_id) references companies(tenant_id,id)
```

**Decisão sobre `type`**: avaliados `bank_account`/`cash_equivalent` (seção 3 do correio.md). Optei
por manter **só `bank_account`** — `cash_equivalent` colidiria semanticamente com o que FIN-01 já é
dono (dinheiro em espécie, com sessão própria); manter os dois criaria duas respostas diferentes
para "quanto dinheiro em espécie a empresa tem", exatamente a ambiguidade que a seção 2 pede para
evitar. O `check` é real (não um texto livre), então adicionar um segundo tipo no futuro é uma
migration explícita, nunca um dado solto.

Nenhum campo de credencial (senha/token/certificado/segredo OAuth/chave privada/credencial Open
Finance) existe na tabela — só campos cadastrais, incluindo PIX (chave, nunca token de autorização).

---

## 6. Modelo do ledger (`financial_transactions` + `financial_transfers`)

`financial_transactions` (append-only):

```
id, tenant_id, company_id, financial_account_id,
type text check (type in ('credit','debit')),
amount numeric(14,2) check (amount > 0),
occurred_at, description, reference,
origin text check (origin in ('opening_balance','manual','transfer','reversal')),
financial_transfer_id, reverses_transaction_id, idempotency_key,
created_by_identity_id, created_at
```

Um `check` particiona `origin` em exatamente 4 formas mutuamente exclusivas (nenhuma linha pode
existir fora delas, mesmo por INSERT direto — mas não há GRANT de INSERT direto, ver item 19):

- `opening_balance`/`manual`: sem `financial_transfer_id`, sem `reverses_transaction_id`, **com**
  `idempotency_key` (≥8 chars).
- `transfer`: **com** `financial_transfer_id`, sem `reverses_transaction_id`, sem `idempotency_key`
  (a idempotência da transferência vive em `financial_transfers.idempotency_key`).
- `reversal`: sem `financial_transfer_id`, **com** `reverses_transaction_id`, sem `idempotency_key`.

`financial_transfers` é o cabeçalho de uma transferência (`from_financial_account_id`,
`to_financial_account_id`, `amount`, `description`, `idempotency_key`), referenciado pelas duas
pernas em `financial_transactions`.

**Decisão de convenção (seção 6 do correio.md)**: `type=credit/debit` + `amount>0`, saldo =
`credits - debits` — a mesma convenção de FIN-01 (`cash_movements`), compatível e sem precisar de
valor negativo em lugar nenhum.

---

## 7. Política de saldo

**Opção A escolhida** (saldo derivado, seção 10 do correio.md): não existe coluna de saldo em
`financial_accounts` nem tabela de projeção. O saldo é sempre `SUM(credits) - SUM(debits)` sobre
`financial_transactions`, exposto pela função SQL `financial_account_balance(tenant_id, account_id)`
e reaproveitado por toda API/funções.

Diferente deliberadamente de `cash_movements.resulting_balance` (FIN-01), que **é** uma coluna
persistida por movimento: lá ela existe porque o fechamento de sessão precisa comparar um saldo
esperado contra o valor informado pelo operador — um caso de uso que não existe em FIN-04 (não há
"fechamento" de conta financeira). Persistir um saldo por linha aqui seria exatamente a "projeção
prematura" que a seção 10 pede para não introduzir. Documentado no comentário da migration.

---

## 8. Política de saldo negativo

**Decisão explícita: NÃO bloquear** um débito manual ou uma perna de transferência que produza
saldo negativo. Nenhuma das funções (`record_financial_transaction`,
`transfer_between_financial_accounts`) verifica sinal do saldo resultante. Justificativa (seção 11
do correio.md): uma conta bancária real pode operar com limite/cheque especial/tarifas/liquidação
posterior, e não existe hoje nenhum contrato de negócio no VetorOS 2 que exija o contrário.
Verificado com teste real (`apps/api/tests/financial-accounts.integration.test.ts`, "does NOT block
a debit that would produce a negative balance") e também via smoke test manual em `psql` durante o
desenvolvimento (saldo chegou a `-999.00` sem erro).

---

## 9. Saldo inicial

Nunca uma coluna editável em `financial_accounts`. É sempre uma movimentação `origin='opening_balance'`
(função `set_financial_account_opening_balance`), com no máximo **uma** por conta, garantido
fisicamente por `financial_transactions_opening_once_uq` (unique index parcial em
`(tenant_id,financial_account_id) where origin='opening_balance'`) — não só por checagem de
aplicação. O valor informado pode ser negativo (a conta já nasce operando no vermelho — mesma
decisão do item 8); o sinal decide `type` (`credit`/`debit`), o valor armazenado é sempre positivo
(`amount>0`). Depois de lançada, essa movimentação integra o histórico normalmente (não é editável;
uma correção exige um lançamento manual novo ou estorno).

Bug real encontrado e corrigido durante o desenvolvimento: a primeira versão da função usava o
padrão `loop + exception when unique_violation then continue` (o mesmo de FIN-01/02/03), mas o
predicado de busca de idempotência (`idempotency_key`) é **diferente** do predicado da constraint
que pode ser violada (`financial_account_id`+`origin='opening_balance'`) — uma segunda chamada com
uma chave *diferente* nunca era encontrada pelo `select` de idempotência, e o `unique_violation`
do índice de abertura fazia o `continue` reexecutar a mesma sequência **para sempre** (loop
infinito, capturado pelo teste de API que travou em `hookTimeout`). A correção adiciona uma
checagem explícita de existência **enquanto a conta está travada** (`for update`), antes do
INSERT — livre de corrida, sem depender de retry. Ver migration 0025, comentário na função.

---

## 10. Política de lançamento (manual credit/debit)

Único caminho: `record_financial_transaction` (`security definer`), chamada por
`POST /financial-accounts/:id/transactions`. Não existe nenhuma rota genérica que permita ao
cliente montar uma linha do ledger arbitrariamente — toda validação (tipo, valor>0, descrição,
conta ativa, idempotência) é garantida na função, não só na camada HTTP. Requer permissão
`financial_accounts.transact`.

---

## 11. Política de transferência

`transfer_between_financial_accounts` (`security definer`): cria o cabeçalho `financial_transfers`
e as duas pernas (`debit` na origem, `credit` no destino) **na mesma transação PostgreSQL** — nunca
um lado sem o outro. Regras aplicadas: origem≠destino (CHECK físico em `financial_transfers`),
ambas as contas `status='active'`, valor>0, e **mesma empresa** — decisão arquitetural: nesta
rodada uma transferência exige `from.company_id = to.company_id`; mover dinheiro entre empresas
diferentes do mesmo tenant é uma operação contábil (intercompany) sem contrato de negócio aprovado,
então fica fora de escopo em vez de inventada. As duas contas são travadas (`for update`) em ordem
determinística por `id` (não pela ordem origem/destino informada pelo chamador) para nunca
deadlockar duas transferências concorrentes em direções opostas entre o mesmo par de contas.
Requer permissão `financial_accounts.transfer`.

---

## 12. Política de estorno

Dois casos, nunca editando o histórico:

- **Lançamento manual/abertura** (`reverse_financial_transaction`): nova linha de natureza inversa
  com `reverses_transaction_id` apontando ao original. Só aceita `origin in ('manual',
  'opening_balance')` — uma perna de transferência **não** pode ser estornada sozinha por esta
  função (rejeitada com `22023`); precisa da função abaixo, para nunca deixar uma transferência
  "capenga" (só um lado revertido).
- **Transferência** (`reverse_financial_transfer`): reverte **as duas pernas na mesma transação**
  (mesma exigência de atomicidade da criação).

Ambos são idempotentes (segunda chamada devolve o estorno já existente, `idempotent:true`) e
protegidos contra estorno duplicado por unique index parcial
(`financial_transactions_reversal_once_uq`, por `reverses_transaction_id` onde `origin='reversal'`).
Um estorno nunca pode ser estornado de novo (`origin='reversal'` é explicitamente rejeitado por
`reverse_financial_transaction`). Cross-tenant é impossível estruturalmente: toda função filtra por
`tenant_id=vetoros_current_tenant_id()`, então uma movimentação de outro tenant simplesmente não é
"encontrada" (erro `P0002`), nunca uma operação silenciosa sobre dado alheio. Requer permissão
`financial_accounts.reverse`.

---

## 13. Idempotência

Cobertos: lançamento manual, saldo de abertura, transferência (chave própria em
`financial_transfers`). O padrão é sempre "procurar a `idempotency_key` primeiro; achou com os
MESMOS parâmetros → devolve o resultado existente (`idempotent:true`, sem nova escrita); achou com
parâmetros DIFERENTES → erro `23505` (nunca sucesso silencioso sobre reaproveitamento incompatível)".
A chave tem unicidade `(tenant_id, idempotency_key)`. Testado com retry sequencial (mesma
`idempotencyKey` duas vezes → segunda chamada devolve `200`+mesmo id) em manual entry, opening
balance, transfer e reverse.

---

## 14. Concorrência

Protegida por constraint física (`unique(tenant_id,idempotency_key)` para manual/opening/transfer;
os dois unique index parciais para os estornos) **combinada** com o padrão
`loop + begin...exception when unique_violation then continue`, nunca só um
`SELECT → "não existe" → INSERT`. Testado com **duas chamadas HTTP genuinamente concorrentes**
(`Promise.all`) usando a mesma `idempotencyKey` para lançamento manual e para transferência —
nos dois casos, uma recebe `201` e a outra `200`, com o **mesmo id**, e o saldo final reflete
apenas UMA escrita (não duas) — ver `apps/api/tests/financial-accounts.integration.test.ts`, testes
"does not duplicate two concurrent retries...". As duas contas de uma transferência são travadas em
ordem determinística por `id` para nunca deadlockar duas transferências concorrentes em sentidos
opostos entre o mesmo par de contas.

---

## 15. Integração com FIN-01 (Caixa)

**Nenhuma integração automática nesta rodada** — confirmado pela descoberta (item 2/8): FIN-01
permanece 100% intacto, nenhuma linha de `cash_registers`/`cash_sessions`/`cash_movements`/
`payments` foi alterada. Documentação de como uma futura integração poderia funcionar: um recebimento
de caixa (`payments`) ou movimento de caixa (`cash_movements`) poderia, em um marco próprio, gerar
opcionalmente uma `financial_transaction` de crédito quando o caixa for "depositado" numa conta
bancária — mas isso exigiria antes um contrato de negócio sobre QUANDO esse depósito acontece (não
é automático por definição: dinheiro em caixa não vira saldo bancário sozinho). Não implementado.

---

## 16. Integração com FIN-02 (Recebíveis)

**Nenhuma alteração em FIN-02.** Um recebimento continua sendo registrado inteiramente no ledger
já aprovado (`payments`/`receivable_allocations`, FIN-01/FIN-02). Nenhuma seleção de conta
financeira é exigida em `POST /receivables/generate` nem em `POST /receivables/:id/allocate`, e
nenhuma `financial_transaction` é gerada automaticamente por esses endpoints — confirmado revisando
`apps/api/src/receivables/routes.ts` (não modificado). Futuro possível: quando um `payment`
associado a um recebível for de fato depositado numa conta bancária, um evento explícito (não
automático) poderia registrar uma `financial_transaction` referenciando o `payment_id` original via
`reference`, sem duplicar o fato financeiro já registrado em `payments`.

---

## 17. Integração com FIN-03 (Pagáveis)

**Nenhuma alteração em `payable_payments`.** Nenhuma conta bancária é exigida em
`POST /payables/:id/installments/:id/payments`, e nenhum movimento financeiro automático é gerado —
confirmado revisando `apps/api/src/payables/routes.ts` (não modificado). Futuro possível: um
`payable_payment` poderia, em marco próprio, associar-se a uma saída de uma `financial_account`
(débito manual referenciando o pagamento), mas isso é uma decisão de produto (torna a conta
obrigatória no pagamento a fornecedor?) que não foi tomada aqui.

---

## 18. Migrations

Uma nova migration: `packages/db/migrations/0025_fin04_financial_accounts.sql` (26 migrations no
total no projeto, `0000`–`0025`). Cria `financial_accounts`, `financial_transfers`,
`financial_transactions`, os triggers de imutabilidade, 5 funções `security definer`
(`set_financial_account_opening_balance`, `record_financial_transaction`,
`transfer_between_financial_accounts`, `reverse_financial_transaction`,
`reverse_financial_transfer`) mais a função auxiliar `financial_account_balance`, as 6 permissions
`financial_accounts.*`, e os grants. Registrada em `packages/db/migrations/meta/_journal.json`
(idx 25, tag `0025_fin04_financial_accounts`).

Aplicada com sucesso contra um Postgres 17 real (`postgres:17-alpine`, container local), duas vezes:
uma vez para validação inicial, e uma segunda vez **a partir de um banco completamente limpo**
(drop+recreate do database `vetoros`, todas as 26 migrations reaplicadas do zero) depois da correção
do bug de loop infinito descrito no item 9 — ver item 28 (limitações) para o motivo de ter sido
necessário recriar o banco em vez de só reaplicar a migration editada.

---

## 19. Constraints

- `numeric(14,2)` em todo campo monetário (`amount` em `financial_accounts`... não, em
  `financial_transactions`/`financial_transfers`); nenhum `float`/`double precision` em lugar
  nenhum.
- `amount > 0` sempre (nunca zero, nunca negativo) — direção é `type`, não sinal.
- FK same-tenant composta em toda relação: `(tenant_id,company_id)→companies`,
  `(tenant_id,financial_account_id)→financial_accounts`,
  `(tenant_id,financial_transfer_id)→financial_transfers`,
  `(tenant_id,reverses_transaction_id)→financial_transactions`,
  `(tenant_id,from/to_financial_account_id)→financial_accounts`.
- `unique(tenant_id,id)` em todas as 3 tabelas novas (padrão same-tenant do projeto).
- `unique(tenant_id,company_id,name)` em `financial_accounts` (nome não duplica dentro da empresa).
- `unique(tenant_id,idempotency_key)` em `financial_transactions` e em `financial_transfers`.
- `financial_transactions_opening_once_uq`: unique index parcial, no máximo uma abertura por conta.
- `financial_transactions_reversal_once_uq`: unique index parcial, no máximo um estorno por
  movimentação.
- CHECK particionando `origin` em 4 formas mutuamente exclusivas (item 6).
- `check (from_financial_account_id <> to_financial_account_id)` em `financial_transfers`.
- Triggers `before update or delete` em `financial_transactions` e `financial_transfers`
  (`reject_*_mutation`), rejeitando qualquer tentativa de alterar/apagar histórico — validado com
  teste PostgreSQL real (`UPDATE`/`DELETE` batendo no trigger, `packages/db/tests/postgres-integration.test.ts`
  reaproveita o padrão do teste genérico, e o smoke manual durante o desenvolvimento confirmou
  `financial_transactions is append-only`).

---

## 20. RLS

`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + policy `tenant_id=vetoros_current_tenant_id()`
nas 3 tabelas novas (`financial_accounts`, `financial_transfers`, `financial_transactions`).
Confirmado real, não só a migration: testes PostgreSQL reais em
`packages/db/tests/postgres-integration.test.ts` (acrescentados ao `describe('physical tenant
integrity')` já existente) provam:

- um INSERT direto (como `vetoros_migration`) de `financial_transactions`/`financial_transfers`
  apontando para uma `financial_account` de outro tenant é **rejeitado pelo banco** com `23503`
  (FK composta, não RLS) — mesmo sem passar pela API.
- as funções `security definer` (`record_financial_transaction`, `set_financial_account_opening_balance`,
  `transfer_between_financial_accounts`) recusam operar sobre uma conta de outro tenant com `P0002`
  ("not found"), nunca uma escrita cross-tenant silenciosa.
- `financial_accounts` de outro tenant é invisível numa listagem sob RLS (`vetoros_runtime`).

Isso satisfaz explicitamente a seção 21 do correio.md ("não considerar regex da migration prova
suficiente para isolamento cross-tenant" / "os testes devem provar rejeição pelo banco, não apenas
invisibilidade pela API").

---

## 21. RBAC

6 permissions, mesma granularidade sugerida pela seção 20 do correio.md e coerente com FIN-02/FIN-03:
`financial_accounts.read`, `.create`, `.update`, `.transact`, `.transfer`, `.reverse`.

Adicionadas ao template de papel `finance` em `packages/db/src/seed.ts`
(`mapTemplatePermissions`/`byCode.finance`) — mesmo critério de `receivables.*`/`payables.*`:
nenhum papel operacional (`cashier`, `attendance`, etc.) ganha acesso a tesouraria por padrão.
Reconciliação idempotente confirmada rodando `pnpm db:seed` duas vezes seguidas sem erro e
verificando via `psql` (com `app.tenant_id` setado) que `tenant_roles` código `finance` do tenant
Alpha tem exatamente as 6 permissions novas.

Escopo de permissão deliberadamente diferente de cash/receivables/payables: a função `scope()` em
`apps/api/src/financial-accounts/routes.ts` passa **só `companyId`** (nunca `branchId`) para
`requirePermission`/`hasPermission` — coerente com a decisão do item 3 (conta pertence à empresa,
não à filial): um grant `branch`-scoped de qualquer filial da mesma empresa também deve poder
operar sobre a conta.

Teste de autorização negativa **real**, com HTTP `403` (não só string de permission) em
`apps/api/tests/financial-accounts.integration.test.ts` ("rejects create/read/transact/transfer/
reverse without the specific financial_accounts.* permission (403)") — cria uma identity restrita
com só `operational.context.select`, faz login de verdade, e confirma `403` em `POST
/financial-accounts`, `GET /financial-accounts`, `GET /financial-accounts/:id`, `POST
/financial-accounts/:id/transactions` e `POST /financial-accounts/:id/transfer`.

---

## 22. Auditoria

Usa exclusivamente o mecanismo central ADM-03 (`service.auditResource`, `apps/api/src/audit`).
Nenhum sistema paralelo. Eventos emitidos, exatamente os candidatos da seção 24 do correio.md:

- `financial_account.created` / `financial_account.updated`
- `financial_transaction.created` (cobre manual e saldo de abertura, com `metadata.origin`
  distinguindo os dois) / `financial_transaction.reversed`
- `financial_transfer.created` / `financial_transfer.reversed`

`resourceType`s (`financial_account`, `financial_transfer`) adicionados ao agrupamento "Financeiro"
em `apps/web/lib/audit-labels.ts`, com rótulos pt-BR para todos os 6 códigos de ação. Testado
de ponta a ponta via `GET /audit-events?resourceType=...&resourceId=...` em
`apps/api/tests/financial-accounts.integration.test.ts` ("audits account creation, manual entry,
reversal and transfer", "audits a transfer as financial_transfer.created/reversed").

---

## 23. API

Endpoints implementados em `apps/api/src/financial-accounts/routes.ts`, registrados em
`apps/api/src/app.ts`:

- `GET /financial-accounts` · `POST /financial-accounts` · `GET /financial-accounts/:id` ·
  `PATCH /financial-accounts/:id`
- `GET /financial-accounts/:id/transactions`
- `POST /financial-accounts/:id/transactions` (lançamento manual credit/debit)
- `POST /financial-accounts/:id/opening-balance` (saldo inicial — seção 12)
- `POST /financial-accounts/:id/transactions/:transactionId/reverse`
- `POST /financial-accounts/:id/transfer`
- `POST /financial-transfers/:id/reverse` (nível superior — uma transferência tem duas contas, não
  faz sentido aninhar sob uma delas)

**Nenhum `DELETE` de movimentação, nenhum `PATCH` de movimentação** — confirmado por teste real
(`DELETE /financial-accounts/:id` retorna 404, não existe rota; nenhuma rota `PATCH` para
`financial_transactions`/`financial_transfers` foi criada). Desativação (`PATCH .../status=inactive`)
é o único mecanismo de "remoção" de conta — preferida à exclusão física quando já há histórico
(seção 18), e na prática sempre (o domínio nunca permite exclusão física de conta).

Validação de payload com Zod (`.strict()` em todos os schemas — payload com campo desconhecido,
ex. `password`/`token`, é rejeitado com `400`, nunca ignorado silenciosamente). Tradução de
`errcode` do Postgres para HTTP compreensível, mesmo padrão de cash/receivables/payables.

---

## 24. Frontend

Item novo no grupo **Financeiro** da sidebar (`apps/web/components/nav-config.ts`, ícone `Wallet`,
distinto de `Banknote`/Caixa e `Landmark`/Contas a Pagar), quinto item depois de Caixa/Recebimentos/
Contas a Receber/Contas a Pagar.

- **Listagem** — `/app/financial-accounts`: nome, instituição, identificação resumida (agência/conta),
  saldo, status. Sem coluna "Empresa" (a listagem já é escopada à empresa ativa, mesmo critério de
  Contas a Receber/a Pagar).
- **Cadastro** — `/app/financial-accounts/new`: página dedicada, **sem modal** (seção 25.2 — entidade
  administrativa com vários campos). Dados bancários explicitamente opcionais.
- **Detalhe** — `/app/financial-accounts/[id]`: identificação, saldo atual, histórico de
  movimentações com filtros (tipo/origem), e ações via **modal** para operações pequenas: lançar
  crédito, lançar débito, transferir, estornar (seção 25.3) — mais "Definir saldo inicial" (só
  visível enquanto a conta ainda não tem abertura) e um botão de ativar/desativar. Nenhuma ação
  crítica escondida; diálogos sempre com `role="dialog"` e título específico.

`apps/web/lib/permission-labels.ts` (módulo `financial_accounts` → "Contas Financeiras", ações
`transact`/`transfer` traduzidas) e `apps/web/lib/audit-labels.ts` atualizados para nunca exibir
código técnico cru ao usuário.

---

## 25. Testes

### Banco (`packages/db/tests`)

- `fin04-financial-accounts-contract.test.ts` (novo, **21 testes**): checagem estática do texto da
  migration — tabelas, sem `branch_id`, sem credenciais, não reaproveita `cash_movements`,
  `numeric(14,2)`, `amount>0`, partição de `origin`, append-only (triggers), unicidade de
  abertura/estorno, saldo derivado (sem coluna/tabela de projeção), 5 funções `security definer`,
  ausência de bloqueio de saldo negativo, atomicidade/lock determinístico da transferência, mesma
  empresa exigida, padrão idempotência (constraint física + loop), reversão de transferência
  atômica vs. reversão direta bloqueada para pernas de transferência, RBAC seedado, `FORCE RLS`,
  grants restritos.
- `postgres-integration.test.ts` (estendido, +**5 testes** cross-tenant reais para FIN-04): FK
  composta rejeita `financial_transaction`/`financial_transfer` apontando para conta de outro
  tenant via INSERT direto (`23503`); as 3 funções `security definer` recusam operar sobre conta
  de outro tenant (`P0002`); controle positivo (mesmo tenant funciona); RLS esconde conta de outro
  tenant numa listagem.

### API (`apps/api/tests`)

- `financial-accounts.integration.test.ts` (novo, **39 testes**), contra Postgres real via
  `app.inject()`: CRUD de conta (nome único, dados bancários opcionais, validação de payload
  estrita, 409 em nome duplicado), autenticação/contexto operacional (401/409), listagem/detalhe
  (404 para inexistente), saldo inicial (positivo/negativo/único/idempotente/validação), lançamento
  manual (crédito/débito, saldo negativo não bloqueado, conta inativa rejeitada, validação,
  idempotência simples e **concorrência real** via `Promise.all`, conflito de idempotência com
  parâmetros diferentes, estorno e estorno duplicado idempotente, estorno cruzando conta errada →
  404), transferência (atômica, rejeita auto-transferência, rejeita empresas diferentes, validação,
  idempotência simples e concorrência real, estorno atômico e estorno duplicado idempotente,
  rejeita conta inativa em qualquer ponta), RBAC negativo real (403 em 5 endpoints diferentes),
  auditoria (4 ações verificadas via `GET /audit-events`), isolamento de tenant (conta de outro
  tenant invisível/inacessível em 3 pontos).

### E2E (`apps/web/e2e`)

- `12-financial-accounts.spec.ts` (novo, **1 spec**), fluxo completo da seção 30: login → Financeiro
  → Contas Financeiras → cria conta → confere listagem → abre detalhe → lança crédito → verifica
  saldo → lança débito → verifica saldo → cria segunda conta → transfere → verifica débito na
  origem/crédito no destino → estorna a transferência (operação suportada pelo contrato) → valida
  histórico (saldo volta a zero, movimentação original marcada "Estornado", linha de estorno
  presente). Sem `sleep`; todo wait é `waitForResponse`/`waitForURL`/asserção de visibilidade.

---

## 26. E2E — resultado

**17/17** specs passaram na suíte completa (`pnpm --filter @vetoros/web test:e2e`), incluindo os 16
specs preexistentes (FIN-01/02/03 e UX-01/02/03/ADM-01/02/03 preservados) mais o novo spec FIN-04.
Uma execução intermediária da suíte completa teve um timeout isolado em
`06-users.spec.ts:49` (não relacionado a FIN-04); reexecutado sozinho e depois dentro da suíte
completa novamente, passou de forma consistente — registrado como flakiness de ambiente (sob carga
de múltiplas execuções consecutivas do Chromium), não uma regressão real (ver item 28).

---

## 27. Resultados numéricos completos

| Suíte | Resultado |
|---|---|
| Migrations | **26/26** aplicadas sem erro (`0000`–`0025`), a partir de um banco Postgres 17 limpo |
| Seed (`pnpm db:seed`) | Executado com sucesso, 2 vezes seguidas, sem erro (reconciliação RBAC idempotente confirmada) |
| Lint (todos os workspaces: `api`, `web`, `db`, `config`, `contracts`) | **0 erros** em todos |
| Typecheck (todos os workspaces) | **0 erros** em todos |
| Testes de banco (`packages/db`) | **226/226** (20 arquivos de teste, todos passando) |
| Testes de API (`apps/api`) | **287/287** (21 arquivos de teste, todos passando) |
| Testes unitários web (`apps/web`, vitest) | 0 arquivos (não há suíte unitária neste workspace — `--passWithNoTests`, comportamento preexistente) |
| Specs E2E (`apps/web/e2e`) | **17/17** (12 arquivos de spec) |

Números FIN-04 especificamente, dentro dos totais acima:
DB contract: 21 testes novos + 5 testes cross-tenant novos em `postgres-integration.test.ts`.
API: 39 testes novos. E2E: 1 spec novo (16 passos do fluxo mínimo da seção 30).

Todas as execuções acima foram observadas rodando de fato (comandos e saídas reproduzidos nesta
sessão) — nenhum número foi estimado ou copiado de execução anterior.

---

## 28. Limitações conhecidas

1. **Reset de banco durante o desenvolvimento**: ao escrever o teste de API para "rejeita um
   segundo saldo de abertura", foi encontrado um bug real de **loop infinito** em
   `set_financial_account_opening_balance` (detalhado no item 9) — a função já tinha sido aplicada
   ao Postgres local antes do bug ser descoberto. Como a correção altera o *corpo* de uma função já
   migrada (não a estrutura de tabela), a forma mais honesta de validar a correção de ponta a ponta
   foi recriar o banco `vetoros` do zero e reaplicar as 26 migrations + seed, em vez de aplicar um
   patch pontual via `psql` que divergiria silenciosamente do arquivo de migration. Isso foi feito
   (documentado no item 18) e o resultado final é o mesmo estado que qualquer ambiente novo teria
   ao rodar `pnpm db:migrate && pnpm db:seed` pela primeira vez — mas registro aqui que o Postgres
   local usado nesta sessão foi destruído e recriado uma vez durante o desenvolvimento (não
   afeta nenhum outro ambiente, e nenhuma migration anterior a 0025 foi alterada).
2. **Flakiness observada em `06-users.spec.ts:49`**: um timeout isolado apareceu em uma execução da
   suíte E2E completa, num teste que não toca nenhum código de FIN-04. Reexecutado isoladamente e
   dentro da suíte completa novamente, passou de forma consistente nas duas vezes seguintes — não
   foi possível determinar a causa raiz exata (suspeita: carga do ambiente, várias execuções
   consecutivas do Chromium/Next dev server na mesma sessão), mas não há evidência de que seja uma
   regressão causada por este marco.
3. **Categorias financeiras / plano de contas**: não implementado, conforme seção 17 do
   correio.md — `financial_transactions.description`/`reference` são os únicos campos de
   classificação disponíveis nesta rodada. Registrado como limitação futura explícita, não uma
   omissão.
4. **Integração com FIN-01/02/03**: deliberadamente não implementada nesta rodada (itens 15/16/17)
   — apenas documentada como possibilidade futura, conforme exigido pela seção 2 do correio.md.
5. **Escopo de empresa único por transferência**: uma transferência exige que origem e destino
   pertençam à mesma `company_id` — transferência intercompany (mesmo tenant, empresas diferentes)
   não é suportada nesta rodada, decisão arquitetural documentada no item 11, não uma limitação
   técnica.
6. **`cash_equivalent` fora de escopo**: por decisão documentada no item 5, `financial_accounts.type`
   suporta apenas `bank_account` nesta rodada.
7. Nenhuma integração bancária real (Open Finance/OFX/CNAB/PIX via API bancária) foi implementada —
   conforme exigido pela seção 26/27 do correio.md (fora de escopo explícito).

Nenhuma limitação foi inventada nem omitida — todas as suítes relatadas no item 27 foram executadas
de fato nesta sessão contra um Postgres real, uma API real (`app.inject()`) e um navegador real
(Playwright/Chromium contra os servidores de dev reais).

---

## 29. Arquivos alterados/criados

### Criados

- `packages/db/migrations/0025_fin04_financial_accounts.sql`
- `packages/db/tests/fin04-financial-accounts-contract.test.ts`
- `apps/api/src/financial-accounts/routes.ts`
- `apps/api/tests/financial-accounts.integration.test.ts`
- `apps/web/app/app/financial-accounts/page.tsx`
- `apps/web/app/app/financial-accounts/new/page.tsx`
- `apps/web/app/app/financial-accounts/[id]/page.tsx`
- `apps/web/e2e/12-financial-accounts.spec.ts`
- `executed.md` (este arquivo)

### Modificados

- `packages/db/migrations/meta/_journal.json` — nova entrada (idx 25) para a migration 0025.
- `packages/db/src/seed.ts` — permissions `financial_accounts.*` adicionadas ao template `finance`
  e ao papel de desenvolvimento `dev_auth_reader`.
- `packages/db/tests/postgres-integration.test.ts` — 5 testes cross-tenant reais novos para
  FIN-04 (fixtures `financialAccountA`/`financialAccountB` acrescentadas, nenhum teste existente
  alterado).
- `apps/api/src/app.ts` — `registerFinancialAccountRoutes` importado e registrado.
- `apps/web/components/nav-config.ts` — item "Contas Financeiras" no grupo Financeiro (ícone
  `Wallet` importado).
- `apps/web/lib/permission-labels.ts` — módulo `financial_accounts` e ações `transact`/`transfer`.
- `apps/web/lib/audit-labels.ts` — `resourceType`s `financial_account`/`financial_transfer` e 6
  ações novas.

Nenhum arquivo de FIN-01, FIN-02 ou FIN-03 foi alterado (rotas, migrations ou testes desses
domínios permanecem exatamente como estavam). Nenhum arquivo de `vetoros1` foi tocado. Nenhum
commit foi criado — todas as mudanças permanecem no working tree para revisão.
