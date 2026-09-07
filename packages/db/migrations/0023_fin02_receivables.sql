-- FIN-02: Contas a Receber. Ver executed.md "Descoberta"/"Decisões arquiteturais". Continua
-- diretamente o FIN-01 (migration 0022): aquele resolveu "dinheiro que já entrou" (payments);
-- este resolve "dívida que ainda vai vencer" (receivables) e como as duas coisas se encontram
-- (alocação).

-- ---- Descoberta (seção 1 do correio.md) ----
-- 1. Uma venda confirmada não tem `total` persistido: é sum(sale_items.total), coluna gerada por
--    item (migration 0016). Sem status financeiro nenhum na própria linha de `sales`.
-- 2. Uma OS também não tem total persistido: é sum(service_order_items.total_amount), mesma
--    técnica (migration 0008). `service_orders.status` é workflow (open/in_progress/completed/
--    canceled), não financeiro.
-- 3. Origens inequívocas hoje: venda `confirmed` e OS `status<>'canceled'` — EXATAMENTE as duas
--    validações que `receive_payment` (migration 0022) já usa para aceitar `sale_id`/
--    `service_order_id`. Orçamento (quotes) não é origem (não vira obrigação sozinho).
-- 4. FIN-01 já deixa calcular "quanto foi recebido de uma origem": `sum(payments.amount) where
--    (sale_id=X or service_order_id=X) and não estornado` (o mesmo predicado que
--    `payments_sale_idx`/`payments_service_order_idx` já indexam).
-- 5/6/7. Não existe vencimento, parcelamento nem status financeiro persistido em nenhum lugar —
--    tudo novo nesta migration.
-- 8. Cancelamento já bloqueia origem com recebimento ativo: `sales.ts` (`sale_has_active_payments`)
--    e `service-orders.ts` (`service_order_has_active_payments`) já verificam
--    `not exists (... cash_movements type='refund')` antes de cancelar. Esta migration estende
--    os DOIS pontos (mesmos arquivos) com o equivalente para títulos — ver comentário na seção 11.
-- 9. Estornos: `cash_movements.type='refund'` já existe e nunca edita o `payment` original — o
--    saldo de um título só pode ser calculado excluindo alocações cujo pagamento tenha sido
--    estornado (nenhuma edição/exclusão na própria alocação: mesma filosofia append-only).
-- 10. Mais de uma obrigação para a mesma origem: fora de escopo nesta rodada — `generate_receivables`
--    é chamada uma única vez por origem (idempotente: uma segunda chamada devolve os títulos já
--    gerados em vez de duplicar — seção 12).
-- 11/12/13/14/15. Ver comentários junto a cada função abaixo.

-- ---- Separação conceitual (seção 2): `receivables` é OBRIGAÇÃO, nunca um PAGAMENTO. Uma linha
-- de `receivables` é, na prática, uma PARCELA (o próprio correio.md, seção 5, já fala de
-- "vencimentos independentes" por parcela — não existe uma entidade "título" separada da
-- "parcela"; título=parcela aqui, cada linha com seu próprio vencimento e saldo, agrupadas pela
-- MESMA origem + `installment_number`/`installment_count` para exibição do parcelamento completo).
-- Diferente de `payments`, aqui SEMPRE existe origem: não existe "conta a receber avulsa" (seção
-- 4 só reconhece venda/OS como origem inequívoca) — por isso o CHECK abaixo exige EXATAMENTE uma
-- origem, não "no máximo uma" como em `payments`.
create table receivables (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, company_id uuid not null, branch_id uuid not null,
  customer_id uuid not null, sale_id uuid, service_order_id uuid,
  installment_number int not null check (installment_number >= 1), installment_count int not null check (installment_count >= 1),
  original_amount numeric(14,2) not null check (original_amount > 0), due_date date not null,
  status text not null default 'active' check (status in ('active','canceled')),
  canceled_at timestamptz, cancel_reason text,
  created_by_identity_id uuid references identities(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,sale_id,installment_number), unique (tenant_id,service_order_id,installment_number),
  foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
  foreign key (tenant_id,customer_id) references customers(tenant_id,id),
  foreign key (tenant_id,sale_id) references sales(tenant_id,id),
  foreign key (tenant_id,service_order_id) references service_orders(tenant_id,id),
  check ((sale_id is not null)::int + (service_order_id is not null)::int = 1),
  check (installment_number <= installment_count),
  check ((status='active' and canceled_at is null) or (status='canceled' and canceled_at is not null))
);
create index receivables_list_idx on receivables(tenant_id,branch_id,due_date);
create index receivables_customer_idx on receivables(tenant_id,customer_id);
create index receivables_sale_idx on receivables(tenant_id,sale_id) where sale_id is not null;
create index receivables_service_order_idx on receivables(tenant_id,service_order_id) where service_order_id is not null;

