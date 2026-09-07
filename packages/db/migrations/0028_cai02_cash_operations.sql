-- CAI-02: operações manuais de caixa. O ledger existente continua sendo a fonte da verdade.
-- A função bloqueia a sessão, deriva o novo saldo do último movimento e impede corrida com
-- fechamento/recebimento/estorno. Nenhuma projeção calculada é aceita do cliente.
create function record_cash_adjustment(p_cash_session_id uuid, p_type text, p_amount numeric, p_reason text)
returns table(movement_id uuid, resulting_balance numeric)
language plpgsql security definer set search_path=public as $$
declare
  v_tenant uuid := vetoros_current_tenant_id();
  v_session cash_sessions%rowtype;
  v_balance numeric;
  v_movement_id uuid;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if p_type not in ('supply','withdrawal') or p_amount <= 0 or length(trim(coalesce(p_reason,''))) = 0 then
    raise exception 'invalid cash adjustment' using errcode='22023';
  end if;

  select * into v_session from cash_sessions
    where tenant_id=v_tenant and id=p_cash_session_id for update;
  if not found then raise exception 'session not found' using errcode='P0002'; end if;
  if v_session.status <> 'open' then raise exception 'session not open' using errcode='55000'; end if;

  select cm.resulting_balance into v_balance from cash_movements cm
    where cm.tenant_id=v_tenant and cm.cash_session_id=p_cash_session_id
    order by cm.created_at desc,cm.id desc limit 1;
  v_balance := coalesce(v_balance,v_session.opening_amount)
    + case when p_type='supply' then p_amount else -p_amount end;
  if v_balance < 0 then raise exception 'insufficient session balance' using errcode='23514'; end if;

  insert into cash_movements
    (tenant_id,company_id,branch_id,cash_session_id,type,amount,resulting_balance,reason,actor_identity_id)
  values
    (v_tenant,v_session.company_id,v_session.branch_id,v_session.id,p_type,p_amount,v_balance,trim(p_reason),nullif(current_setting('app.actor_identity_id',true),'')::uuid)
  returning id into v_movement_id;

  return query select v_movement_id,v_balance;
end $$;

grant execute on function record_cash_adjustment(uuid,text,numeric,text) to vetoros_runtime;
