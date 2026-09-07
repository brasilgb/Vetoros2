-- CAI-03: justificativa mínima e imutável para fechamento com divergência.
-- Não cria conciliação bancária nem um segundo ledger.
alter table cash_sessions add column closing_justification text;

alter table cash_sessions add constraint cash_sessions_difference_justification_ck check (
  status <> 'closed'
  or closing_amount_informed = expected_amount_at_close
  or length(trim(coalesce(closing_justification,''))) > 0
) not valid;

drop function close_cash_session(uuid,numeric);

create function close_cash_session(p_cash_session_id uuid, p_closing_amount_informed numeric, p_closing_justification text)
returns table(session_id uuid, expected_amount numeric, closing_amount_informed numeric, difference numeric, closing_justification text)
language plpgsql security definer set search_path=public as $$
declare
  v_tenant uuid := vetoros_current_tenant_id();
  v_session cash_sessions%rowtype;
  v_expected numeric;
  v_difference numeric;
  v_justification text := nullif(trim(p_closing_justification),'');
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if p_closing_amount_informed < 0 then raise exception 'invalid closing amount' using errcode='22023'; end if;
  select * into v_session from cash_sessions where tenant_id=v_tenant and id=p_cash_session_id for update;
  if not found then raise exception 'session not found' using errcode='P0002'; end if;
  if v_session.status <> 'open' then raise exception 'session not open' using errcode='55000'; end if;
  select cm.resulting_balance into v_expected from cash_movements cm
    where cm.tenant_id=v_tenant and cm.cash_session_id=p_cash_session_id
    order by cm.created_at desc,cm.id desc limit 1;
  v_expected := coalesce(v_expected,v_session.opening_amount);
  v_difference := p_closing_amount_informed-v_expected;
  if v_difference <> 0 and v_justification is null then
    raise exception 'closing justification required' using errcode='23514';
  end if;
  update cash_sessions set status='closed',closed_at=now(),closed_by_identity_id=nullif(current_setting('app.actor_identity_id',true),'')::uuid,
    closing_amount_informed=p_closing_amount_informed,expected_amount_at_close=v_expected,closing_justification=v_justification,updated_at=now()
  where id=p_cash_session_id;
  return query select p_cash_session_id,v_expected,p_closing_amount_informed,v_difference,v_justification;
end $$;

grant execute on function close_cash_session(uuid,numeric,text) to vetoros_runtime;