-- ---- Alocação (seção 8/9): tabela dedicada em vez de um FK direto `payments.receivable_id`,
-- porque a arquitetura exigida ("um pagamento cobrindo várias parcelas", "múltiplos pagamentos
-- sobre a mesma parcela", "pagamento parcial de uma parcela") é genuinamente muitos-para-muitos —
-- um FK único em `payments` só suportaria um pagamento -> uma parcela. Append-only, como
-- `cash_movements`/`payments`: nunca editada; um estorno do pagamento original invalida a
-- alocação por EXCLUSÃO na consulta (`not exists (...type='refund')`), nunca apagando/editando a
-- linha aqui — mesmo princípio da seção 7 ("saldo determinístico, nunca mutável"). `idempotency_key`
-- pelo mesmo motivo de `payments.idempotency_key`: proteção estrutural contra duplo-clique/retry
-- (seção 12), não apenas checagem de aplicação.
create table receivable_allocations (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, company_id uuid not null, branch_id uuid not null,
  receivable_id uuid not null, payment_id uuid not null, amount numeric(14,2) not null check (amount > 0),
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  created_by_identity_id uuid references identities(id), created_at timestamptz not null default now(),
  unique (tenant_id,id), unique (tenant_id,idempotency_key),
  foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
  foreign key (tenant_id,receivable_id) references receivables(tenant_id,id),
  foreign key (tenant_id,payment_id) references payments(tenant_id,id)
);
create index receivable_allocations_receivable_idx on receivable_allocations(tenant_id,receivable_id);
create index receivable_allocations_payment_idx on receivable_allocations(tenant_id,payment_id);

alter table receivables enable row level security; alter table receivables force row level security;
create policy receivables_tenant on receivables using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());
alter table receivable_allocations enable row level security; alter table receivable_allocations force row level security;
create policy receivable_allocations_tenant on receivable_allocations using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());

create function reject_receivable_allocation_mutation() returns trigger language plpgsql as $$ begin raise exception 'receivable_allocations is append-only'; end $$;
create trigger receivable_allocations_append_only before update or delete on receivable_allocations for each row execute function reject_receivable_allocation_mutation();

