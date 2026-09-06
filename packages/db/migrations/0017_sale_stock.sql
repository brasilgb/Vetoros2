-- Origem opcional e same-tenant da venda no ledger de estoque (mesma extensão já feita para
-- Recebimento e Devolução no COM-03/COM-04). Reaproveita o tipo 'exit' já existente (o mesmo
-- usado pelo consumo de OS e pela devolução ao fornecedor) — a saída física de uma venda não é
-- semanticamente diferente de qualquer outra saída, apenas tem origem diferente; a origem já é
-- registrada pelas colunas nullable, não pelo tipo de movimento (seção 11 do VEN-02).
alter table stock_movements add column sale_id uuid,add column sale_item_id uuid;
alter table stock_movements add foreign key(tenant_id,sale_id) references sales(tenant_id,id),add foreign key(tenant_id,sale_item_id) references sale_items(tenant_id,id);

-- Proteção estrutural contra duplicidade (seção 6 do VEN-02): mesmo que a aplicação tente
-- gerar duas saídas para o mesmo item de venda (bug, retry, requisição duplicada), o banco
-- rejeita a segunda com violação de unicidade — não depende só do lock de confirmação abaixo.
create unique index stock_movements_sale_item_uq on stock_movements(sale_item_id) where sale_item_id is not null;

-- Reaproveita a mesma função de EST-01/COM-03/COM-04 (mesmo ledger, mesma projeção de saldo,
-- mesma validação de saldo insuficiente — nenhuma exceção para Vendas), apenas acrescentando
-- mais dois parâmetros opcionais de origem ao final. `drop`+`create` explícito (não `create or
-- replace`), pela mesma razão já documentada em COM-03/COM-04: adicionar parâmetros via
-- `create or replace` cria uma segunda sobrecarga em vez de substituir a função em vigor.
drop function if exists record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid,uuid,uuid,uuid);
create function record_stock_movement(p_company_id uuid,p_branch_id uuid,p_part_id uuid,p_type text,p_quantity numeric,p_reason text,p_purchase_receipt_id uuid default null,p_purchase_receipt_item_id uuid default null,p_purchase_return_id uuid default null,p_purchase_return_item_id uuid default null,p_sale_id uuid default null,p_sale_item_id uuid default null)
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
  insert into stock_movements(tenant_id,company_id,branch_id,part_id,type,quantity,resulting_balance,reason,actor_identity_id,purchase_receipt_id,purchase_receipt_item_id,purchase_return_id,purchase_return_item_id,sale_id,sale_item_id)
    values(v_tenant,p_company_id,p_branch_id,p_part_id,p_type,p_quantity,v_balance,p_reason,nullif(current_setting('app.actor_identity_id',true),'')::uuid,p_purchase_receipt_id,p_purchase_receipt_item_id,p_purchase_return_id,p_purchase_return_item_id,p_sale_id,p_sale_item_id) returning id into v_id;
  return query select v_id,v_balance;
end $$;

grant execute on function record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid,uuid,uuid,uuid,uuid,uuid) to vetoros_runtime;
