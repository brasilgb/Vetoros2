create table sale_number_counters(tenant_id uuid primary key references tenants(id),last_number bigint not null default 0 check(last_number>=0),updated_at timestamptz not null default now());

create table sales(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,company_id uuid not null,branch_id uuid not null,
 sale_number bigint not null,customer_id uuid,status text not null default 'draft',notes text,
 created_by_identity_id uuid references identities(id),updated_by_identity_id uuid references identities(id),
 confirmed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),unique(tenant_id,sale_number),
 check(status in('draft','confirmed','cancelled')),
 foreign key(tenant_id,company_id) references companies(tenant_id,id),
 foreign key(tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
 foreign key(tenant_id,customer_id) references customers(tenant_id,id)
);

create table sale_items(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,sale_id uuid not null,type text not null,
 inventory_part_id uuid,description text not null,quantity numeric(14,3) not null,unit_price numeric(14,2) not null,
 discount_amount numeric(14,2) not null default 0,total numeric(14,2) generated always as (round(quantity*unit_price-discount_amount,2)) stored,
 notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),
 foreign key(tenant_id,sale_id) references sales(tenant_id,id) on delete cascade,
 foreign key(tenant_id,inventory_part_id) references inventory_parts(tenant_id,id),
 check(type in('service','part')),check(inventory_part_id is null or type='part'),
 check(length(trim(description))>0),check(quantity>0),check(unit_price>=0),check(discount_amount>=0),check(discount_amount<=quantity*unit_price)
);

create index sales_list_idx on sales(tenant_id,created_at desc);
create index sales_customer_idx on sales(tenant_id,customer_id);
create index sales_status_idx on sales(tenant_id,status);
create index sale_items_sale_idx on sale_items(tenant_id,sale_id);

alter table sale_number_counters enable row level security;alter table sale_number_counters force row level security;
create policy sale_number_counters_tenant on sale_number_counters using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());
alter table sales enable row level security;alter table sales force row level security;
create policy sales_tenant on sales using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());
alter table sale_items enable row level security;alter table sale_items force row level security;
create policy sale_items_tenant on sale_items using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());

grant select,insert,update on sale_number_counters,sales to vetoros_runtime;
grant select,insert,update,delete on sale_items to vetoros_runtime;
