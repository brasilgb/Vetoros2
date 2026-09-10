-- OS-ADV-01: dados operacionais, garantia e retorno preservando a OS original.
alter table service_orders add column if not exists priority text not null default 'normal';
alter table service_orders add column if not exists technician_user_profile_id uuid;
alter table service_orders add column if not exists diagnosis text;
alter table service_orders add column if not exists executed_solution text;
alter table service_orders add column if not exists technical_notes text;
alter table service_orders add column if not exists started_at timestamptz;
alter table service_orders add column if not exists technically_completed_at timestamptz;
alter table service_orders add column if not exists delivered_at timestamptz;
alter table service_orders add column if not exists delivery_notes text;
alter table service_orders add column if not exists warranty_enabled boolean not null default false;
alter table service_orders add column if not exists warranty_started_at date;
alter table service_orders add column if not exists warranty_ends_at date;
alter table service_orders add column if not exists warranty_notes text;
alter table service_orders add column if not exists original_service_order_id uuid;
alter table service_orders add column if not exists previous_service_order_id uuid;
alter table service_orders add column if not exists service_order_kind text not null default 'standard';
alter table service_orders add column if not exists warranty_snapshot_status text;
alter table service_orders add column if not exists warranty_claim_reason text;
alter table service_orders add column if not exists warranty_analysis_result text;
alter table service_orders add column if not exists warranty_analysis_notes text;

alter table service_orders drop constraint if exists service_orders_status_check;
alter table service_orders add constraint service_orders_status_check check (status in ('open','awaiting_diagnosis','awaiting_approval','approved','in_progress','awaiting_parts','ready','completed','delivered','canceled'));
alter table service_orders add constraint service_orders_priority_check check (priority in ('low','normal','high','urgent'));
alter table service_orders add constraint service_orders_kind_check check (service_order_kind in ('standard','warranty_return'));
alter table service_orders add constraint service_orders_warranty_status_check check (warranty_snapshot_status is null or warranty_snapshot_status in ('within_warranty','expired','not_applicable'));
alter table service_orders add constraint service_orders_warranty_result_check check (warranty_analysis_result is null or warranty_analysis_result in ('pending_analysis','approved','rejected','not_related','expired'));
alter table service_orders add constraint service_orders_warranty_dates_check check (warranty_ends_at is null or warranty_started_at is null or warranty_ends_at >= warranty_started_at);
alter table service_orders add constraint service_orders_original_fk foreign key (tenant_id,original_service_order_id) references service_orders(tenant_id,id);
alter table service_orders add constraint service_orders_previous_fk foreign key (tenant_id,previous_service_order_id) references service_orders(tenant_id,id);
create index if not exists service_orders_original_idx on service_orders(tenant_id,original_service_order_id);

create table if not exists service_order_status_history (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, service_order_id uuid not null,
 previous_status text, new_status text not null, reason text, changed_by_identity_id uuid references identities(id), created_at timestamptz not null default now(),
 unique (tenant_id,id), foreign key (tenant_id,service_order_id) references service_orders(tenant_id,id)
);
alter table service_order_status_history enable row level security;
alter table service_order_status_history force row level security;
drop policy if exists service_order_status_history_tenant on service_order_status_history;
create policy service_order_status_history_tenant on service_order_status_history using (tenant_id = current_setting('app.tenant_id', true)::uuid) with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
grant select,insert on service_order_status_history to vetoros_runtime;

-- O histórico é append-only para o papel de runtime.
revoke update,delete on service_order_status_history from vetoros_runtime;
