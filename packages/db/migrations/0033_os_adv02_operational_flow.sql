-- OS-ADV-02: máquina de estados operacional da OS + cancelamento explícito.
--
-- Descoberta (seção 3 do correio.md): identificação, equipamento (via customer_assets, sem
-- duplicar), defeito/diagnóstico, técnico e os 10 estados operacionais já existiam desde
-- OS-ADV-01. A lacuna real era: (1) nenhuma validação de transição de status — qualquer status
-- podia ir para qualquer outro, inclusive a partir de estados terminais (`delivered`,
-- `canceled`); (2) duas vias de escrita de status (`PATCH /service-orders/:id` genérico e
-- `PATCH /service-orders/:id/operational`) e só uma delas gravava `service_order_status_history`
-- — a via genérica mudava o status silenciosamente, sem histórico.
--
-- Correção na origem (mesmo princípio do fix do journal): um trigger no próprio
-- `service_orders` valida a transição e grava o histórico automaticamente, então qualquer
-- caminho de escrita (presente ou futuro) fica coberto — não é preciso duplicar a regra em cada
-- rota.

create function enforce_service_order_status_transition() returns trigger language plpgsql as $$
begin
  if not (
    (old.status='open' and new.status in ('awaiting_diagnosis','in_progress','canceled')) or
    (old.status='awaiting_diagnosis' and new.status in ('awaiting_approval','in_progress','canceled')) or
    (old.status='awaiting_approval' and new.status in ('approved','canceled')) or
    (old.status='approved' and new.status in ('in_progress','canceled')) or
    (old.status='in_progress' and new.status in ('awaiting_parts','ready','completed','canceled')) or
    (old.status='awaiting_parts' and new.status in ('in_progress','canceled')) or
    (old.status='ready' and new.status in ('completed','delivered','canceled')) or
    (old.status='completed' and new.status in ('delivered','canceled')) or
    (old.status='delivered' and new.status='canceled')
  ) then
    raise exception 'invalid service order status transition: % -> %', old.status, new.status using errcode='55000';
  end if;
  return new;
end $$;
create trigger service_orders_status_transition before update on service_orders for each row
  when (new.status is distinct from old.status) execute function enforce_service_order_status_transition();

-- Histórico passa a ser gravado pelo próprio banco, não pela rota. `app.service_order_status_reason`
-- é um GUC de transação, mesmo padrão já usado para `app.actor_identity_id` (auth/service.ts) —
-- a rota que tiver um motivo explícito (ex.: cancelamento) faz `set_config` antes do UPDATE;
-- quando não há motivo, fica null.
create function record_service_order_status_history() returns trigger language plpgsql as $$
begin
  insert into service_order_status_history(tenant_id,service_order_id,previous_status,new_status,reason,changed_by_identity_id)
    values(new.tenant_id,new.id,old.status,new.status,nullif(current_setting('app.service_order_status_reason',true),''),nullif(current_setting('app.actor_identity_id',true),'')::uuid);
  return new;
end $$;
create trigger service_orders_status_history_record after update on service_orders for each row
  when (new.status is distinct from old.status) execute function record_service_order_status_history();

-- service_orders.cancel: mesmo padrão de sales.cancel (migration 0027) e schedules.cancel
-- (migration 0030) — cancelamento é a operação de maior risco do domínio e ganha permission
-- própria, não fica dentro de service_orders.update. Cedida apenas a quem já abre/conduz a OS no
-- dia a dia (attendance) e às roles administrativas (que recebem automaticamente, via
-- mapTemplatePermissions/seed.ts).
insert into permissions(id,code,module,description) values
  ('01992ea1-1250-7000-8000-000000000064','service_orders.cancel','service_orders','service_orders.cancel')
on conflict (code) do nothing;