-- Geração de parcelas (seção 5/6/12). Diferente de `receive_payment`/`refund_payment` (que
-- travam uma linha SEM alternativa e por isso precisam do padrão loop+`exception when
-- unique_violation`), aqui a própria origem (`sales`/`service_orders`) É a linha natural a travar
-- — travando-a ANTES de checar se já existe geração, uma segunda chamada concorrente fica
-- bloqueada até a primeira comitar e, ao prosseguir, enxerga (READ COMMITTED) as linhas recém
-- comitadas na checagem de idempotência — sem nenhuma janela de corrida, sem precisar do loop.
-- `p_installments` é um array jsonb `[{"amount":400.00,"dueDate":"2026-10-01"}, ...]`, na ordem
-- em que as parcelas devem ser numeradas (`installment_number`=posição). A soma das parcelas
-- MAIS o que já foi recebido diretamente para a origem (seção 6: "entrada/sinal") precisa fechar
-- EXATAMENTE com o total da origem — não duplica o valor da entrada como dívida (seção 6) e não
-- infere entrada nenhuma além do que `payments` já registrou de fato.
create function generate_receivables(p_sale_id uuid, p_service_order_id uuid, p_installments jsonb)
returns table(
  id uuid, tenant_id uuid, company_id uuid, branch_id uuid, customer_id uuid, sale_id uuid, service_order_id uuid,
  installment_number int, installment_count int, original_amount numeric, due_date date, status text,
  canceled_at timestamptz, cancel_reason text, created_by_identity_id uuid, created_at timestamptz, updated_at timestamptz,
  idempotent boolean
)
language plpgsql security definer set search_path=public as $$
declare
  v_tenant uuid := vetoros_current_tenant_id();
  v_company uuid; v_branch uuid; v_customer uuid;
  v_origin_total numeric; v_received numeric; v_installments_total numeric := 0;
  v_count int; v_existing int; v_ord int; v_elem jsonb; v_amount numeric; v_due date;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if (p_sale_id is not null)::int + (p_service_order_id is not null)::int <> 1 then raise exception 'exactly one origin required' using errcode='22023'; end if;
  if p_installments is null or jsonb_typeof(p_installments) <> 'array' or jsonb_array_length(p_installments) < 1 then raise exception 'invalid installments' using errcode='22023'; end if;
  v_count := jsonb_array_length(p_installments);

  if p_sale_id is not null then
    select s.company_id,s.branch_id,s.customer_id into v_company,v_branch,v_customer from sales s where s.tenant_id=v_tenant and s.id=p_sale_id and s.status='confirmed' for update;
    if not found then raise exception 'invalid sale origin' using errcode='23503'; end if;
    select coalesce(sum(si.total),0) into v_origin_total from sale_items si where si.tenant_id=v_tenant and si.sale_id=p_sale_id;
  else
    select o.company_id,o.branch_id,o.customer_id into v_company,v_branch,v_customer from service_orders o where o.tenant_id=v_tenant and o.id=p_service_order_id and o.status<>'canceled' for update;
    if not found then raise exception 'invalid service order origin' using errcode='23503'; end if;
    select coalesce(sum(oi.total_amount),0) into v_origin_total from service_order_items oi where oi.tenant_id=v_tenant and oi.service_order_id=p_service_order_id;
  end if;

  -- Idempotência (seção 10/12): já existe geração para esta origem? A origem já está travada
  -- acima, então isto é uma leitura consistente. Uma segunda chamada com os MESMOS parâmetros
  -- (retry) devolve o que já existe, sem criar nada novo; com parâmetros DIFERENTES é conflito —
  -- mesmo padrão de `receive_payment` (migration 0022): nunca "sucesso silencioso" sobre um
  -- reaproveitamento incompatível.
  select count(*) into v_existing from receivables r where r.tenant_id=v_tenant and ((p_sale_id is not null and r.sale_id=p_sale_id) or (p_service_order_id is not null and r.service_order_id=p_service_order_id));
  if v_existing > 0 then
    if v_existing <> v_count or exists (
      select 1 from receivables r
      join lateral (select ordinality::int as ord, round(nullif(value->>'amount','')::numeric,2) as amt, nullif(value->>'dueDate','')::date as due from jsonb_array_elements(p_installments) with ordinality as t(value, ordinality)) n on n.ord = r.installment_number
      where r.tenant_id=v_tenant and ((p_sale_id is not null and r.sale_id=p_sale_id) or (p_service_order_id is not null and r.service_order_id=p_service_order_id))
        and (n.amt is distinct from r.original_amount or n.due is distinct from r.due_date)
    ) then raise exception 'idempotency conflict' using errcode='23505'; end if;
    return query select r.*, true from receivables r where r.tenant_id=v_tenant and ((p_sale_id is not null and r.sale_id=p_sale_id) or (p_service_order_id is not null and r.service_order_id=p_service_order_id)) order by r.installment_number;
    return;
  end if;

  for v_ord, v_elem in select ordinality::int, value from jsonb_array_elements(p_installments) with ordinality as t(value, ordinality) order by ordinality loop
    v_amount := round(nullif(v_elem->>'amount','')::numeric,2);
    v_due := nullif(v_elem->>'dueDate','')::date;
    if v_amount is null or v_amount <= 0 or v_due is null then raise exception 'invalid installment' using errcode='22023'; end if;
    v_installments_total := v_installments_total + v_amount;
  end loop;

  select coalesce(sum(p.amount),0) into v_received from payments p
    where p.tenant_id=v_tenant and ((p_sale_id is not null and p.sale_id=p_sale_id) or (p_service_order_id is not null and p.service_order_id=p_service_order_id))
      and not exists (select 1 from cash_movements cm where cm.tenant_id=v_tenant and cm.payment_id=p.id and cm.type='refund');
  if round(v_origin_total - v_received - v_installments_total, 2) <> 0 then raise exception 'installments do not match remaining balance' using errcode='22023'; end if;

  for v_ord, v_elem in select ordinality::int, value from jsonb_array_elements(p_installments) with ordinality as t(value, ordinality) order by ordinality loop
    insert into receivables (tenant_id,company_id,branch_id,customer_id,sale_id,service_order_id,installment_number,installment_count,original_amount,due_date,created_by_identity_id)
      values (v_tenant,v_company,v_branch,v_customer,p_sale_id,p_service_order_id,v_ord,v_count,round(nullif(v_elem->>'amount','')::numeric,2),(v_elem->>'dueDate')::date,nullif(current_setting('app.actor_identity_id',true),'')::uuid);
  end loop;

  return query select r.*, false from receivables r where r.tenant_id=v_tenant and ((p_sale_id is not null and r.sale_id=p_sale_id) or (p_service_order_id is not null and r.service_order_id=p_service_order_id)) order by r.installment_number;
