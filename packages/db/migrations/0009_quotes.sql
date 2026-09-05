alter table customer_assets add constraint customer_assets_tenant_customer_id_uq unique (tenant_id, customer_id, id);

create table quote_number_counters (
  tenant_id uuid primary key references tenants(id),
  last_number bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  quote_number bigint not null,
  customer_id uuid not null,
  customer_asset_id uuid,
  status text not null default 'draft',
  title text not null,
  notes text,
  valid_until date,
  converted_service_order_id uuid,
  created_by_identity_id uuid references identities(id),
  updated_by_identity_id uuid references identities(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, quote_number),
  unique (tenant_id, converted_service_order_id),
  check (status in ('draft','sent','approved','rejected','expired','cancelled')),
  foreign key (tenant_id, company_id) references companies(tenant_id, id),
  foreign key (tenant_id, company_id, branch_id) references branches(tenant_id, company_id, id),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id),
  foreign key (tenant_id, customer_id, customer_asset_id) references customer_assets(tenant_id, customer_id, id),
  foreign key (tenant_id, converted_service_order_id) references service_orders(tenant_id, id)
);

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  quote_id uuid not null,
  type text not null,
  description text not null,
  quantity numeric(14,3) not null,
  unit_price numeric(14,2) not null,
  discount_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) generated always as (round(quantity * unit_price - discount_amount, 2)) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, quote_id) references quotes(tenant_id, id) on delete cascade,
  check (type in ('service','part')),
  check (quantity > 0),
  check (unit_price >= 0),
  check (discount_amount >= 0),
  check (discount_amount <= quantity * unit_price)
);

create index quotes_list_idx on quotes(tenant_id, created_at desc);
create index quotes_customer_idx on quotes(tenant_id, customer_id);
create index quotes_status_idx on quotes(tenant_id, status);
create index quote_items_quote_idx on quote_items(tenant_id, quote_id);

alter table quotes enable row level security;
alter table quotes force row level security;
create policy quotes_tenant_isolation on quotes using (tenant_id = current_setting('app.tenant_id', true)::uuid) with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
alter table quote_items enable row level security;
alter table quote_items force row level security;
create policy quote_items_tenant_isolation on quote_items using (tenant_id = current_setting('app.tenant_id', true)::uuid) with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update on quote_number_counters, quotes to vetoros_runtime;
grant select, insert, update, delete on quote_items to vetoros_runtime;
