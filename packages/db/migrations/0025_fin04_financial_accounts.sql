-- FIN-04: Contas Financeiras / Bancárias e Movimentações de Tesouraria. Ver executed.md
-- "Descoberta"/"Decisões arquiteturais" para a resposta completa às 10 perguntas obrigatórias da
-- seção 1 do correio.md. Resumo do que motiva esta migration:
--
-- 1/2. Não existe hoje NENHUMA entidade que represente inequivocamente uma conta bancária/
--    financeira. `cash_registers` (migration 0022) é só um dispositivo/local OPERACIONAL de
--    caixa físico, sempre preso a tenant→company→branch, sempre com sessão (`cash_sessions`)
--    para poder mover dinheiro — nunca representou "onde o dinheiro está" fora de uma gaveta
--    física, e não tem NENHUM campo bancário (banco/agência/conta/PIX).
-- 3. `cash_movements` NÃO pode ser reaproveitado como ledger bancário (proibido explicitamente
--    pela seção 2 do correio.md, e a descoberta confirma a separação semântica): toda linha de
--    `cash_movements` exige `cash_session_id not null` (migration 0022) — moveria dinheiro de/
--    para uma conta financeira artificialmente através de uma sessão de caixa que não tem nada a
--    ver com o fato (uma transferência bancária não abre nem fecha um caixa físico). FIN-04 é
--    domínio próprio.
-- 4. Não existe campo de banco/agência/conta/PIX em NENHUMA tabela do projeto (grep confirmado em
--    `payment_methods`, `cash_registers`, `suppliers`, `companies`). `payment_methods` (migration
--    0022) é só um catálogo de FORMA de pagamento (`cash`,`pix`,`debit_card`,`credit_card`,
--    `bank_transfer`,`other`) — nenhuma coluna aponta para uma conta de origem/destino (seção 16:
--    não misturar os dois conceitos).
-- 5. Nenhum saldo financeiro persistido fora de sessão de caixa existe hoje —
--    `cash_sessions.opening_amount`/`cash_movements.resulting_balance` só existem dentro de uma
--    sessão de caixa específica.
-- 6/16. `payment_methods` não tem relação nenhuma com conta de origem/destino — reforça a
--    separação da seção 16 (forma de pagamento ≠ conta financeira); esta migration NÃO adiciona
--    coluna nenhuma em `payment_methods`.
-- 7. Não existe estrutura nenhuma para transferência/PIX/TED/boleto pago/débito automático/
--    depósito/tarifa/ajuste financeiro fora de caixa — tudo novo aqui.
-- 8. Não existe nenhuma arquitetura aprovada de integração FIN-02/FIN-03 ↔ caixa/banco — FIN-02
--    (`receivable_allocations`) só liga um título a um `payments` (recebimento em caixa); FIN-03
--    (`payable_payments`) é o próprio ledger de pagamento a fornecedor, sem vínculo com caixa nem
--    conta bancária (comentário explícito na migration 0024: "não existe hoje conceito de conta
--    bancária"). Nenhuma integração automática é criada nesta rodada (seção 13/14/15).
-- 9/10. Não há nenhuma razão inequívoca para prender a conta financeira à Branch: uma conta
--    corrente empresarial é tipicamente usada por mais de uma filial da MESMA empresa (o próprio
--    correio.md, seção 4, já afirma isso como preferência arquitetural). Nenhum contrato existente
--    exige `branch_id` aqui (diferente de `cash_registers`, que precisa dele porque um caixa É um
--    local físico dentro de uma filial). Decisão: `Tenant → Company → FinancialAccount`, sem
--    `branch_id`. Uma conta bancária corporativa usada por várias filiais é modelada simplesmente
--    como UMA conta pertencente à Company — qualquer filial dessa empresa pode operar sobre ela
--    (RBAC por escopo `company`/`tenant` já cobre isso, sem precisar de N linhas ou de uma tabela
--    de associação conta↔filial que nada no domínio hoje justifica).

-- ---- financial_accounts — "onde o dinheiro está" (seção 3/4) ----
-- `type`: avaliados `bank_account`/`cash_equivalent` (seção 3). Decisão: manter só `bank_account`
-- nesta rodada — `cash_equivalent` colidiria semanticamente com o que FIN-01 já é dono
-- (`cash_registers`/`cash_sessions` já representam "dinheiro físico/equivalente operacional", com
-- abertura/fechamento de sessão); um "cash_equivalent" aqui, sem sessão, sem ligação com FIN-01,
-- criaria duas respostas diferentes para "quanto dinheiro em espécie a empresa tem" — exatamente a
-- ambiguidade que a seção 2 do correio.md pede para evitar. `check` real (não deixado como texto
-- livre) para não permitir um valor arbitrário; se um segundo tipo for necessário no futuro, é uma
-- migration nova, não um dado solto.
--
-- Sem `branch_id` (decisão acima). Dados bancários (`bank_code`,`bank_name`,`branch_number`,
-- `account_number`,`account_digit`,`pix_key`) são todos NULLABLE — seção 3: "dados bancários
-- opcionais devem continuar opcionais quando não forem necessários ao tipo da conta" — nenhum
-- deles é credencial (seção 26: nunca senha/token/certificado/segredo OAuth/chave privada/
-- credencial Open Finance; PIX aqui é só a chave cadastral, nunca um token de autorização).
-- `status` (não `active boolean`) segue a convenção já usada por `cash_registers`/`payment_methods`
-- (seção 3: "nome final pode ser ajustado... se já existir convenção melhor no projeto") — permite
-- desativar preservando histórico (seção 18: "preferir desativação a exclusão").
create table financial_accounts (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, company_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  type text not null default 'bank_account' check (type in ('bank_account')),
  bank_code text, bank_name text, branch_number text, account_number text, account_digit text, pix_key text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_by_identity_id uuid references identities(id), updated_by_identity_id uuid references identities(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,id), unique (tenant_id,company_id,name),
  foreign key (tenant_id,company_id) references companies(tenant_id,id)
);
create index financial_accounts_list_idx on financial_accounts(tenant_id,company_id,name);

-- ---- financial_transfers — cabeçalho de transferência (seção 9) ----
-- Existe como entidade própria (não só duas linhas soltas em `financial_transactions` combinadas
-- por convenção de valor) porque melhora rastreabilidade/integridade real: a idempotência de UMA
-- transferência (débito+crédito) precisa de UMA chave única, não duas independentes que poderiam
-- divergir sob retry parcial. `from`/`to` são FKs same-tenant reais (nunca polimórficas).
create table financial_transfers (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  from_financial_account_id uuid not null, to_financial_account_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  description text not null check (length(trim(description)) > 0),
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  created_by_identity_id uuid references identities(id), created_at timestamptz not null default now(),
  unique (tenant_id,id), unique (tenant_id,idempotency_key),
  foreign key (tenant_id,from_financial_account_id) references financial_accounts(tenant_id,id),
  foreign key (tenant_id,to_financial_account_id) references financial_accounts(tenant_id,id),
  check (from_financial_account_id <> to_financial_account_id)
);

-- ---- financial_transactions — ledger append-only (seção 5/6/7) ----
-- `type`: `credit`/`debit`, `amount>0` sempre — nunca valor negativo (seção 6: "evitar valores
-- negativos quando isso comprometer legibilidade/integridade"; saldo = credits - debits). Mesma
-- convenção de `cash_movements`.type mas sem os tipos específicos de caixa (`opening`/`receipt`/
-- `refund`/`supply`/`withdrawal`) — aqui quem distingue a NATUREZA do lançamento é `origin`, não
-- `type` (que só diz a direção contábil).
--
-- `origin` cobre exatamente os 4 jeitos de uma linha existir: `opening_balance` (seção 12, uma
-- movimentação explícita, nunca uma coluna solta em `financial_accounts`), `manual` (lançamento
-- controlado via função, seção 19), `transfer` (uma perna de uma `financial_transfers`, seção 9),
-- `reversal` (estorno, seção 8). O CHECK abaixo é uma partição exata (XOR) das 4 combinações
-- válidas de `financial_transfer_id`/`reverses_transaction_id`/`idempotency_key` — nenhuma linha
-- pode nascer fora dessas 4 formas, mesmo por INSERT direto (embora não haja GRANT de INSERT
-- direto — grant abaixo — esta é uma segunda camada de integridade física, seção 21: "não depender
-- somente de RLS"/só de GRANT).
--
-- Sem coluna `resulting_balance` (diferente de `cash_movements`): seção 10 do correio.md pede
-- explicitamentea para preferir saldo DERIVADO (`SUM(credits)-SUM(debits)`) e "não introduzir
-- cache/projeção prematura" quando o volume não justificar. `cash_movements.resulting_balance`
-- existe porque FIN-01 precisa comparar o saldo esperado no FECHAMENTO de uma sessão contra o
-- valor informado pelo operador — FIN-04 não tem conceito de fechamento/sessão, então persistir
-- um saldo por linha aqui seria exatamente a "projeção prematura" que a seção 10 pede para evitar.
create table financial_transactions (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, company_id uuid not null, financial_account_id uuid not null,
  type text not null check (type in ('credit','debit')),
  amount numeric(14,2) not null check (amount > 0),
  occurred_at timestamptz not null default now(),
  description text not null check (length(trim(description)) > 0),
  reference text,
  origin text not null check (origin in ('opening_balance','manual','transfer','reversal')),
  financial_transfer_id uuid, reverses_transaction_id uuid,
  idempotency_key text,
  created_by_identity_id uuid references identities(id), created_at timestamptz not null default now(),
  unique (tenant_id,id), unique (tenant_id,idempotency_key),
  foreign key (tenant_id,company_id) references companies(tenant_id,id),
  foreign key (tenant_id,financial_account_id) references financial_accounts(tenant_id,id),
  foreign key (tenant_id,financial_transfer_id) references financial_transfers(tenant_id,id),
  foreign key (tenant_id,reverses_transaction_id) references financial_transactions(tenant_id,id),
  check (
    (origin in ('opening_balance','manual') and financial_transfer_id is null and reverses_transaction_id is null and idempotency_key is not null and length(trim(idempotency_key)) >= 8)
    or (origin = 'transfer' and financial_transfer_id is not null and reverses_transaction_id is null and idempotency_key is null)
    or (origin = 'reversal' and financial_transfer_id is null and reverses_transaction_id is not null and idempotency_key is null)
  )
);
create index financial_transactions_account_idx on financial_transactions(tenant_id,financial_account_id,occurred_at desc,id desc);
create index financial_transactions_transfer_idx on financial_transactions(tenant_id,financial_transfer_id) where financial_transfer_id is not null;
-- no máximo uma movimentação de abertura por conta (seção 12) e no máximo um estorno por
-- movimentação original (seção 8) — ambos garantidos por constraint física, mesma técnica de
-- `cash_movements_refund_once_uq`/`payable_payments_reversal_once_uq`.
create unique index financial_transactions_opening_once_uq on financial_transactions(tenant_id,financial_account_id) where origin='opening_balance';
create unique index financial_transactions_reversal_once_uq on financial_transactions(tenant_id,reverses_transaction_id) where origin='reversal';

alter table financial_accounts enable row level security; alter table financial_accounts force row level security;
create policy financial_accounts_tenant on financial_accounts using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());
alter table financial_transfers enable row level security; alter table financial_transfers force row level security;
create policy financial_transfers_tenant on financial_transfers using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());
alter table financial_transactions enable row level security; alter table financial_transactions force row level security;
create policy financial_transactions_tenant on financial_transactions using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());

