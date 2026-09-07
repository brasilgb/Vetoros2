-- FIN-03: Contas a Pagar. Ver executed.md "Descoberta"/"Decisões arquiteturais". Espelha
-- conceitualmente o FIN-02 (Recebíveis) onde faz sentido, mas com duas diferenças estruturais
-- deliberadas — ver comentários abaixo em cada uma:
--   1) título (`payables`) e parcela (`payable_installments`) são tabelas SEPARADAS aqui (a seção
--      3 do correio.md pede isso explicitamente: `payable_installments` tem `payable_id` como
--      campo próprio), diferente de FIN-02, onde cada linha de `receivables` já era a própria
--      parcela;
--   2) o pagamento (`payable_payments`) é o próprio ledger append-only deste domínio — não existe
--      vínculo obrigatório com o Caixa do FIN-01 nesta rodada (seção 11 do correio.md: "se os
--      contratos ainda não responderem isso inequivocamente, não implementar integração
--      obrigatória"; não existe hoje conceito de conta bancária nem contrato definindo se um
--      pagamento de fornecedor exige sessão de caixa aberta, então a integração fica para um
--      marco específico).

-- ---- Descoberta (seção 1 do correio.md) ----
-- 1.1 Compras: `purchase_orders.status` é `draft|approved|cancelled` (migration 0013) — a
--     transição `draft->approved` é o único reconhecimento formal de compromisso comercial hoje;
--     uma vez `approved`, a máquina de estados atual (`transitions` em purchase-orders.ts) não
--     permite MAIS NENHUMA transição — ou seja, um pedido aprovado nunca mais é cancelado pelos
--     contratos aprovados de COM-01. `purchase_orders.total` já é persistido e recalculado por
--     trigger a partir dos itens (`recompute_purchase_order_totals`) — mesma técnica reaproveitada
--     abaixo para `payables.original_amount` a partir de `payable_installments`. NÃO existe
--     condição de pagamento, vencimento nem parcelamento em Compras — nenhum campo existente
--     colide semanticamente com Contas a Pagar, e nenhum foi reaproveitado por semelhança nominal.
-- 1.2 Fornecedores: `suppliers` é tenant-scoped (`unique(tenant_id,id)`), com `legal_name`/
--     `document_normalized` — os dois campos snapshotados na seção 2.3 abaixo.
-- 1.3 Devoluções (COM-04): `purchase_returns` não persiste nenhum valor de crédito financeiro —
--     é só reversão física de estoque (migration 0015/0011). Não existe estrutura de compensação
--     de contas a pagar hoje, e esta rodada explicitamente NÃO cria uma (seção 1.3 do correio.md:
--     "não criar automaticamente um sistema complexo de créditos/compensações"). Preparado para o
--     futuro apenas na medida em que `payable_payments` já é uma estrutura append-only genérica o
--     bastante para, um dia, registrar uma "origem" de crédito — sem inventar essa regra agora.
-- 1.4 Caixa (FIN-01): `cash_movements` é o ledger de UM caixa físico/lógico específico
--     (`cash_session_id not null` — migration 0022); não existe hoje nem sessão de caixa
--     dedicada a pagamentos a fornecedor nem conceito de conta bancária, então FIN-03 NÃO
--     transforma `cash_movements` na tabela mestre de Contas a Pagar (proibido explicitamente pelo
--     correio.md) — `payable_payments` é o próprio ledger deste domínio, preparado (mas não
--     acoplado) para uma futura integração operacional com Caixa.
-- 1.5 Recebíveis (FIN-02): reaproveitado quase integralmente — status `active`/`canceled` só
--     administrativo (nunca persiste `overdue`/`partial`/`paid`), origem via FK real nullable
--     (nunca FK polimórfica genérica), idempotência por retry na geração a partir de uma origem,
--     RLS/RBAC/auditoria no mesmo padrão. Onde NÃO copiado, é por diferença estrutural real: ver
--     título/parcela acima, e "pagamento" aqui é o próprio ledger (FIN-02 delegava isso a
--     `payments`/`receivable_allocations` do FIN-01, que não se aplicam a fornecedor).

