create table purchase_order_number_counters(tenant_id uuid primary key references tenants(id),last_number bigint not null default 0 check(last_number>=0),updated_at timestamptz not null default now());

create table purchase_orders(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,company_id uuid not null,branch_id uuid not null,
 purchase_order_number bigint not null,supplier_id uuid not null,status text not null default 'draft',
 issue_date date not null default current_date,expected_date date,supplier_reference text,notes text,
 subtotal numeric(14,2) not null default 0,discount_total numeric(14,2) not null default 0,
 freight_total numeric(14,2) not null default 0,other_costs_total numeric(14,2) not null default 0,total numeric(14,2) not null default 0,
 created_by_identity_id uuid references identities(id),updated_by_identity_id uuid references identities(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),unique(tenant_id,purchase_order_number),
 check(status in('draft','approved','cancelled')),
 check(subtotal>=0),check(discount_total>=0),check(freight_total>=0),check(other_costs_total>=0),check(total>=0),
 foreign key(tenant_id,company_id) references companies(tenant_id,id),
 foreign key(tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
 foreign key(tenant_id,supplier_id) references suppliers(tenant_id,id)
);

create table purchase_order_items(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,purchase_order_id uuid not null,inventory_part_id uuid not null,
 description text not null,quantity numeric(14,3) not null,unit_cost numeric(14,2) not null,discount numeric(14,2) not null default 0,
 total numeric(14,2) generated always as (round(quantity*unit_cost-discount,2)) stored,
 notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),
 foreign key(tenant_id,purchase_order_id) references purchase_orders(tenant_id,id) on delete cascade,
 foreign key(tenant_id,inventory_part_id) references inventory_parts(tenant_id,id),
 check(length(trim(description))>0),check(quantity>0),check(unit_cost>=0),check(discount>=0),check(discount<=quantity*unit_cost)
);

create index purchase_orders_list_idx on purchase_orders(tenant_id,created_at desc);
create index purchase_orders_supplier_idx on purchase_orders(tenant_id,supplier_id);
create index purchase_orders_status_idx on purchase_orders(tenant_id,status);
create index purchase_orders_branch_idx on purchase_orders(tenant_id,branch_id);
create index purchase_order_items_order_idx on purchase_order_items(tenant_id,purchase_order_id);

alter table purchase_order_number_counters enable row level security;alter table purchase_order_number_counters force row level security;
create policy purchase_order_number_counters_tenant on purchase_order_number_counters using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());
alter table purchase_orders enable row level security;alter table purchase_orders force row level security;
create policy purchase_orders_tenant on purchase_orders using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());
alter table purchase_order_items enable row level security;alter table purchase_order_items force row level security;
create policy purchase_order_items_tenant on purchase_order_items using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());

-- Totais do pedido (subtotal, discount_total, total) são derivados dos itens no banco,
-- evitando duas fontes de verdade e drift entre API e persistência (ver COM-01, lição do bug de UPDATE manual).
create function recompute_purchase_order_totals() returns trigger language plpgsql as $$
declare v_order_id uuid:=coalesce(new.purchase_order_id,old.purchase_order_id); v_tenant uuid:=coalesce(new.tenant_id,old.tenant_id); v_subtotal numeric; v_discount numeric;
begin
 select coalesce(sum(quantity*unit_cost),0),coalesce(sum(discount),0) into v_subtotal,v_discount from purchase_order_items where tenant_id=v_tenant and purchase_order_id=v_order_id;
 update purchase_orders set subtotal=v_subtotal,discount_total=v_discount,total=round(v_subtotal-v_discount+freight_total+other_costs_total,2),updated_at=now() where tenant_id=v_tenant and id=v_order_id;
 return null;
end $$;
create trigger purchase_order_items_recompute_totals after insert or update or delete on purchase_order_items for each row execute function recompute_purchase_order_totals();

grant select,insert,update on purchase_order_number_counters,purchase_orders to vetoros_runtime;
grant select,insert,update,delete on purchase_order_items to vetoros_runtime;