end $$;

-- Alocação de pagamento a parcela (seção 8/9). Nunca infere apropriação por coincidência de valor
-- (seção 8): é sempre uma chamada explícita apontando pagamento+parcela+valor. `payments` não tem
-- linha própria travável sem grant de UPDATE (mesmo problema que `refund_payment` já resolveu) —
-- por isso o mesmo remédio: `pg_advisory_xact_lock` pelo id do pagamento. A parcela, por outro
-- lado, tem linha própria e É travada com `for update` — ordem fixa (pagamento primeiro, parcela
-- depois) em toda chamada desta função evita deadlock entre alocações concorrentes que
-- compartilhem pagamento OU parcela.
-- Nota: `returns table(allocation_id uuid, ...)` (nunca `id uuid`, de propósito) — mesmo problema
-- documentado em `receive_payment` (migration 0022): os parâmetros OUT implícitos do plpgsql
-- viram identificadores visíveis dentro de TODA a função, e uma referência SEM ALIAS a uma coluna
-- de mesmo nome em `payments`/`receivables` (ambas têm `id`) vira "column reference is ambiguous"
-- em tempo de EXECUÇÃO (não é pego na criação da função) — erro real encontrado testando esta
-- função. Nomear o OUT param `allocation_id` em vez de `id` já evita a colisão mais óbvia; toda
-- consulta a `payments`/`receivables` aqui também usa alias por precaução, mesmo onde o nome do
-- OUT param sozinho não causaria o problema.
create function allocate_payment(p_payment_id uuid, p_receivable_id uuid, p_amount numeric, p_idempotency_key text)
returns table(allocation_id uuid, receivable_id uuid, payment_id uuid, amount numeric, idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare
  v_tenant uuid := vetoros_current_tenant_id();
  v_payment payments%rowtype; v_receivable receivables%rowtype;
  v_alloc_id uuid; v_payment_allocated numeric; v_receivable_paid numeric; v_amount numeric := round(p_amount,2);
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if v_amount is null or v_amount <= 0 or length(trim(p_idempotency_key)) < 8 then raise exception 'invalid allocation' using errcode='22023'; end if;

  loop
    select ra.id into v_alloc_id from receivable_allocations ra where ra.tenant_id=v_tenant and ra.idempotency_key=p_idempotency_key;
    if found then
      if not exists (select 1 from receivable_allocations ra where ra.id=v_alloc_id and ra.receivable_id=p_receivable_id and ra.payment_id=p_payment_id and ra.amount=v_amount) then
        raise exception 'idempotency conflict' using errcode='23505';
      end if;
      return query select ra.id, ra.receivable_id, ra.payment_id, ra.amount, true from receivable_allocations ra where ra.id=v_alloc_id;
      return;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_payment_id::text, 102));

    select * into v_payment from payments pay where pay.tenant_id=v_tenant and pay.id=p_payment_id;
    if not found then raise exception 'payment not found' using errcode='P0002'; end if;
    if exists (select 1 from cash_movements cm where cm.tenant_id=v_tenant and cm.payment_id=p_payment_id and cm.type='refund') then
      raise exception 'payment already refunded' using errcode='55000';
    end if;

    select * into v_receivable from receivables rec where rec.tenant_id=v_tenant and rec.id=p_receivable_id for update;
    if not found then raise exception 'receivable not found' using errcode='P0002'; end if;
    if v_receivable.status <> 'active' then raise exception 'receivable not active' using errcode='55000'; end if;
    if not ((v_payment.sale_id is not null and v_payment.sale_id=v_receivable.sale_id) or (v_payment.service_order_id is not null and v_payment.service_order_id=v_receivable.service_order_id)) then
      raise exception 'payment origin does not match receivable origin' using errcode='23503';
    end if;

    select coalesce(sum(ra.amount),0) into v_payment_allocated from receivable_allocations ra where ra.tenant_id=v_tenant and ra.payment_id=p_payment_id;
    if v_amount > round(v_payment.amount - v_payment_allocated, 2) then raise exception 'insufficient payment capacity' using errcode='23514'; end if;

    select coalesce(sum(ra.amount),0) into v_receivable_paid from receivable_allocations ra
      where ra.tenant_id=v_tenant and ra.receivable_id=p_receivable_id
        and not exists (select 1 from cash_movements cm where cm.tenant_id=v_tenant and cm.payment_id=ra.payment_id and cm.type='refund');
    if v_amount > round(v_receivable.original_amount - v_receivable_paid, 2) then raise exception 'insufficient receivable balance' using errcode='23514'; end if;

    begin
      insert into receivable_allocations as ra2 (tenant_id,company_id,branch_id,receivable_id,payment_id,amount,idempotency_key,created_by_identity_id)
        values (v_tenant,v_receivable.company_id,v_receivable.branch_id,p_receivable_id,p_payment_id,v_amount,p_idempotency_key,nullif(current_setting('app.actor_identity_id',true),'')::uuid)
        returning ra2.id into v_alloc_id;
    exception when unique_violation then continue; end;

    return query select v_alloc_id, p_receivable_id, p_payment_id, v_amount, false;
    return;
  end loop;