-- ---- payables (título) ----
-- Snapshot de fornecedor (seção 2.3): `supplier_name_snapshot`/`supplier_document_snapshot`
-- capturados na criação e NUNCA atualizados depois — preserva o histórico financeiro mesmo se o
-- cadastro do fornecedor mudar (renomear, corrigir documento) posteriormente. `supplier_id`
-- continua sendo a entidade vinculada (para navegação/filtro), mas o texto exibido no título já
-- criado nunca reflete uma edição futura do cadastro. `original_amount` é sempre DERIVADO da soma
-- das parcelas (trigger abaixo, mesma técnica de `purchase_orders.total`) — nunca uma segunda
-- fonte de verdade que possa divergir (seção 6: "evitar flags redundantes que possam divergir").
create table payables (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, company_id uuid not null, branch_id uuid not null,
  supplier_id uuid, supplier_name_snapshot text, supplier_document_snapshot text,
  purchase_order_id uuid,
  description text not null check (length(trim(description)) > 0), document_number text,
  issue_date date not null default current_date,
  original_amount numeric(14,2) not null default 0 check (original_amount >= 0),
  status text not null default 'active' check (status in ('active','canceled')),
  canceled_at timestamptz, cancel_reason text,
  created_by_identity_id uuid references identities(id), updated_by_identity_id uuid references identities(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
  foreign key (tenant_id,supplier_id) references suppliers(tenant_id,id),
  foreign key (tenant_id,purchase_order_id) references purchase_orders(tenant_id,id),
  check ((status='active' and canceled_at is null) or (status='canceled' and canceled_at is not null)),
  check (purchase_order_id is null or supplier_id is not null)
);
-- No máximo um título ATIVO por pedido de compra (seção 4: "constraint... impedindo a mesma
-- origem de gerar duas contas indevidamente"). Parcial em `status<>'canceled'` (não
-- `status='active'`) por precaução com a comparação NULL de `text<>`: `status<>'canceled'` já
-- exclui corretamente as canceladas e inclui as ativas, sem depender de uma segunda forma de
-- expressar a mesma coisa. Cancelar o título libera a origem para um novo título correto.
create unique index payables_purchase_order_uq on payables(tenant_id,purchase_order_id) where purchase_order_id is not null and status<>'canceled';
create index payables_list_idx on payables(tenant_id,branch_id,created_at desc);
create index payables_supplier_idx on payables(tenant_id,supplier_id) where supplier_id is not null;

-- ---- payable_installments (parcela) — seção 3.2, tabela própria com `payable_id` ----
create table payable_installments (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, company_id uuid not null, branch_id uuid not null,
  payable_id uuid not null,
  installment_number int not null check (installment_number >= 1), installment_count int not null check (installment_count >= 1),
  original_amount numeric(14,2) not null check (original_amount > 0), due_date date not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,id), unique (tenant_id,payable_id,installment_number),
  foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
  foreign key (tenant_id,payable_id) references payables(tenant_id,id),
  check (installment_number <= installment_count)
);
create index payable_installments_payable_idx on payable_installments(tenant_id,payable_id);
create index payable_installments_due_idx on payable_installments(tenant_id,branch_id,due_date);