-- Imutabilidade do ledger no PostgreSQL, não só na aplicação (seção 7) — mesma técnica de
-- `reject_cash_movement_mutation`/`reject_payable_payment_mutation`. `financial_transfers`
-- (cabeçalho) também é append-only pela mesma razão: alterar o cabeçalho depois de criado poderia
-- divergir da dupla movimentação já lançada.
create function reject_financial_transaction_mutation() returns trigger language plpgsql as $$ begin raise exception 'financial_transactions is append-only'; end $$;
create trigger financial_transactions_append_only before update or delete on financial_transactions for each row execute function reject_financial_transaction_mutation();
create function reject_financial_transfer_mutation() returns trigger language plpgsql as $$ begin raise exception 'financial_transfers is append-only'; end $$;
create trigger financial_transfers_append_only before update or delete on financial_transfers for each row execute function reject_financial_transfer_mutation();

-- Saldo derivado (seção 10, Opção A) — helper reaproveitado pelas funções abaixo e pela API.
create function financial_account_balance(p_tenant_id uuid, p_financial_account_id uuid) returns numeric language sql stable as $$
  select coalesce(sum(case when type='credit' then amount else -amount end),0) from financial_transactions
  where tenant_id=p_tenant_id and financial_account_id=p_financial_account_id
$$;

