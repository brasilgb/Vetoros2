create table inventory_parts (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  sku text not null, description text not null, status text not null default 'active', unit text not null,
  reference_cost numeric(14,2), reference_price numeric(14,2),
  created_by_identity_id uuid references identities(id), updated_by_identity_id uuid references identities(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,id), unique (tenant_id,sku),
  foreign key (tenant_id) references tenants(id),
  check (status in ('active','inactive')), check (length(trim(sku)) > 0), check (length(trim(description)) > 0),
  check (reference_cost is null or reference_cost >= 0), check (reference_price is null or reference_price >= 0)
);

create table stock_balances (
  tenant_id uuid not null, company_id uuid not null, branch_id uuid not null, part_id uuid not null,
  quantity numeric(16,3) not null default 0, updated_at timestamptz not null default now(),
  primary key (tenant_id,branch_id,part_id),
  foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
  foreign key (tenant_id,part_id) references inventory_parts(tenant_id,id),
  check (quantity >= 0)
);

create table stock_movements (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, company_id uuid not null, branch_id uuid not null, part_id uuid not null,
  type text not null, quantity numeric(16,3) not null, resulting_balance numeric(16,3) not null,
  reason text not null, actor_identity_id uuid references identities(id), created_at timestamptz not null default now(),
  unique (tenant_id,id),
  foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
  foreign key (tenant_id,part_id) references inventory_parts(tenant_id,id),
  check (type in ('entry','exit','adjustment_in','adjustment_out')),
  check (quantity > 0), check (resulting_balance >= 0), check (length(trim(reason)) > 0)
);

create index inventory_parts_search_idx on inventory_parts(tenant_id,status,sku);
create index stock_balances_branch_idx on stock_balances(tenant_id,company_id,branch_id);
create index stock_movements_list_idx on stock_movements(tenant_id,branch_id,created_at desc);
create index stock_movements_part_idx on stock_movements(tenant_id,part_id,created_at desc);

alter table inventory_parts enable row level security; alter table inventory_parts force row level security;
create policy inventory_parts_tenant_isolation on inventory_parts using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());
alter table stock_balances enable row level security; alter table stock_balances force row level security;
create policy stock_balances_tenant_isolation on stock_balances using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());
alter table stock_movements enable row level security; alter table stock_movements force row level security;
create policy stock_movements_tenant_isolation on stock_movements using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());

create function reject_stock_movement_mutation() returns trigger language plpgsql as $$ begin raise exception 'stock_movements is append-only'; end $$;
create trigger stock_movements_append_only before update or delete on stock_movements for each row execute function reject_stock_movement_mutation();

create function record_stock_movement(p_company_id uuid,p_branch_id uuid,p_part_id uuid,p_type text,p_quantity numeric,p_reason text)
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
  insert into stock_movements(tenant_id,company_id,branch_id,part_id,type,quantity,resulting_balance,reason,actor_identity_id)
    values(v_tenant,p_company_id,p_branch_id,p_part_id,p_type,p_quantity,v_balance,p_reason,nullif(current_setting('app.actor_identity_id',true),'')::uuid) returning id into v_id;
  return query select v_id,v_balance;
end $$;

revoke all on stock_balances,stock_movements from vetoros_runtime;
grant select,insert,update on inventory_parts to vetoros_runtime;
grant select on stock_balances,stock_movements to vetoros_runtime;
grant execute on function record_stock_movement(uuid,uuid,uuid,text,numeric,text) to vetoros_runtime;