-- ---- payable_payments (ledger append-only) — seção 3.3/8: nunca DELETE físico; um estorno é
-- outra LINHA (`type='reversal'`), nunca uma edição do pagamento original. Mesma técnica de
-- `cash_movements` (FIN-01): `type` distingue o evento, `reverses_payment_id` aponta pro
-- pagamento original só quando `type='reversal'`, e a unicidade parcial abaixo impede o duplo
-- estorno estruturalmente (nunca só uma checagem de aplicação).
create table payable_payments (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, company_id uuid not null, branch_id uuid not null,
  payable_installment_id uuid not null,
  type text not null check (type in ('payment','reversal')),
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  payment_method_id uuid references payment_methods(id),
  reverses_payment_id uuid,
  notes text,
  idempotency_key text, -- seção 7: só pagamento precisa (retry/duplo-clique); estorno é idempotente pela unicidade abaixo, não por chave própria.
  created_by_identity_id uuid references identities(id), created_at timestamptz not null default now(),
  unique (tenant_id,id), unique (tenant_id,idempotency_key),
  foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
  foreign key (tenant_id,payable_installment_id) references payable_installments(tenant_id,id),
  foreign key (tenant_id,reverses_payment_id) references payable_payments(tenant_id,id),
  check ((type='payment' and reverses_payment_id is null and idempotency_key is not null and length(trim(idempotency_key))>=8)
      or (type='reversal' and reverses_payment_id is not null and idempotency_key is null))
);
create index payable_payments_installment_idx on payable_payments(tenant_id,payable_installment_id);
-- no máximo um estorno por pagamento (seção 8: "impedir duplo estorno") — mesma técnica de
-- `cash_movements_refund_once_uq`.
create unique index payable_payments_reversal_once_uq on payable_payments(tenant_id,reverses_payment_id) where type='reversal';

alter table payables enable row level security; alter table payables force row level security;
create policy payables_tenant on payables using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());
alter table payable_installments enable row level security; alter table payable_installments force row level security;
create policy payable_installments_tenant on payable_installments using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());
alter table payable_payments enable row level security; alter table payable_payments force row level security;
create policy payable_payments_tenant on payable_payments using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());

create function reject_payable_payment_mutation() returns trigger language plpgsql as $$ begin raise exception 'payable_payments is append-only'; end $$;
create trigger payable_payments_append_only before update or delete on payable_payments for each row execute function reject_payable_payment_mutation();

-- `original_amount` do título é sempre a soma das parcelas — mesma técnica de
-- `recompute_purchase_order_totals` (migration 0013), aplicada aqui para a mesma finalidade:
-- nunca deixar duas fontes de verdade divergirem.
create function recompute_payable_total() returns trigger language plpgsql as $$
declare v_payable_id uuid := coalesce(new.payable_id, old.payable_id); v_tenant uuid := coalesce(new.tenant_id, old.tenant_id); v_total numeric;
begin
  select coalesce(sum(original_amount),0) into v_total from payable_installments where tenant_id=v_tenant and payable_id=v_payable_id;
  update payables set original_amount=v_total, updated_at=now() where tenant_id=v_tenant and id=v_payable_id;
  return null;
end $$;
create trigger payable_installments_recompute_total after insert or update or delete on payable_installments for each row execute function recompute_payable_total();

