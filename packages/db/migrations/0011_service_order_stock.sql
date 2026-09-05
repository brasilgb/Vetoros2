alter table service_order_items add column inventory_part_id uuid;
alter table service_order_items add foreign key(tenant_id,inventory_part_id) references inventory_parts(tenant_id,id);
alter table service_order_items add constraint service_order_items_inventory_part_type_ck check(inventory_part_id is null or type='part');

create table service_order_item_stock_reservations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,company_id uuid not null,branch_id uuid not null,service_order_id uuid not null,service_order_item_id uuid not null,inventory_part_id uuid not null,
 original_quantity numeric(16,3) not null default 0,reserved_quantity numeric(16,3) not null default 0,consumed_quantity numeric(16,3) not null default 0,released_quantity numeric(16,3) not null default 0,returned_quantity numeric(16,3) not null default 0,
 status text not null default 'reserved',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,id),unique(tenant_id,service_order_item_id),
 foreign key(tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),foreign key(tenant_id,service_order_id) references service_orders(tenant_id,id),foreign key(tenant_id,service_order_item_id) references service_order_items(tenant_id,id),foreign key(tenant_id,inventory_part_id) references inventory_parts(tenant_id,id),
 check(original_quantity>=0 and reserved_quantity>=0 and consumed_quantity>=0 and released_quantity>=0 and returned_quantity>=0),check(original_quantity=reserved_quantity+consumed_quantity+released_quantity),check(returned_quantity<=consumed_quantity),check(status in('reserved','partially_consumed','consumed','released','partially_returned','returned'))
);
create table service_order_stock_operations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,service_order_id uuid not null,service_order_item_id uuid not null,reservation_id uuid not null,action text not null,quantity numeric(16,3) not null,idempotency_key text not null,stock_movement_id uuid,created_at timestamptz not null default now(),
 unique(tenant_id,id),unique(tenant_id,idempotency_key),foreign key(tenant_id,service_order_id) references service_orders(tenant_id,id),foreign key(tenant_id,service_order_item_id) references service_order_items(tenant_id,id),foreign key(tenant_id,reservation_id) references service_order_item_stock_reservations(tenant_id,id),check(action in('reserve','release','consume','return')),check(quantity>0),check(length(trim(idempotency_key))>=8)
);
alter table stock_movements add column service_order_id uuid,add column service_order_item_id uuid,add column stock_operation_id uuid;
alter table stock_movements add foreign key(tenant_id,service_order_id) references service_orders(tenant_id,id),add foreign key(tenant_id,service_order_item_id) references service_order_items(tenant_id,id),add foreign key(tenant_id,stock_operation_id) references service_order_stock_operations(tenant_id,id);
alter table service_order_stock_operations add foreign key(tenant_id,stock_movement_id) references stock_movements(tenant_id,id) deferrable initially deferred;
create index service_order_stock_reserved_idx on service_order_item_stock_reservations(tenant_id,branch_id,inventory_part_id) where reserved_quantity>0;
create index service_order_stock_operations_item_idx on service_order_stock_operations(tenant_id,service_order_item_id,created_at);
alter table service_order_item_stock_reservations enable row level security;alter table service_order_item_stock_reservations force row level security;create policy service_order_item_stock_reservations_tenant on service_order_item_stock_reservations using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());
alter table service_order_stock_operations enable row level security;alter table service_order_stock_operations force row level security;create policy service_order_stock_operations_tenant on service_order_stock_operations using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());
create function reject_stock_operation_mutation() returns trigger language plpgsql as $$ begin raise exception 'service_order_stock_operations is append-only';end $$;create trigger service_order_stock_operations_append_only before update or delete on service_order_stock_operations for each row execute function reject_stock_operation_mutation();