end $$;

-- Cancelamento manual de um título (seção 11), pela tela de detalhe. Só permitido enquanto o
-- título não tiver nenhuma alocação ativa (não estornada) — dinheiro já apropriado a uma parcela
-- não pode "sumir" com um cancelamento; precisa de estorno explícito primeiro (mesmo princípio já
-- aplicado ao cancelamento de venda/OS com pagamento ativo).
-- Mesmo cuidado de `allocate_payment` acima: OUT param `receivable_id` (nunca `id`), e a linha
-- que travava `receivables` sem alias — a mesma classe de erro, encontrada no mesmo teste.
create function cancel_receivable(p_receivable_id uuid, p_reason text)
returns table(receivable_id uuid, status text, idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare v_tenant uuid := vetoros_current_tenant_id(); v_receivable receivables%rowtype; v_paid numeric;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  select * into v_receivable from receivables rec where rec.tenant_id=v_tenant and rec.id=p_receivable_id for update;
  if not found then raise exception 'receivable not found' using errcode='P0002'; end if;
  if v_receivable.status = 'canceled' then return query select v_receivable.id, v_receivable.status, true; return; end if;
  select coalesce(sum(ra.amount),0) into v_paid from receivable_allocations ra
    where ra.tenant_id=v_tenant and ra.receivable_id=p_receivable_id
      and not exists (select 1 from cash_movements cm where cm.tenant_id=v_tenant and cm.payment_id=ra.payment_id and cm.type='refund');
  if v_paid > 0 then raise exception 'receivable has active allocations' using errcode='23514'; end if;
  update receivables rec2 set status='canceled', canceled_at=now(), cancel_reason=coalesce(nullif(trim(p_reason),''),'Cancelamento manual'), updated_at=now() where rec2.id=p_receivable_id;
  return query select p_receivable_id, 'canceled'::text, false;
end $$;

-- Cancelamento em cascata quando a ORIGEM é cancelada (seção 11: "uma venda/OS cancelada não pode
-- deixar dívida ativa incoerente"). Chamada de dentro da MESMA transação de
-- POST /sales/:id/cancel e PATCH /service-orders/:id (status=canceled) — que já travam a linha da
-- origem com `for update` antes de chegar aqui, então esta função não precisa (nem tenta) travar
-- nada por conta própria; ela só enxerga um estado já serializado pelo chamador. Bloqueia
-- (`blocked=true`, nada é alterado) se existir título com alocação ativa — dinheiro já recebido
-- para uma parcela não desaparece por trás de um cancelamento de venda/OS, precisa de estorno
-- explícito primeiro, mesmo padrão de `sale_has_active_payments`/`service_order_has_active_payments`.
-- Títulos em aberto (sem nenhuma alocação ativa) são cancelados automaticamente, com
-- rastreabilidade (`cancel_reason`), nunca apagados.
create function cancel_receivables_for_origin(p_sale_id uuid, p_service_order_id uuid, p_reason text)
returns table(blocked boolean, canceled_ids uuid[])
language plpgsql security definer set search_path=public as $$
declare v_tenant uuid := vetoros_current_tenant_id(); v_blocked boolean; v_ids uuid[];
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if (p_sale_id is not null)::int + (p_service_order_id is not null)::int <> 1 then raise exception 'exactly one origin required' using errcode='22023'; end if;

  select exists (
    select 1 from receivables r
    where r.tenant_id=v_tenant and r.status='active'
      and ((p_sale_id is not null and r.sale_id=p_sale_id) or (p_service_order_id is not null and r.service_order_id=p_service_order_id))
      and exists (
        select 1 from receivable_allocations ra where ra.receivable_id=r.id
          and not exists (select 1 from cash_movements cm where cm.payment_id=ra.payment_id and cm.type='refund')
      )
  ) into v_blocked;
  if v_blocked then return query select true, null::uuid[]; return; end if;

  with updated as (
    update receivables set status='canceled', canceled_at=now(), cancel_reason=coalesce(nullif(trim(p_reason),''),'Origem cancelada'), updated_at=now()
      where tenant_id=v_tenant and status='active'
        and ((p_sale_id is not null and sale_id=p_sale_id) or (p_service_order_id is not null and service_order_id=p_service_order_id))
      returning id
  )
  select array_agg(id) into v_ids from updated;
  return query select false, coalesce(v_ids, array[]::uuid[]);
end $$;

insert into permissions (code,module,description) values
  ('receivables.read','receivables','receivables.read'), ('receivables.create','receivables','receivables.create'),
  ('receivables.cancel','receivables','receivables.cancel'), ('receivables.allocate','receivables','receivables.allocate')
on conflict (code) do nothing;

-- Mesmo padrão restritivo de `payments`/`cash_movements` (mais estrito ainda que
-- `cash_registers`, que é config simples): nenhum INSERT/UPDATE/DELETE direto — toda mutação
-- passa por uma função `security definer`, inclusive o cancelamento (que MUDA status, ao
-- contrário de `payments`, que nunca muda) — porque cancelar tem uma invariante (seção 11: "não
-- pode ter alocação ativa") que não pode ficar só a cargo da aplicação.
grant select on receivables, receivable_allocations to vetoros_runtime;
grant execute on function generate_receivables(uuid,uuid,jsonb) to vetoros_runtime;
grant execute on function allocate_payment(uuid,uuid,numeric,text) to vetoros_runtime;
grant execute on function cancel_receivable(uuid,text) to vetoros_runtime;
grant execute on function cancel_receivables_for_origin(uuid,uuid,text) to vetoros_runtime;