-- Criação de título + parcelas (seções 2.1/2.2/2.3/4/5). Duas origens possíveis: `purchase_order`
-- (financeiramente exigível só quando `approved` — seção 1.1) ou manual (`p_purchase_order_id`
-- nulo). Trava a origem (linha do pedido) ANTES de checar duplicidade — mesma técnica de
-- `generate_receivables` (FIN-02): serializa duas chamadas concorrentes para o MESMO pedido sem
-- precisar do padrão loop+`exception when unique_violation` (não há, aqui, nenhuma janela de
-- corrida possível entre travar e checar). Quando a origem é um pedido, a soma das parcelas
-- precisa fechar EXATAMENTE com `purchase_orders.total` (seção 5); quando é manual, não há um
-- valor externo para validar — o total do título é o que a soma das parcelas definir.
create function create_payable(p_supplier_id uuid, p_purchase_order_id uuid, p_company_id uuid, p_branch_id uuid, p_description text, p_document_number text, p_issue_date date, p_installments jsonb)
returns table(
  id uuid, tenant_id uuid, company_id uuid, branch_id uuid, supplier_id uuid, supplier_name_snapshot text, supplier_document_snapshot text,
  purchase_order_id uuid, description text, document_number text, issue_date date, original_amount numeric, status text,
  canceled_at timestamptz, cancel_reason text, created_by_identity_id uuid, updated_by_identity_id uuid, created_at timestamptz, updated_at timestamptz,
  idempotent boolean
)
language plpgsql security definer set search_path=public as $$
declare
  v_tenant uuid := vetoros_current_tenant_id();
  v_company uuid; v_branch uuid; v_supplier_id uuid := p_supplier_id; v_supplier_name text; v_supplier_doc text;
  v_po_total numeric; v_existing_id uuid; v_installments_total numeric := 0; v_count int;
  v_ord int; v_elem jsonb; v_amount numeric; v_due date; v_payable_id uuid; v_actor uuid := nullif(current_setting('app.actor_identity_id',true),'')::uuid;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if p_description is null or length(trim(p_description)) = 0 then raise exception 'description required' using errcode='22023'; end if;
  if p_installments is null or jsonb_typeof(p_installments) <> 'array' or jsonb_array_length(p_installments) < 1 then raise exception 'invalid installments' using errcode='22023'; end if;
  v_count := jsonb_array_length(p_installments);

  if p_purchase_order_id is not null then
    if p_supplier_id is not null then raise exception 'supplier is derived from the purchase order' using errcode='22023'; end if;
    select po.company_id,po.branch_id,po.supplier_id,po.total into v_company,v_branch,v_supplier_id,v_po_total
      from purchase_orders po where po.tenant_id=v_tenant and po.id=p_purchase_order_id and po.status='approved' for update;
    if not found then raise exception 'invalid purchase order origin' using errcode='23503'; end if;

    select pay.id into v_existing_id from payables pay where pay.tenant_id=v_tenant and pay.purchase_order_id=p_purchase_order_id and pay.status<>'canceled';
    if v_existing_id is not null then
      return query select p.*, true from payables p where p.id=v_existing_id;
      return;
    end if;
  else
    if p_company_id is null or p_branch_id is null then raise exception 'company and branch required for a manual payable' using errcode='22023'; end if;
    v_company := p_company_id; v_branch := p_branch_id;
  end if;

  if v_supplier_id is not null then
    select s.legal_name, s.document_normalized into v_supplier_name, v_supplier_doc from suppliers s where s.tenant_id=v_tenant and s.id=v_supplier_id;
    if not found then raise exception 'invalid supplier' using errcode='23503'; end if;
  end if;

  for v_ord, v_elem in select ordinality::int, value from jsonb_array_elements(p_installments) with ordinality as t(value, ordinality) order by ordinality loop
    v_amount := round(nullif(v_elem->>'amount','')::numeric,2);
    v_due := nullif(v_elem->>'dueDate','')::date;
    if v_amount is null or v_amount <= 0 or v_due is null then raise exception 'invalid installment' using errcode='22023'; end if;
    v_installments_total := v_installments_total + v_amount;
  end loop;

  if p_purchase_order_id is not null and round(v_po_total - v_installments_total, 2) <> 0 then
    raise exception 'installments do not match purchase order total' using errcode='22023';
  end if;

  insert into payables as pay2 (tenant_id,company_id,branch_id,supplier_id,supplier_name_snapshot,supplier_document_snapshot,purchase_order_id,description,document_number,issue_date,created_by_identity_id,updated_by_identity_id)
    values (v_tenant,v_company,v_branch,v_supplier_id,v_supplier_name,v_supplier_doc,p_purchase_order_id,trim(p_description),nullif(trim(coalesce(p_document_number,'')),''),coalesce(p_issue_date,current_date),v_actor,v_actor)
    returning pay2.id into v_payable_id;

  for v_ord, v_elem in select ordinality::int, value from jsonb_array_elements(p_installments) with ordinality as t(value, ordinality) order by ordinality loop
    insert into payable_installments (tenant_id,company_id,branch_id,payable_id,installment_number,installment_count,original_amount,due_date)
      values (v_tenant,v_company,v_branch,v_payable_id,v_ord,v_count,round(nullif(v_elem->>'amount','')::numeric,2),(v_elem->>'dueDate')::date);
  end loop;

  return query select p.*, false from payables p where p.id=v_payable_id;
end $$;

