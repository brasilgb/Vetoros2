-- Constraints únicas auxiliares (backward-compatible: `id` já é único por tenant, então
-- qualquer par que o inclua é trivialmente satisfeito por linhas existentes) que habilitam
-- as FKs compostas abaixo, garantindo no banco — não só na API — que:
--   (a) o item de devolução só pode referenciar item de recebimento do MESMO recebimento
--       da sua devolução (mesma técnica já usada em purchase_order_items no COM-03);
--   (b) a peça do item devolvido corresponde estruturalmente à peça do item recebido.
alter table purchase_receipt_items add constraint purchase_receipt_items_tenant_receipt_id_uq unique(tenant_id,purchase_receipt_id,id);
alter table purchase_receipt_items add constraint purchase_receipt_items_tenant_id_part_uq unique(tenant_id,id,inventory_part_id);

create table purchase_return_number_counters(tenant_id uuid primary key references tenants(id),last_number bigint not null default 0 check(last_number>=0),updated_at timestamptz not null default now());

create table purchase_returns(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,company_id uuid not null,branch_id uuid not null,
 purchase_receipt_id uuid not null,return_number bigint not null,status text not null default 'draft',
 returned_at date not null default current_date,reason text,notes text,
 created_by_identity_id uuid references identities(id),updated_by_identity_id uuid references identities(id),
 confirmed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),unique(tenant_id,return_number),unique(tenant_id,id,purchase_receipt_id),
 check(status in('draft','confirmed','cancelled')),
 foreign key(tenant_id,company_id) references companies(tenant_id,id),
 foreign key(tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
 foreign key(tenant_id,purchase_receipt_id) references purchase_receipts(tenant_id,id)
);

create table purchase_return_items(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,purchase_return_id uuid not null,purchase_receipt_id uuid not null,
 purchase_receipt_item_id uuid not null,inventory_part_id uuid not null,description text not null,quantity numeric(14,3) not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),
 foreign key(tenant_id,purchase_return_id,purchase_receipt_id) references purchase_returns(tenant_id,id,purchase_receipt_id) on delete cascade,
 foreign key(tenant_id,purchase_receipt_id,purchase_receipt_item_id) references purchase_receipt_items(tenant_id,purchase_receipt_id,id),
 foreign key(tenant_id,purchase_receipt_item_id,inventory_part_id) references purchase_receipt_items(tenant_id,id,inventory_part_id),
 foreign key(tenant_id,inventory_part_id) references inventory_parts(tenant_id,id),
 check(quantity>0)
);

create index purchase_returns_receipt_idx on purchase_returns(tenant_id,purchase_receipt_id);
create index purchase_returns_list_idx on purchase_returns(tenant_id,created_at desc);
create index purchase_returns_status_idx on purchase_returns(tenant_id,status);
create index purchase_return_items_return_idx on purchase_return_items(tenant_id,purchase_return_id);
create index purchase_return_items_receipt_item_idx on purchase_return_items(tenant_id,purchase_receipt_item_id);

alter table purchase_return_number_counters enable row level security;alter table purchase_return_number_counters force row level security;
create policy purchase_return_number_counters_tenant on purchase_return_number_counters using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());
alter table purchase_returns enable row level security;alter table purchase_returns force row level security;
create policy purchase_returns_tenant on purchase_returns using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());
alter table purchase_return_items enable row level security;alter table purchase_return_items force row level security;
create policy purchase_return_items_tenant on purchase_return_items using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());

-- Origem opcional e same-tenant da devolução no ledger de estoque (mesma extensão já feita
-- para Recebimento no COM-03). O tipo de movimento reutiliza 'exit' (o mesmo já usado pelo
-- consumo de OS em EST-02): a direção da movimentação e a origem dela são conceitos
-- ortogonais no ledger, e já existe um tipo genérico de saída — criar um tipo dedicado
-- dedicado só para a devolução duplicaria semântica sem necessidade (seção 11 do COM-04).
alter table stock_movements add column purchase_return_id uuid,add column purchase_return_item_id uuid;
alter table stock_movements add foreign key(tenant_id,purchase_return_id) references purchase_returns(tenant_id,id),add foreign key(tenant_id,purchase_return_item_id) references purchase_return_items(tenant_id,id);

-- Reaproveita a mesma função de EST-01/COM-03 (mesmo ledger, mesma projeção de saldo,
-- mesma validação de saldo insuficiente — nenhuma exceção para Compras), apenas
-- acrescentando mais dois parâmetros opcionais de origem ao final. `create or replace`
-- não substitui em vigor ao mudar a lista de parâmetros (lição do COM-03: cria uma
-- segunda sobrecarga) — por isso a versão anterior é removida explicitamente primeiro.
drop function if exists record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid,uuid);
create function record_stock_movement(p_company_id uuid,p_branch_id uuid,p_part_id uuid,p_type text,p_quantity numeric,p_reason text,p_purchase_receipt_id uuid default null,p_purchase_receipt_item_id uuid default null,p_purchase_return_id uuid default null,p_purchase_return_item_id uuid default null)
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
  insert into stock_movements(tenant_id,company_id,branch_id,part_id,type,quantity,resulting_balance,reason,actor_identity_id,purchase_receipt_id,purchase_receipt_item_id,purchase_return_id,purchase_return_item_id)
    values(v_tenant,p_company_id,p_branch_id,p_part_id,p_type,p_quantity,v_balance,p_reason,nullif(current_setting('app.actor_identity_id',true),'')::uuid,p_purchase_receipt_id,p_purchase_receipt_item_id,p_purchase_return_id,p_purchase_return_item_id) returning id into v_id;
  return query select v_id,v_balance;