-- Saldo inicial (seção 12): sempre uma movimentação `opening_balance`, nunca uma coluna editável
-- solta em `financial_accounts` — depois de lançada, integra o histórico como qualquer outra
-- movimentação (só pode ser corrigida por um lançamento manual novo ou um estorno, nunca editada).
-- `p_amount` pode ser negativo (uma conta pode começar operando já no vermelho — seção 11: não
-- inventar bloqueio universal de saldo negativo) — o sinal decide `type`, o valor armazenado é
-- sempre positivo (`amount>0`, seção 6). Trava a conta (`for update`) para serializar duas
-- tentativas concorrentes de abrir saldo — a unicidade parcial
-- `financial_transactions_opening_once_uq` é quem garante estruturalmente o "no máximo uma"
-- mesmo assim (mesmo padrão de duplo-clique/retry das demais funções deste domínio).
create function set_financial_account_opening_balance(p_financial_account_id uuid, p_amount numeric, p_idempotency_key text)
returns table(transaction_id uuid, resulting_balance numeric, idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare v_tenant uuid := vetoros_current_tenant_id(); v_account financial_accounts%rowtype; v_tx_id uuid; v_type text;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if p_amount is null or p_amount = 0 or length(trim(coalesce(p_idempotency_key,''))) < 8 then raise exception 'invalid opening balance' using errcode='22023'; end if;
  loop
    select ft.id into v_tx_id from financial_transactions ft where ft.tenant_id=v_tenant and ft.idempotency_key=p_idempotency_key;
    if found then
      if not exists (select 1 from financial_transactions ft where ft.id=v_tx_id and ft.financial_account_id=p_financial_account_id and ft.origin='opening_balance' and ft.amount=abs(p_amount)) then
        raise exception 'idempotency conflict' using errcode='23505';
      end if;
      return query select v_tx_id, financial_account_balance(v_tenant, p_financial_account_id), true; return;
    end if;
    select * into v_account from financial_accounts fa where fa.tenant_id=v_tenant and fa.id=p_financial_account_id and fa.status='active' for update;
    if not found then raise exception 'financial account not found or inactive' using errcode='P0002'; end if;
    -- Checagem explícita ENQUANTO a conta está travada (`for update` acima), não só a unicidade
    -- parcial no INSERT abaixo: diferente de `receive_payment`/`refund_payment`/`pay_installment`
    -- (onde o predicado do `select` de idempotência no topo do loop É o mesmo predicado da
    -- constraint que pode ser violada, então um `unique_violation` sempre "resolve" revisitando o
    -- topo do loop), aqui a constraint que pode colidir
    -- (`financial_transactions_opening_once_uq`, por `financial_account_id`) é DIFERENTE do
    -- predicado da consulta de idempotência (por `idempotency_key`) — uma segunda chamada com uma
    -- chave DIFERENTE nunca seria encontrada por aquele `select`, e um `unique_violation` do
    -- `financial_transactions_opening_once_uq` faria o `continue` reexecutar exatamente a mesma
    -- sequência para sempre (bug real de loop infinito encontrado escrevendo o teste de API deste
    -- domínio — `apps/api/tests/financial-accounts.integration.test.ts`, "rejects a second
    -- opening balance"). Esta checagem, feita sob o lock da conta (portanto livre de corrida),
    -- resolve isso: rejeita imediatamente com o mesmo `errcode` de conflito, em vez de tentar o
    -- INSERT e reentrar no loop.
    if exists (select 1 from financial_transactions ft where ft.tenant_id=v_tenant and ft.financial_account_id=p_financial_account_id and ft.origin='opening_balance') then
      raise exception 'opening balance already set for this account' using errcode='23505';
    end if;
    v_type := case when p_amount > 0 then 'credit' else 'debit' end;
    begin
      insert into financial_transactions (tenant_id,company_id,financial_account_id,type,amount,description,origin,idempotency_key,created_by_identity_id)
        values (v_tenant,v_account.company_id,p_financial_account_id,v_type,abs(p_amount),'Saldo inicial','opening_balance',p_idempotency_key,nullif(current_setting('app.actor_identity_id',true),'')::uuid)
        returning id into v_tx_id;
    exception when unique_violation then continue; end;
    return query select v_tx_id, financial_account_balance(v_tenant, p_financial_account_id), false;
    return;
  end loop;
end $$;

-- Lançamento manual controlado (seção 19): a ÚNICA forma de crédito/débito manual — nunca uma API
-- genérica que deixe o cliente montar qualquer linha do ledger burlando regras; toda escrita passa
-- por esta função `security definer`. Saldo negativo NÃO é bloqueado aqui (seção 11: decisão
-- explícita registrada no executed.md — uma conta bancária pode operar com limite/cheque especial/
-- tarifas/liquidação posterior; nenhum contrato de negócio existente pede o contrário). Conta
-- precisa estar `active` — lançar em conta desativada não faz sentido (mesma trava de
-- `set_financial_account_opening_balance`).
create function record_financial_transaction(p_financial_account_id uuid, p_type text, p_amount numeric, p_description text, p_reference text, p_occurred_at timestamptz, p_idempotency_key text)
returns table(transaction_id uuid, resulting_balance numeric, idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare v_tenant uuid := vetoros_current_tenant_id(); v_account financial_accounts%rowtype; v_tx_id uuid;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if p_type not in ('credit','debit') or p_amount is null or p_amount <= 0 or p_description is null or length(trim(p_description))=0 or length(trim(coalesce(p_idempotency_key,''))) < 8 then
    raise exception 'invalid transaction' using errcode='22023';
  end if;
  loop
    select ft.id into v_tx_id from financial_transactions ft where ft.tenant_id=v_tenant and ft.idempotency_key=p_idempotency_key;
    if found then
      if not exists (select 1 from financial_transactions ft where ft.id=v_tx_id and ft.financial_account_id=p_financial_account_id and ft.type=p_type and ft.amount=round(p_amount,2) and ft.origin='manual') then
        raise exception 'idempotency conflict' using errcode='23505';
      end if;
      return query select v_tx_id, financial_account_balance(v_tenant, p_financial_account_id), true; return;
    end if;
    select * into v_account from financial_accounts fa where fa.tenant_id=v_tenant and fa.id=p_financial_account_id and fa.status='active' for update;
    if not found then raise exception 'financial account not found or inactive' using errcode='P0002'; end if;
    begin
      insert into financial_transactions (tenant_id,company_id,financial_account_id,type,amount,description,reference,occurred_at,origin,idempotency_key,created_by_identity_id)
        values (v_tenant,v_account.company_id,p_financial_account_id,p_type,round(p_amount,2),trim(p_description),nullif(trim(coalesce(p_reference,'')),''),coalesce(p_occurred_at,now()),'manual',p_idempotency_key,nullif(current_setting('app.actor_identity_id',true),'')::uuid)
        returning id into v_tx_id;
    exception when unique_violation then continue; end;
    return query select v_tx_id, financial_account_balance(v_tenant, p_financial_account_id), false;
    return;
  end loop;
end $$;

-- Transferência (seção 9): atômica (débito+crédito na MESMA transação PostgreSQL — nunca só um
-- lado persistido), idempotente (chave própria em `financial_transfers`, mesmo padrão de retry das
-- demais funções deste domínio), protegida contra concorrência por constraint física
-- (`unique(tenant_id,idempotency_key)` + o padrão loop/`exception when unique_violation`, nunca só
-- um SELECT-então-INSERT). Regras mínimas exigidas: origem<>destino (CHECK físico em
-- `financial_transfers`), as duas contas ativas, mesmo tenant (implícito: ambas resolvidas com
-- `tenant_id=v_tenant`), MESMA empresa — decisão arquitetural registrada no executed.md: nesta
-- rodada uma transferência exige `from.company_id = to.company_id`; mover dinheiro entre empresas
-- distintas do mesmo tenant é uma operação contábil (intercompany) sem contrato de negócio
-- aprovado ainda, e por isso fica fora de escopo aqui em vez de inventado. Valor>0 (CHECK físico).
--
-- Trava as DUAS contas em ordem determinística (por id) — não pela ordem origem/destino informada
-- pelo chamador — mesma técnica de `allocate_payment` (FIN-02): evita deadlock entre duas
-- transferências concorrentes em direções opostas entre o mesmo par de contas.
create function transfer_between_financial_accounts(p_from_id uuid, p_to_id uuid, p_amount numeric, p_description text, p_idempotency_key text)
returns table(transfer_id uuid, debit_transaction_id uuid, credit_transaction_id uuid, idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare
  v_tenant uuid := vetoros_current_tenant_id();
  v_from financial_accounts%rowtype; v_to financial_accounts%rowtype;
  v_transfer_id uuid; v_debit_id uuid; v_credit_id uuid;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if p_from_id = p_to_id then raise exception 'origin and destination must differ' using errcode='22023'; end if;
  if p_amount is null or p_amount <= 0 or p_description is null or length(trim(p_description))=0 or length(trim(coalesce(p_idempotency_key,''))) < 8 then
    raise exception 'invalid transfer' using errcode='22023';
  end if;
  loop
    select ft.id into v_transfer_id from financial_transfers ft where ft.tenant_id=v_tenant and ft.idempotency_key=p_idempotency_key;
    if found then
      if not exists (select 1 from financial_transfers ft where ft.id=v_transfer_id and ft.from_financial_account_id=p_from_id and ft.to_financial_account_id=p_to_id and ft.amount=round(p_amount,2)) then
        raise exception 'idempotency conflict' using errcode='23505';
      end if;
      select id into v_debit_id from financial_transactions where tenant_id=v_tenant and financial_transfer_id=v_transfer_id and financial_account_id=p_from_id;
      select id into v_credit_id from financial_transactions where tenant_id=v_tenant and financial_transfer_id=v_transfer_id and financial_account_id=p_to_id;
      return query select v_transfer_id, v_debit_id, v_credit_id, true; return;
    end if;
    if p_from_id < p_to_id then
      select * into v_from from financial_accounts fa where fa.tenant_id=v_tenant and fa.id=p_from_id and fa.status='active' for update;
      select * into v_to from financial_accounts fa where fa.tenant_id=v_tenant and fa.id=p_to_id and fa.status='active' for update;
    else
      select * into v_to from financial_accounts fa where fa.tenant_id=v_tenant and fa.id=p_to_id and fa.status='active' for update;
      select * into v_from from financial_accounts fa where fa.tenant_id=v_tenant and fa.id=p_from_id and fa.status='active' for update;
    end if;
    if v_from.id is null or v_to.id is null then raise exception 'financial account not found or inactive' using errcode='P0002'; end if;
    if v_from.company_id <> v_to.company_id then raise exception 'accounts belong to different companies' using errcode='23514'; end if;
    begin
      insert into financial_transfers (tenant_id,from_financial_account_id,to_financial_account_id,amount,description,idempotency_key,created_by_identity_id)
        values (v_tenant,p_from_id,p_to_id,round(p_amount,2),trim(p_description),p_idempotency_key,nullif(current_setting('app.actor_identity_id',true),'')::uuid)
        returning id into v_transfer_id;
    exception when unique_violation then continue; end;
    insert into financial_transactions (tenant_id,company_id,financial_account_id,type,amount,description,origin,financial_transfer_id,created_by_identity_id)
      values (v_tenant,v_from.company_id,p_from_id,'debit',round(p_amount,2),trim(p_description),'transfer',v_transfer_id,nullif(current_setting('app.actor_identity_id',true),'')::uuid)
      returning id into v_debit_id;
    insert into financial_transactions (tenant_id,company_id,financial_account_id,type,amount,description,origin,financial_transfer_id,created_by_identity_id)
      values (v_tenant,v_to.company_id,p_to_id,'credit',round(p_amount,2),trim(p_description),'transfer',v_transfer_id,nullif(current_setting('app.actor_identity_id',true),'')::uuid)
      returning id into v_credit_id;
    return query select v_transfer_id, v_debit_id, v_credit_id, false;
    return;
  end loop;
end $$;

-- Estorno de lançamento manual/abertura (seção 8): nova movimentação de natureza inversa,
-- referência explícita (`reverses_transaction_id`), nunca edita o histórico. Só aceita origem
-- `manual`/`opening_balance` — uma perna de transferência precisa ser estornada em conjunto pela
-- outra função abaixo (nunca uma perna sozinha, para não deixar a transferência "capenga"), e um
-- estorno nunca pode ser estornado de novo (protegido pela própria checagem `origin<>'reversal'`
-- ANTES de checar idempotência, mais a unicidade parcial `financial_transactions_reversal_once_uq`
-- contra estorno duplicado, mais o filtro `tenant_id=v_tenant` contra cross-tenant).
create function reverse_financial_transaction(p_transaction_id uuid, p_reason text)
returns table(reversal_id uuid, transaction_id uuid, resulting_balance numeric, idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare v_tenant uuid := vetoros_current_tenant_id(); v_original financial_transactions%rowtype; v_reversal_id uuid; v_reverse_type text;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  select * into v_original from financial_transactions ft where ft.tenant_id=v_tenant and ft.id=p_transaction_id;
  if not found then raise exception 'transaction not found' using errcode='P0002'; end if;
  if v_original.origin not in ('manual','opening_balance') then raise exception 'only manual or opening-balance entries can be reversed directly' using errcode='22023'; end if;
  loop
    select ft.id into v_reversal_id from financial_transactions ft where ft.tenant_id=v_tenant and ft.reverses_transaction_id=p_transaction_id and ft.origin='reversal';
    if found then return query select v_reversal_id, p_transaction_id, financial_account_balance(v_tenant, v_original.financial_account_id), true; return; end if;
    perform 1 from financial_accounts fa where fa.tenant_id=v_tenant and fa.id=v_original.financial_account_id for update;
    v_reverse_type := case when v_original.type='credit' then 'debit' else 'credit' end;
    begin
      insert into financial_transactions (tenant_id,company_id,financial_account_id,type,amount,description,origin,reverses_transaction_id,created_by_identity_id)
        values (v_tenant,v_original.company_id,v_original.financial_account_id,v_reverse_type,v_original.amount,coalesce(nullif(trim(p_reason),''),'Estorno de lançamento'),'reversal',p_transaction_id,nullif(current_setting('app.actor_identity_id',true),'')::uuid)
        returning id into v_reversal_id;
    exception when unique_violation then continue; end;
    return query select v_reversal_id, p_transaction_id, financial_account_balance(v_tenant, v_original.financial_account_id), false;
    return;
  end loop;
end $$;

-- Estorno de transferência (seção 8/9): as DUAS pernas revertidas na MESMA transação — nunca
-- estorna só um lado (mesma exigência de atomicidade da transferência original). Idempotente: a
-- checagem cobre a perna de débito (se ela já foi estornada, a de crédito também foi — as duas
-- nascem juntas em `transfer_between_financial_accounts` e nenhuma outra função cria/edita linhas
-- de `origin='transfer'`).
create function reverse_financial_transfer(p_transfer_id uuid, p_reason text)
returns table(transfer_id uuid, debit_reversal_id uuid, credit_reversal_id uuid, idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare
  v_tenant uuid := vetoros_current_tenant_id();
  v_transfer financial_transfers%rowtype; v_debit_leg financial_transactions%rowtype; v_credit_leg financial_transactions%rowtype;
  v_debit_reversal_id uuid; v_credit_reversal_id uuid; v_reason text;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  select * into v_transfer from financial_transfers ft where ft.tenant_id=v_tenant and ft.id=p_transfer_id;
  if not found then raise exception 'transfer not found' using errcode='P0002'; end if;
  select * into v_debit_leg from financial_transactions ft where ft.tenant_id=v_tenant and ft.financial_transfer_id=p_transfer_id and ft.financial_account_id=v_transfer.from_financial_account_id and ft.type='debit';
  select * into v_credit_leg from financial_transactions ft where ft.tenant_id=v_tenant and ft.financial_transfer_id=p_transfer_id and ft.financial_account_id=v_transfer.to_financial_account_id and ft.type='credit';
  loop
    select ft.id into v_debit_reversal_id from financial_transactions ft where ft.tenant_id=v_tenant and ft.reverses_transaction_id=v_debit_leg.id and ft.origin='reversal';
    if found then
      select ft.id into v_credit_reversal_id from financial_transactions ft where ft.tenant_id=v_tenant and ft.reverses_transaction_id=v_credit_leg.id and ft.origin='reversal';
      return query select p_transfer_id, v_debit_reversal_id, v_credit_reversal_id, true; return;
    end if;
    if v_transfer.from_financial_account_id < v_transfer.to_financial_account_id then
      perform 1 from financial_accounts fa where fa.tenant_id=v_tenant and fa.id=v_transfer.from_financial_account_id for update;
      perform 1 from financial_accounts fa where fa.tenant_id=v_tenant and fa.id=v_transfer.to_financial_account_id for update;
    else
      perform 1 from financial_accounts fa where fa.tenant_id=v_tenant and fa.id=v_transfer.to_financial_account_id for update;
      perform 1 from financial_accounts fa where fa.tenant_id=v_tenant and fa.id=v_transfer.from_financial_account_id for update;
    end if;
    v_reason := coalesce(nullif(trim(p_reason),''),'Estorno de transferência');
    begin
      insert into financial_transactions (tenant_id,company_id,financial_account_id,type,amount,description,origin,reverses_transaction_id,created_by_identity_id)
        values (v_tenant,v_debit_leg.company_id,v_debit_leg.financial_account_id,'credit',v_debit_leg.amount,v_reason,'reversal',v_debit_leg.id,nullif(current_setting('app.actor_identity_id',true),'')::uuid)
        returning id into v_debit_reversal_id;
      insert into financial_transactions (tenant_id,company_id,financial_account_id,type,amount,description,origin,reverses_transaction_id,created_by_identity_id)
        values (v_tenant,v_credit_leg.company_id,v_credit_leg.financial_account_id,'debit',v_credit_leg.amount,v_reason,'reversal',v_credit_leg.id,nullif(current_setting('app.actor_identity_id',true),'')::uuid)
        returning id into v_credit_reversal_id;
    exception when unique_violation then continue; end;
    return query select p_transfer_id, v_debit_reversal_id, v_credit_reversal_id, false;
    return;
  end loop;
end $$;

insert into permissions (code,module,description) values
  ('financial_accounts.read','financial_accounts','financial_accounts.read'),
  ('financial_accounts.create','financial_accounts','financial_accounts.create'),
  ('financial_accounts.update','financial_accounts','financial_accounts.update'),
  ('financial_accounts.transact','financial_accounts','financial_accounts.transact'),
  ('financial_accounts.transfer','financial_accounts','financial_accounts.transfer'),
  ('financial_accounts.reverse','financial_accounts','financial_accounts.reverse')
on conflict (code) do nothing;

-- `financial_accounts` é cadastro administrativo simples (nome/dados bancários/status) — INSERT/
-- UPDATE diretos, mesmo padrão de `cash_registers`/`companies`/`branches`. O LEDGER
-- (`financial_transactions`/`financial_transfers`) só muda de estado através das funções
-- `security definer` acima — só SELECT aqui, mesma técnica restritiva de `cash_movements`/
-- `payable_payments`: nenhum caminho de escrita direto que pudesse contornar lock/idempotência/
-- invariantes das funções.
grant select,insert,update on financial_accounts to vetoros_runtime;
grant select on financial_transactions, financial_transfers to vetoros_runtime;
grant execute on function set_financial_account_opening_balance(uuid,numeric,text) to vetoros_runtime;
grant execute on function record_financial_transaction(uuid,text,numeric,text,text,timestamptz,text) to vetoros_runtime;
grant execute on function transfer_between_financial_accounts(uuid,uuid,numeric,text,text) to vetoros_runtime;
grant execute on function reverse_financial_transaction(uuid,text) to vetoros_runtime;
grant execute on function reverse_financial_transfer(uuid,text) to vetoros_runtime;
grant execute on function financial_account_balance(uuid,uuid) to vetoros_runtime;