-- Pagamento de parcela (seção 7). A própria parcela tem linha natural para travar (diferente do
-- `allocate_payment` de FIN-02, que precisava de advisory lock porque `payments` do FIN-01 é
-- append-only sem linha própria mutável) — `for update` na parcela basta para serializar
-- pagamentos e estornos concorrentes contra ela. Idempotência pelo mesmo padrão de
-- `receive_payment` (FIN-01): procura a chave primeiro; parâmetros iguais devolve o que já
-- existe, parâmetros diferentes é conflito.
create function pay_installment(p_installment_id uuid, p_amount numeric, p_paid_at timestamptz, p_payment_method_id uuid, p_notes text, p_idempotency_key text)
returns table(payment_id uuid, installment_id uuid, amount numeric, idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare
  v_tenant uuid := vetoros_current_tenant_id();
  v_installment payable_installments%rowtype; v_payable payables%rowtype;
  v_paid numeric; v_new_payment_id uuid; v_amount numeric := round(p_amount,2);
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if v_amount is null or v_amount <= 0 or length(trim(p_idempotency_key)) < 8 then raise exception 'invalid payment' using errcode='22023'; end if;

  loop
    select id into v_new_payment_id from payable_payments where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
    if found then
      if not exists (select 1 from payable_payments pp where pp.id=v_new_payment_id and pp.payable_installment_id=p_installment_id and pp.amount=v_amount and pp.type='payment') then
        raise exception 'idempotency conflict' using errcode='23505';
      end if;
      return query select pp.id, pp.payable_installment_id, pp.amount, true from payable_payments pp where pp.id=v_new_payment_id;
      return;
    end if;

    select * into v_installment from payable_installments where tenant_id=v_tenant and id=p_installment_id for update;
    if not found then raise exception 'installment not found' using errcode='P0002'; end if;
    select * into v_payable from payables where tenant_id=v_tenant and id=v_installment.payable_id;
    if v_payable.status <> 'active' then raise exception 'payable not active' using errcode='55000'; end if;

    select coalesce(sum(case when pp.type='payment' then pp.amount else -pp.amount end),0) into v_paid
      from payable_payments pp where pp.tenant_id=v_tenant and pp.payable_installment_id=p_installment_id;
    if v_amount > round(v_installment.original_amount - v_paid, 2) then raise exception 'payment exceeds balance' using errcode='23514'; end if;

    begin
      insert into payable_payments (tenant_id,company_id,branch_id,payable_installment_id,type,amount,paid_at,payment_method_id,notes,idempotency_key,created_by_identity_id)
        values (v_tenant,v_installment.company_id,v_installment.branch_id,p_installment_id,'payment',v_amount,coalesce(p_paid_at,now()),p_payment_method_id,p_notes,p_idempotency_key,nullif(current_setting('app.actor_identity_id',true),'')::uuid)
        returning id into v_new_payment_id;
    exception when unique_violation then continue; end;

    return query select v_new_payment_id, p_installment_id, v_amount, false;
    return;
  end loop;
end $$;

-- Estorno (seção 8): nunca DELETE; sempre uma nova linha `type='reversal'`. Trava a PARCELA (não
-- o pagamento — que não tem estado próprio mutável) para serializar contra pagamentos/estornos
-- concorrentes na mesma parcela; a unicidade parcial `payable_payments_reversal_once_uq` garante
-- estruturalmente o "no máximo um estorno por pagamento" mesmo sob concorrência (mesmo padrão de
-- `refund_payment` do FIN-01: um loop com `exception when unique_violation` resolve a corrida de
-- dois estornos simultâneos do mesmo pagamento sem depender só do lock).
create function reverse_payable_payment(p_payment_id uuid, p_reason text)
returns table(reversal_id uuid, payment_id uuid, amount numeric, idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare v_tenant uuid := vetoros_current_tenant_id(); v_payment payable_payments%rowtype; v_reversal_id uuid;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  select * into v_payment from payable_payments where tenant_id=v_tenant and id=p_payment_id and type='payment';
  if not found then raise exception 'payment not found' using errcode='P0002'; end if;

  loop
    select id into v_reversal_id from payable_payments where tenant_id=v_tenant and reverses_payment_id=p_payment_id and type='reversal';
    if found then return query select v_reversal_id, p_payment_id, v_payment.amount, true; return; end if;

    perform 1 from payable_installments where tenant_id=v_tenant and id=v_payment.payable_installment_id for update;

    begin
      insert into payable_payments (tenant_id,company_id,branch_id,payable_installment_id,type,amount,paid_at,reverses_payment_id,notes,created_by_identity_id)
        values (v_tenant,v_payment.company_id,v_payment.branch_id,v_payment.payable_installment_id,'reversal',v_payment.amount,now(),p_payment_id,coalesce(nullif(trim(p_reason),''),'Estorno de pagamento'),nullif(current_setting('app.actor_identity_id',true),'')::uuid)
        returning id into v_reversal_id;
    exception when unique_violation then continue; end;

    return query select v_reversal_id, p_payment_id, v_payment.amount, false;
    return;
  end loop;
end $$;

-- Cancelamento do título (seção 9): bloqueia enquanto existir pagamento ATIVO (não estornado) em
-- qualquer parcela — a preferência explícita do correio.md ("bloquear cancelamento enquanto
-- houver pagamento efetivo não estornado"), nunca um cascade silencioso. Idempotente.
create function cancel_payable(p_payable_id uuid, p_reason text)
returns table(id uuid, status text, idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare v_tenant uuid := vetoros_current_tenant_id(); v_payable payables%rowtype; v_active boolean;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  select * into v_payable from payables pay where pay.tenant_id=v_tenant and pay.id=p_payable_id for update;
  if not found then raise exception 'payable not found' using errcode='P0002'; end if;
  if v_payable.status = 'canceled' then return query select v_payable.id, v_payable.status, true; return; end if;

  select exists (
    select 1 from payable_installments pi
    where pi.tenant_id=v_tenant and pi.payable_id=p_payable_id
      and exists (
        select 1 from payable_payments pp where pp.tenant_id=v_tenant and pp.payable_installment_id=pi.id and pp.type='payment'
          and not exists (select 1 from payable_payments r where r.tenant_id=v_tenant and r.reverses_payment_id=pp.id and r.type='reversal')
      )
  ) into v_active;
  if v_active then raise exception 'payable has active payments' using errcode='23514'; end if;

  update payables pay2 set status='canceled', canceled_at=now(), cancel_reason=coalesce(nullif(trim(p_reason),''),'Cancelamento manual'), updated_at=now() where pay2.id=p_payable_id;
  return query select p_payable_id, 'canceled'::text, false;
end $$;

insert into permissions (code,module,description) values
  ('payables.read','payables','payables.read'), ('payables.create','payables','payables.create'),
  ('payables.update','payables','payables.update'), ('payables.pay','payables','payables.pay'),
  ('payables.cancel','payables','payables.cancel'), ('payables.reverse','payables','payables.reverse')
on conflict (code) do nothing;

-- Mesmo padrão restritivo de `receivables`/`payments` (FIN-01/FIN-02): nenhum INSERT/UPDATE/
-- DELETE direto — toda mutação passa por uma função `security definer`. `PATCH /payables/:id`
-- (campos administrativos: descrição/documento/observação) é a única exceção que precisa de
-- UPDATE direto — concedido de forma restrita (só essas colunas são de fato alteráveis pela API,
-- reforçado na camada HTTP, já que Postgres não tem GRANT por coluna combinável com RLS de forma
-- prática aqui, mesmo padrão de `cash_registers`, que também recebe UPDATE direto para campos
-- simples).
grant select on payables, payable_installments, payable_payments to vetoros_runtime;
grant update (description, document_number, updated_by_identity_id, updated_at) on payables to vetoros_runtime;
grant execute on function create_payable(uuid,uuid,uuid,uuid,text,text,date,jsonb) to vetoros_runtime;
grant execute on function pay_installment(uuid,numeric,timestamptz,uuid,text,text) to vetoros_runtime;
grant execute on function reverse_payable_payment(uuid,text) to vetoros_runtime;
grant execute on function cancel_payable(uuid,text) to vetoros_runtime;