end $$;

-- Confirmação atômica, mesma arquitetura de locking de confirm_purchase_receipt (COM-03):
-- 1) trava a própria devolução (serializa reconfirmação/cancelamento concorrentes);
-- 2) trava o recebimento de origem (imutável, mas valida que segue 'confirmed');
-- 3) trava as linhas de purchase_receipt_items envolvidas, em ordem estável de id — este é
--    o ponto que serializa duas devoluções concorrentes do MESMO item recebido: a segunda
--    só enxerga o total já devolvido pela primeira depois que ela commitar;
-- 4) só então recalcula devolvido-até-agora por item e valida devolvido+esta ≤ recebido
--    (escopo por purchase_receipt_item_id, nunca agregado entre recebimentos diferentes —
--    seção 8 do COM-04);
-- 5) grava os itens em ordem estável de inventory_part_id antes de chamar
--    record_stock_movement por item — evita deadlock quando uma devolução com múltiplas
--    peças corre em paralelo com outra operação (devolução ou consumo de OS) que também
--    trave saldo de mais de uma peça, pois todas as transações passam a adquirir os locks
--    de stock_balances na mesma ordem relativa;
-- 6) record_stock_movement já trava e valida o saldo físico (mesma regra do EST-01/EST-02,
--    sem exceção para Compras) — é a segunda validação independente exigida pela seção 12.
create function confirm_purchase_return(p_return_id uuid) returns table(return_id uuid,return_status text,confirmed_at timestamptz,idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare
 v_tenant uuid:=vetoros_current_tenant_id();
 v_return purchase_returns%rowtype;
 v_receipt purchase_receipts%rowtype;
 v_row record;
 v_returned numeric;
begin
 if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
 select * into v_return from purchase_returns where tenant_id=v_tenant and id=p_return_id for update;
 if not found then raise exception 'return not found' using errcode='P0002'; end if;
 if v_return.status='confirmed' then return query select v_return.id,v_return.status,v_return.confirmed_at,true::boolean; return; end if;
 if v_return.status='cancelled' then raise exception 'return is cancelled' using errcode='55000'; end if;
 select * into v_receipt from purchase_receipts where tenant_id=v_tenant and id=v_return.purchase_receipt_id for update;
 if not found then raise exception 'purchase receipt not found' using errcode='P0002'; end if;
 if v_receipt.status<>'confirmed' then raise exception 'purchase receipt not confirmed' using errcode='55000'; end if;
 if not exists(select 1 from purchase_return_items where tenant_id=v_tenant and purchase_return_id=p_return_id) then raise exception 'return has no items' using errcode='22023'; end if;
 perform 1 from purchase_receipt_items where tenant_id=v_tenant and id in (select purchase_receipt_item_id from purchase_return_items where tenant_id=v_tenant and purchase_return_id=p_return_id) order by id for update;
 for v_row in select ri.id return_item_id,ri.quantity this_quantity,ri.inventory_part_id,pri.id receipt_item_id,pri.quantity received_quantity from purchase_return_items ri join purchase_receipt_items pri on pri.id=ri.purchase_receipt_item_id where ri.tenant_id=v_tenant and ri.purchase_return_id=p_return_id
 loop
  select coalesce(sum(pri2.quantity),0) into v_returned from purchase_return_items pri2 join purchase_returns pr on pr.id=pri2.purchase_return_id where pri2.tenant_id=v_tenant and pri2.purchase_receipt_item_id=v_row.receipt_item_id and pr.status='confirmed';
  if v_returned+v_row.this_quantity>v_row.received_quantity then raise exception 'returned quantity would exceed received quantity' using errcode='23514'; end if;
 end loop;
 update purchase_returns set status='confirmed',confirmed_at=now(),updated_at=now() where tenant_id=v_tenant and id=p_return_id;
 for v_row in select ri.id return_item_id,ri.quantity this_quantity,ri.inventory_part_id from purchase_return_items ri where ri.tenant_id=v_tenant and ri.purchase_return_id=p_return_id order by ri.inventory_part_id
 loop
  perform record_stock_movement(v_receipt.company_id,v_receipt.branch_id,v_row.inventory_part_id,'exit',v_row.this_quantity,'Devolução de compra #'||v_return.return_number,null,null,p_return_id,v_row.return_item_id);
 end loop;
 return query select p_return_id,'confirmed'::text,now(),false::boolean;
end $$;

grant select,insert,update on purchase_return_number_counters,purchase_returns to vetoros_runtime;
grant select,insert,update,delete on purchase_return_items to vetoros_runtime;
grant execute on function record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid,uuid,uuid,uuid) to vetoros_runtime;
grant execute on function confirm_purchase_return(uuid) to vetoros_runtime;
