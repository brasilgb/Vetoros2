-- Habilita FK composta que garante, no banco, que um item de recebimento só pode
-- referenciar um item de pedido pertencente ao MESMO pedido do seu recebimento
-- (ver seção 6/15/24-item-7 do COM-03). Mesmo padrão já usado em customer_assets (CRM-02/CRM-03).
alter table purchase_order_items add constraint purchase_order_items_tenant_order_id_uq unique(tenant_id,purchase_order_id,id);

create table purchase_receipt_number_counters(tenant_id uuid primary key references tenants(id),last_number bigint not null default 0 check(last_number>=0),updated_at timestamptz not null default now());

create table purchase_receipts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,company_id uuid not null,branch_id uuid not null,
 purchase_order_id uuid not null,receipt_number bigint not null,status text not null default 'draft',
 received_at date not null default current_date,notes text,
 created_by_identity_id uuid references identities(id),updated_by_identity_id uuid references identities(id),
 confirmed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),unique(tenant_id,receipt_number),unique(tenant_id,id,purchase_order_id),
 check(status in('draft','confirmed','cancelled')),
 foreign key(tenant_id,company_id) references companies(tenant_id,id),
 foreign key(tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
 foreign key(tenant_id,purchase_order_id) references purchase_orders(tenant_id,id)
);

create table purchase_receipt_items(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,purchase_receipt_id uuid not null,purchase_order_id uuid not null,
 purchase_order_item_id uuid not null,inventory_part_id uuid not null,description text not null,quantity numeric(14,3) not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),
 foreign key(tenant_id,purchase_receipt_id,purchase_order_id) references purchase_receipts(tenant_id,id,purchase_order_id) on delete cascade,
 foreign key(tenant_id,purchase_order_id,purchase_order_item_id) references purchase_order_items(tenant_id,purchase_order_id,id),
 foreign key(tenant_id,inventory_part_id) references inventory_parts(tenant_id,id),
 check(quantity>0)
);

create index purchase_receipts_order_idx on purchase_receipts(tenant_id,purchase_order_id);
create index purchase_receipts_list_idx on purchase_receipts(tenant_id,created_at desc);
create index purchase_receipts_status_idx on purchase_receipts(tenant_id,status);
create index purchase_receipt_items_receipt_idx on purchase_receipt_items(tenant_id,purchase_receipt_id);
create index purchase_receipt_items_order_item_idx on purchase_receipt_items(tenant_id,purchase_order_item_id);

alter table purchase_receipt_number_counters enable row level security;alter table purchase_receipt_number_counters force row level security;
create policy purchase_receipt_number_counters_tenant on purchase_receipt_number_counters using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());
alter table purchase_receipts enable row level security;alter table purchase_receipts force row level security;
create policy purchase_receipts_tenant on purchase_receipts using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());
alter table purchase_receipt_items enable row level security;alter table purchase_receipt_items force row level security;
create policy purchase_receipt_items_tenant on purchase_receipt_items using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());

-- Origem opcional e same-tenant do recebimento no ledger de estoque (mesmo padrão de
-- extensão usado por EST-02 ao acrescentar service_order_id/service_order_item_id).
alter table stock_movements add column purchase_receipt_id uuid,add column purchase_receipt_item_id uuid;
alter table stock_movements add foreign key(tenant_id,purchase_receipt_id) references purchase_receipts(tenant_id,id),add foreign key(tenant_id,purchase_receipt_item_id) references purchase_receipt_items(tenant_id,id);

-- Reaproveita a função de EST-01 (mesmo ledger, mesma projeção de saldo), apenas
-- acrescentando parâmetros opcionais de origem ao final (compatível com as chamadas
-- existentes de /inventory/movements, que continuam passando só os 6 primeiros argumentos).
-- `create or replace` não troca a assinatura in-place quando se adicionam parâmetros
-- novos (o Postgres cria uma segunda função sobrecarregada em vez de substituir) — por
-- isso a antiga é removida explicitamente antes de recriar com a assinatura definitiva.
drop function if exists record_stock_movement(uuid,uuid,uuid,text,numeric,text);
create function record_stock_movement(p_company_id uuid,p_branch_id uuid,p_part_id uuid,p_type text,p_quantity numeric,p_reason text,p_purchase_receipt_id uuid default null,p_purchase_receipt_item_id uuid default null)
returns table(movement_id uuid,resulting_balance numeric) language plpgsql security definer set search_path=public as $$
declare v_tenant uuid:=vetoros_current_tenant_id(); v_delta numeric; v_balance numeric; v_id uuid;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if p_type not in ('entry','exit','adjustment_in','adjustment_out') or p_quantity<=0 or length(trim(p_reason))=0 then raise exception 'invalid movement' using errcode='22023'; end if;
  if not exists(select 1 from branches where tenant_id=v_tenant and company_id=p_company_id and id=p_branch_id and status='active') then raise exception 'invalid branch' using errcode='23503'; end if;
  if not exists(select 1 from inventory_parts where tenant_id=v_tenant and id=p_part_id and status='active') then raise exception 'invalid part' using errcode='23503'; end if;
  insert into stock_balances(tenant_id,company_id,branch_id,part_id,quantity) values(v_tenant,p_company_id,p_branch_id,p_part_id,0) on conflict(tenant_id,branch_id,part_id) do nothing;
  select quantity into v_balance from stock_balances where tenant_id=v_tenant and branch_id=p_branch_id and part_id=p_part_id for update;
  v_delta:=case when p_type in ('entry','adjustment_in') then p_quantity else -p_quantity end;
  if v_balance+v_delta<0 then raise exception 'insufficient stock' using errcode='23514'; end if;
  v_balance:=v_balance+v_delta;
  update stock_balances set quantity=v_balance,updated_at=now() where tenant_id=v_tenant and branch_id=p_branch_id and part_id=p_part_id;
  insert into stock_movements(tenant_id,company_id,branch_id,part_id,type,quantity,resulting_balance,reason,actor_identity_id,purchase_receipt_id,purchase_receipt_item_id)
    values(v_tenant,p_company_id,p_branch_id,p_part_id,p_type,p_quantity,v_balance,p_reason,nullif(current_setting('app.actor_identity_id',true),'')::uuid,p_purchase_receipt_id,p_purchase_receipt_item_id) returning id into v_id;
  return query select v_id,v_balance;