create function service_order_stock_action(p_order uuid,p_item uuid,p_action text,p_quantity numeric,p_key text)
returns table(reservation_id uuid,physical_balance numeric,total_reserved numeric,available numeric,item_reserved numeric,consumed numeric,returned numeric,status text,movement_id uuid,idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare v_tenant uuid:=vetoros_current_tenant_id();v_order service_orders%rowtype;v_item service_order_items%rowtype;v_res service_order_item_stock_reservations%rowtype;v_balance numeric;v_total numeric;v_op uuid;v_move uuid;v_delta numeric;
begin
 if v_tenant is null then raise exception 'tenant context required' using errcode='42501';end if;
 if p_action not in('reserve','release','consume','return') or p_quantity<=0 or length(trim(p_key))<8 then raise exception 'invalid operation' using errcode='22023';end if;
 select * into v_order from service_orders where tenant_id=v_tenant and id=p_order for update;if not found then raise exception 'order not found' using errcode='P0002';end if;
 select * into v_item from service_order_items where tenant_id=v_tenant and id=p_item and service_order_id=p_order;if not found then raise exception 'item not found' using errcode='P0002';end if;
 if v_item.type<>'part' or v_item.inventory_part_id is null then raise exception 'unlinked part' using errcode='22023';end if;
 if v_order.status not in('open','in_progress') then raise exception 'order state forbids stock action' using errcode='55000';end if;
 select id into v_op from service_order_stock_operations where tenant_id=v_tenant and idempotency_key=p_key;
 if found then
  if not exists(select 1 from service_order_stock_operations where id=v_op and service_order_id=p_order and service_order_item_id=p_item and action=p_action and quantity=p_quantity) then raise exception 'idempotency conflict' using errcode='23505';end if;
  select * into v_res from service_order_item_stock_reservations where tenant_id=v_tenant and service_order_item_id=p_item;select coalesce(quantity,0) into v_balance from stock_balances where tenant_id=v_tenant and branch_id=v_order.branch_id and part_id=v_item.inventory_part_id;select coalesce(sum(reserved_quantity),0) into v_total from service_order_item_stock_reservations where tenant_id=v_tenant and branch_id=v_order.branch_id and inventory_part_id=v_item.inventory_part_id;select stock_movement_id into v_move from service_order_stock_operations where id=v_op;
  return query select v_res.id,v_balance,v_total,v_balance-v_total,v_res.reserved_quantity,v_res.consumed_quantity,v_res.returned_quantity,v_res.status,v_move,true;return;
 end if;
 insert into stock_balances(tenant_id,company_id,branch_id,part_id,quantity) values(v_tenant,v_order.company_id,v_order.branch_id,v_item.inventory_part_id,0) on conflict(tenant_id,branch_id,part_id) do nothing;
 select quantity into v_balance from stock_balances where tenant_id=v_tenant and branch_id=v_order.branch_id and part_id=v_item.inventory_part_id for update;
 select * into v_res from service_order_item_stock_reservations where tenant_id=v_tenant and service_order_item_id=p_item for update;
 if not found then insert into service_order_item_stock_reservations(tenant_id,company_id,branch_id,service_order_id,service_order_item_id,inventory_part_id) values(v_tenant,v_order.company_id,v_order.branch_id,p_order,p_item,v_item.inventory_part_id) returning * into v_res;end if;
 select coalesce(sum(reserved_quantity),0) into v_total from service_order_item_stock_reservations where tenant_id=v_tenant and branch_id=v_order.branch_id and inventory_part_id=v_item.inventory_part_id;
 if p_action='reserve' then if p_quantity>v_balance-v_total or v_res.reserved_quantity+(v_res.consumed_quantity-v_res.returned_quantity)+p_quantity>v_item.quantity then raise exception 'insufficient available or item quantity: %',v_balance-v_total using errcode='23514';end if;v_res.original_quantity:=v_res.original_quantity+p_quantity;v_res.reserved_quantity:=v_res.reserved_quantity+p_quantity;
 elsif p_action='release' then if p_quantity>v_res.reserved_quantity then raise exception 'release exceeds reserved' using errcode='23514';end if;v_res.reserved_quantity:=v_res.reserved_quantity-p_quantity;v_res.released_quantity:=v_res.released_quantity+p_quantity;
 elsif p_action='consume' then if p_quantity>v_res.reserved_quantity then raise exception 'consume exceeds reserved' using errcode='23514';end if;v_res.reserved_quantity:=v_res.reserved_quantity-p_quantity;v_res.consumed_quantity:=v_res.consumed_quantity+p_quantity;v_balance:=v_balance-p_quantity;if v_balance<0 then raise exception 'insufficient physical stock' using errcode='23514';end if;
 elsif p_action='return' then if p_quantity>v_res.consumed_quantity-v_res.returned_quantity then raise exception 'return exceeds consumed' using errcode='23514';end if;v_res.returned_quantity:=v_res.returned_quantity+p_quantity;v_balance:=v_balance+p_quantity;end if;
 v_res.status:=case when v_res.reserved_quantity>0 and v_res.consumed_quantity>0 then 'partially_consumed' when v_res.reserved_quantity>0 then 'reserved' when v_res.consumed_quantity=v_res.returned_quantity and v_res.consumed_quantity>0 then 'returned' when v_res.returned_quantity>0 then 'partially_returned' when v_res.consumed_quantity>0 then 'consumed' else 'released' end;
 update service_order_item_stock_reservations set original_quantity=v_res.original_quantity,reserved_quantity=v_res.reserved_quantity,consumed_quantity=v_res.consumed_quantity,released_quantity=v_res.released_quantity,returned_quantity=v_res.returned_quantity,status=v_res.status,updated_at=now() where id=v_res.id;
 if p_action in('consume','return') then v_move:=gen_random_uuid();end if;
 insert into service_order_stock_operations(tenant_id,service_order_id,service_order_item_id,reservation_id,action,quantity,idempotency_key,stock_movement_id) values(v_tenant,p_order,p_item,v_res.id,p_action,p_quantity,p_key,v_move) returning id into v_op;
 if p_action in('consume','return') then
  update stock_balances set quantity=v_balance,updated_at=now() where tenant_id=v_tenant and branch_id=v_order.branch_id and part_id=v_item.inventory_part_id;
  insert into stock_movements(id,tenant_id,company_id,branch_id,part_id,type,quantity,resulting_balance,reason,actor_identity_id,service_order_id,service_order_item_id,stock_operation_id) values(v_move,v_tenant,v_order.company_id,v_order.branch_id,v_item.inventory_part_id,case when p_action='consume' then 'exit' else 'entry' end,p_quantity,v_balance,case when p_action='consume' then 'Consumo de peça pela OS' else 'Devolução de peça da OS' end,nullif(current_setting('app.actor_identity_id',true),'')::uuid,p_order,p_item,v_op);
 end if;
 select coalesce(sum(reserved_quantity),0) into v_total from service_order_item_stock_reservations where tenant_id=v_tenant and branch_id=v_order.branch_id and inventory_part_id=v_item.inventory_part_id;
 return query select v_res.id,v_balance,v_total,v_balance-v_total,v_res.reserved_quantity,v_res.consumed_quantity,v_res.returned_quantity,v_res.status,v_move,false;
end $$;
grant select on service_order_item_stock_reservations,service_order_stock_operations to vetoros_runtime;grant execute on function service_order_stock_action(uuid,uuid,text,numeric,text) to vetoros_runtime;