end $$;

-- Confirmação atômica (seção 8/9/10 do COM-03): trava as linhas de purchase_order_items
-- envolvidas (em ordem estável de id, para evitar deadlock entre confirmações concorrentes
-- que toquem itens sobrepostos), recalcula a quantidade já confirmada de cada item DEPOIS
-- de obter a trava, e só então valida e grava. Isso serializa confirmações concorrentes do
-- mesmo item: a segunda só enxerga o efeito da primeira após ela commitar, então nunca é
-- possível ultrapassar a quantidade pedida mesmo sob concorrência. Reconfirmar um recebimento
-- já confirmado é idempotente (retorna o estado atual, sem gerar novo estoque).
-- Nomes de saída prefixados (receipt_id/receipt_status, não id/status) de propósito: evitam
-- colidir com as colunas homônimas de purchase_receipts/purchase_orders referenciadas dentro
-- da função (mesma convenção já usada por service_order_stock_action em EST-02).
create function confirm_purchase_receipt(p_receipt_id uuid) returns table(receipt_id uuid,receipt_status text,confirmed_at timestamptz,idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare
 v_tenant uuid:=vetoros_current_tenant_id();
 v_receipt purchase_receipts%rowtype;
 v_order purchase_orders%rowtype;
 v_row record;
 v_received numeric;
begin
 if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
 select * into v_receipt from purchase_receipts where tenant_id=v_tenant and id=p_receipt_id for update;
 if not found then raise exception 'receipt not found' using errcode='P0002'; end if;
 if v_receipt.status='confirmed' then return query select v_receipt.id,v_receipt.status,v_receipt.confirmed_at,true::boolean; return; end if;
 if v_receipt.status='cancelled' then raise exception 'receipt is cancelled' using errcode='55000'; end if;
 select * into v_order from purchase_orders where tenant_id=v_tenant and id=v_receipt.purchase_order_id for update;
 if not found then raise exception 'purchase order not found' using errcode='P0002'; end if;
 if v_order.status<>'approved' then raise exception 'purchase order not approved' using errcode='55000'; end if;
 if not exists(select 1 from purchase_receipt_items where tenant_id=v_tenant and purchase_receipt_id=p_receipt_id) then raise exception 'receipt has no items' using errcode='22023'; end if;
 perform 1 from purchase_order_items where tenant_id=v_tenant and id in (select purchase_order_item_id from purchase_receipt_items where tenant_id=v_tenant and purchase_receipt_id=p_receipt_id) order by id for update;
 for v_row in select ri.id receipt_item_id,ri.quantity this_quantity,ri.inventory_part_id,oi.id order_item_id,oi.quantity ordered_quantity from purchase_receipt_items ri join purchase_order_items oi on oi.id=ri.purchase_order_item_id where ri.tenant_id=v_tenant and ri.purchase_receipt_id=p_receipt_id
 loop
  select coalesce(sum(pri.quantity),0) into v_received from purchase_receipt_items pri join purchase_receipts pr on pr.id=pri.purchase_receipt_id where pri.tenant_id=v_tenant and pri.purchase_order_item_id=v_row.order_item_id and pr.status='confirmed';
  if v_received+v_row.this_quantity>v_row.ordered_quantity then raise exception 'received quantity would exceed ordered quantity' using errcode='23514'; end if;
 end loop;
 update purchase_receipts set status='confirmed',confirmed_at=now(),updated_at=now() where tenant_id=v_tenant and id=p_receipt_id;
 for v_row in select ri.id receipt_item_id,ri.quantity this_quantity,ri.inventory_part_id from purchase_receipt_items ri where ri.tenant_id=v_tenant and ri.purchase_receipt_id=p_receipt_id
 loop
  perform record_stock_movement(v_order.company_id,v_order.branch_id,v_row.inventory_part_id,'entry',v_row.this_quantity,'Recebimento de compra #'||v_receipt.receipt_number,p_receipt_id,v_row.receipt_item_id);
 end loop;
 return query select p_receipt_id,'confirmed'::text,now(),false::boolean;
end $$;

grant select,insert,update on purchase_receipt_number_counters,purchase_receipts to vetoros_runtime;
grant select,insert,update,delete on purchase_receipt_items to vetoros_runtime;
grant execute on function record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid,uuid) to vetoros_runtime;
grant execute on function confirm_purchase_receipt(uuid) to vetoros_runtime;
