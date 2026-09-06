-- FIN-01: caixa e recebimentos. Ver executed.md "Descoberta" — nenhuma estrutura equivalente
-- existia (nenhuma tabela cash/payment/finance, `sales` não tem `total` persistido — soma de
-- `sale_items`, sem conceito de pagamento). Segue o MESMO princípio já aprovado no estoque
-- (seção 2 do correio.md, migrations 0010/0011): movimentações são a verdade histórica, saldo é
-- sempre calculado a partir delas, nunca um campo mutável isolado.

-- `payment_methods` é catálogo GLOBAL (como `permissions`), não tenant-scoped: "Dinheiro"/"PIX"
-- significam a mesma coisa para qualquer tenant — diferente de `tenant_roles`, que é
-- genuinamente customizável por tenant. Tabela real (não CHECK fixo) porque a seção 5 do
-- correio.md pede exatamente isso ("não transformar códigos fixos arbitrários em arquitetura
-- permanente se o sistema claramente precisar de cadastro configurável") — "outras" já implica
-- que a lista cresce sem migration.
create table payment_methods (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

-- `cash_registers`: um caixa pertence a tenant→company→branch (seção 3). Sem 1:1 com filial —
-- "não assumir que haverá somente um caixa por filial" — só um nome único dentro da filial.
create table cash_registers (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, company_id uuid not null, branch_id uuid not null,
  name text not null, status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,id), unique (tenant_id,branch_id,name),
  foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id)
);

-- `cash_sessions`: uma abertura física/lógica (seção 4). "Impedir duas sessões abertas para o
-- mesmo caixa" é garantido por uma UNIQUE INDEX PARCIAL — não por uma checagem antecipada na
-- aplicação (seção 18: "as invariantes críticas devem ser garantidas pelo banco/transação") —
-- fecha a condição de corrida de duas aberturas simultâneas sem nenhuma janela possível: a
-- segunda tentativa de INSERT esbarra na constraint, ponto.
create table cash_sessions (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, company_id uuid not null, branch_id uuid not null, cash_register_id uuid not null,
  opened_by_identity_id uuid references identities(id), opened_at timestamptz not null default now(), opening_amount numeric(14,2) not null check (opening_amount >= 0),
  status text not null default 'open' check (status in ('open','closed')),
  closed_by_identity_id uuid references identities(id), closed_at timestamptz,
  closing_amount_informed numeric(14,2), expected_amount_at_close numeric(14,2),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  foreign key (tenant_id,cash_register_id) references cash_registers(tenant_id,id),
  foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
  check ((status='open' and closed_at is null and closed_by_identity_id is null and closing_amount_informed is null and expected_amount_at_close is null) or (status='closed' and closed_at is not null))
);
create unique index cash_sessions_one_open_per_register on cash_sessions(tenant_id,cash_register_id) where status='open';
create index cash_sessions_list_idx on cash_sessions(tenant_id,branch_id,opened_at desc);

-- `payments` (recebimentos, seção 6). Vínculo com a origem: dois FKs reais e nullable
-- (`sale_id`/`service_order_id`), não uma FK polimórfica (`entity_type`+`entity_id` sem
-- constraint real) — a seção 6 pede explicitamente para não fazer isso "sem analisar
-- alternativas", e o próprio código já resolve esse problema assim: `stock_movements` (migration
-- 0011) já adicionou `service_order_id`/`service_order_item_id` como colunas nullable NOVAS em
-- vez de generalizar a origem — mesma técnica aqui. O CHECK permite ZERO ou UM vínculo (nunca os
-- dois) — zero cobre "outra origem futura"/recebimento avulso, sem forçar uma origem que não
-- existe. `cash_session_id` é obrigatório: nesta rodada não existe recebimento fora de uma
-- sessão de caixa aberta (contas bancárias/conciliação, os únicos casos que dispensariam isso,
-- estão fora de escopo). `idempotency_key` — seção 10 — protege contra duplo clique/retry.
create table payments (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, company_id uuid not null, branch_id uuid not null, cash_session_id uuid not null,
  amount numeric(14,2) not null check (amount > 0), payment_method_id uuid not null references payment_methods(id),
  sale_id uuid, service_order_id uuid, notes text,
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  created_by_identity_id uuid references identities(id), created_at timestamptz not null default now(),
  unique (tenant_id,id), unique (tenant_id,idempotency_key),
  foreign key (tenant_id,cash_session_id) references cash_sessions(tenant_id,id),
  foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
  foreign key (tenant_id,sale_id) references sales(tenant_id,id),
  foreign key (tenant_id,service_order_id) references service_orders(tenant_id,id),
  check ((sale_id is not null)::int + (service_order_id is not null)::int <= 1)
);
create index payments_list_idx on payments(tenant_id,branch_id,created_at desc);
create index payments_sale_idx on payments(tenant_id,sale_id) where sale_id is not null;
create index payments_service_order_idx on payments(tenant_id,service_order_id) where service_order_id is not null;

-- `cash_movements`: o ledger append-only de verdade (seção 8). `type` já inclui `supply`/
-- `withdrawal` (suprimento/sangria) na constraint mesmo sem nenhum endpoint os produzindo nesta
-- rodada — "não é obrigatório implementar todos esses tipos... entretanto a modelagem não deve
-- inviabilizá-los" — mesma técnica de `stock_movements`, que desde a migration 0010 já incluía
-- `adjustment_in`/`adjustment_out` na constraint antes de qualquer fluxo os usar de fato.
-- `fechamento` NÃO é um tipo de movimento aqui: fechar caixa não move dinheiro, é uma transição
-- de status em `cash_sessions` (com seu próprio evento de auditoria) — um `type='closing'` com
-- valor zero seria um evento sem sentido financeiro no ledger.
create table cash_movements (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, company_id uuid not null, branch_id uuid not null, cash_session_id uuid not null,
  type text not null check (type in ('opening','receipt','refund','supply','withdrawal')),
  amount numeric(14,2) not null check (amount >= 0), resulting_balance numeric(14,2) not null check (resulting_balance >= 0),
  payment_id uuid, reason text not null check (length(trim(reason)) > 0), actor_identity_id uuid references identities(id),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  foreign key (tenant_id,cash_session_id) references cash_sessions(tenant_id,id),
  foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
  foreign key (tenant_id,payment_id) references payments(tenant_id,id)
);
create index cash_movements_session_idx on cash_movements(tenant_id,cash_session_id,created_at desc);
-- no máximo um estorno por recebimento — mesma técnica de `stock_movements_sale_item_type_uq`
-- (migration 0011/VEN-03): a garantia contra duplo-estorno vive numa constraint de banco, não
-- numa checagem de aplicação.
create unique index cash_movements_refund_once_uq on cash_movements(payment_id) where type='refund';

-- catálogo global: SEM RLS, mesmo padrão exato de `permissions`/`system_role_templates`
-- (migration 0000) — nenhuma das duas tem RLS porque não há nada tenant-específico a filtrar; o
-- controle de acesso é só por GRANT (SELECT para vetoros_runtime, nenhum INSERT/UPDATE/DELETE —
-- só quem roda migração/seed escreve). RLS aqui seria redundante e, pior, quebraria a própria
-- migração: com `FORCE ROW LEVEL SECURITY`, até `vetoros_migration` (que é `NOBYPASSRLS`) fica
-- sujeito à política — e uma política `FOR SELECT` não cobre o `INSERT` do seed abaixo. Erro real
-- encontrado testando esta migração contra um banco limpo.

alter table cash_registers enable row level security; alter table cash_registers force row level security;
create policy cash_registers_tenant on cash_registers using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());
alter table cash_sessions enable row level security; alter table cash_sessions force row level security;
create policy cash_sessions_tenant on cash_sessions using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());
alter table payments enable row level security; alter table payments force row level security;
create policy payments_tenant on payments using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());
alter table cash_movements enable row level security; alter table cash_movements force row level security;
create policy cash_movements_tenant on cash_movements using (tenant_id=vetoros_current_tenant_id()) with check (tenant_id=vetoros_current_tenant_id());

create function reject_cash_movement_mutation() returns trigger language plpgsql as $$ begin raise exception 'cash_movements is append-only'; end $$;
create trigger cash_movements_append_only before update or delete on cash_movements for each row execute function reject_cash_movement_mutation();
create function reject_payment_mutation() returns trigger language plpgsql as $$ begin raise exception 'payments is append-only'; end $$;
create trigger payments_append_only before update or delete on payments for each row execute function reject_payment_mutation();

-- Abrir sessão: `for update` na linha do caixa serializa duas aberturas concorrentes do MESMO
-- caixa (seção 18); a UNIQUE INDEX PARCIAL acima é quem de fato impede a segunda, mesmo que o
-- lock por si só já ajude bastante. Sem idempotency key própria: uma segunda tentativa de
-- abertura (retry) esbarra na mesma constraint e recebe um erro claro — não duplica; o duplo
-- clique/retry mais sensível financeiramente é `receive_payment`, que trata isso explicitamente.
create function open_cash_session(p_cash_register_id uuid, p_opening_amount numeric)
returns table(session_id uuid, resulting_balance numeric)
language plpgsql security definer set search_path=public as $$
declare v_tenant uuid := vetoros_current_tenant_id(); v_reg cash_registers%rowtype; v_session_id uuid;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if p_opening_amount < 0 then raise exception 'invalid opening amount' using errcode='22023'; end if;
  select * into v_reg from cash_registers where tenant_id=v_tenant and id=p_cash_register_id and status='active' for update;
  if not found then raise exception 'register not found' using errcode='P0002'; end if;
  insert into cash_sessions (tenant_id,company_id,branch_id,cash_register_id,opened_by_identity_id,opening_amount)
    values (v_tenant,v_reg.company_id,v_reg.branch_id,p_cash_register_id,nullif(current_setting('app.actor_identity_id',true),'')::uuid,p_opening_amount)
    returning id into v_session_id;
  insert into cash_movements (tenant_id,company_id,branch_id,cash_session_id,type,amount,resulting_balance,reason,actor_identity_id)
    values (v_tenant,v_reg.company_id,v_reg.branch_id,v_session_id,'opening',p_opening_amount,p_opening_amount,'Abertura de caixa',nullif(current_setting('app.actor_identity_id',true),'')::uuid);
  return query select v_session_id, p_opening_amount;
end $$;

create function close_cash_session(p_cash_session_id uuid, p_closing_amount_informed numeric)
returns table(session_id uuid, expected_amount numeric, closing_amount_informed numeric, difference numeric)
language plpgsql security definer set search_path=public as $$
declare v_tenant uuid := vetoros_current_tenant_id(); v_session cash_sessions%rowtype; v_expected numeric;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if p_closing_amount_informed < 0 then raise exception 'invalid closing amount' using errcode='22023'; end if;
  select * into v_session from cash_sessions where tenant_id=v_tenant and id=p_cash_session_id for update;
  if not found then raise exception 'session not found' using errcode='P0002'; end if;
  if v_session.status <> 'open' then raise exception 'session not open' using errcode='55000'; end if;
  select resulting_balance into v_expected from cash_movements where tenant_id=v_tenant and cash_session_id=p_cash_session_id order by created_at desc, id desc limit 1;
  v_expected := coalesce(v_expected, v_session.opening_amount);
  update cash_sessions set status='closed', closed_at=now(), closed_by_identity_id=nullif(current_setting('app.actor_identity_id',true),'')::uuid,
    closing_amount_informed=p_closing_amount_informed, expected_amount_at_close=v_expected, updated_at=now()
    where id=p_cash_session_id;
  return query select p_cash_session_id, v_expected, p_closing_amount_informed, p_closing_amount_informed - v_expected;
end $$;

-- Recebimento: mesma técnica de idempotência de `service_order_stock_action` (migration 0011) —
-- procura a `idempotency_key` primeiro; se existir e os parâmetros baterem, devolve o resultado
-- já produzido (idempotent=true, nenhuma escrita nova); se os parâmetros forem diferentes para a
-- MESMA chave, é erro (23505) — nunca "sucesso silencioso" sobre uma chave reaproveitada para
-- outra coisa. `for update` na sessão serializa recebimentos concorrentes na MESMA sessão.
--
-- Nota: `returns table(payment_id uuid, movement_id uuid, resulting_balance numeric, ...)`
-- declara `payment_id`/`resulting_balance` como identificadores plpgsql (os parâmetros OUT
-- implícitos da função) — qualquer referência SEM alias a colunas de mesmo nome em `cash_movements`
-- (que tem `payment_id` e `resulting_balance`) vira "column reference is ambiguous" em tempo de
-- execução (erro real encontrado testando esta função). Toda consulta a `cash_movements` aqui usa
-- o alias `cm` por causa disso, mesmo onde não seria estritamente necessário.
--
-- Concorrência real (seção 18, erro encontrado escrevendo o teste de duas requisições
-- concorrentes com a MESMA idempotency_key): a checagem "select ... where idempotency_key=..."
-- acima, sozinha, NÃO é suficiente sob concorrência genuína — duas transações podem passar por
-- ela ao mesmo tempo (nenhuma vê o INSERT da outra ainda), as duas então disputam o lock `for
-- update` da sessão, a primeira insere e comita, a segunda só então prossegue e tentaria inserir
-- a MESMA idempotency_key de novo, batendo em `unique (tenant_id,idempotency_key)` com um erro
-- 23505 cru — que do ponto de vista do cliente é simplesmente "eu repeti a mesma requisição" e
-- deveria devolver o resultado já produzido, não uma falha. A correção é o padrão clássico do
-- Postgres para isso: um loop que tenta o INSERT dentro de um bloco com EXCEPTION WHEN
-- unique_violation — se colidir, o loop volta ao topo, ENCONTRA a linha que a outra transação
-- acabou de comitar, e devolve idempotent=true. O lock da sessão obtido antes do bloco protegido
-- não é liberado pelo rollback do savepoint interno (só o próprio INSERT é desfeito).
create function receive_payment(p_cash_session_id uuid, p_amount numeric, p_payment_method_id uuid, p_sale_id uuid, p_service_order_id uuid, p_notes text, p_idempotency_key text)
returns table(payment_id uuid, movement_id uuid, resulting_balance numeric, idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare v_tenant uuid := vetoros_current_tenant_id(); v_session cash_sessions%rowtype; v_payment_id uuid; v_move_id uuid; v_balance numeric; v_reason text;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  if p_amount <= 0 or length(trim(p_idempotency_key)) < 8 then raise exception 'invalid payment' using errcode='22023'; end if;
  if p_sale_id is not null and p_service_order_id is not null then raise exception 'ambiguous origin' using errcode='22023'; end if;
  loop
    select id into v_payment_id from payments where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
    if found then
      if not exists (select 1 from payments where id=v_payment_id and cash_session_id=p_cash_session_id and amount=p_amount and payment_method_id=p_payment_method_id
          and coalesce(sale_id::text,'') = coalesce(p_sale_id::text,'') and coalesce(service_order_id::text,'') = coalesce(p_service_order_id::text,''))
      then raise exception 'idempotency conflict' using errcode='23505'; end if;
      select cm.id,cm.resulting_balance into v_move_id,v_balance from cash_movements cm where cm.tenant_id=v_tenant and cm.payment_id=v_payment_id and cm.type='receipt';
      return query select v_payment_id, v_move_id, v_balance, true; return;
    end if;
    select * into v_session from cash_sessions where tenant_id=v_tenant and id=p_cash_session_id for update;
    if not found then raise exception 'session not found' using errcode='P0002'; end if;
    if v_session.status <> 'open' then raise exception 'session not open' using errcode='55000'; end if;
    if p_sale_id is not null and not exists (select 1 from sales where tenant_id=v_tenant and id=p_sale_id and status='confirmed') then raise exception 'invalid sale origin' using errcode='23503'; end if;
    if p_service_order_id is not null and not exists (select 1 from service_orders where tenant_id=v_tenant and id=p_service_order_id and status<>'canceled') then raise exception 'invalid service order origin' using errcode='23503'; end if;
    if not exists (select 1 from payment_methods where id=p_payment_method_id and status='active') then raise exception 'invalid payment method' using errcode='23503'; end if;
    select cm.resulting_balance into v_balance from cash_movements cm where cm.tenant_id=v_tenant and cm.cash_session_id=p_cash_session_id order by cm.created_at desc, cm.id desc limit 1;
    v_balance := coalesce(v_balance, v_session.opening_amount) + p_amount;
    begin
      insert into payments (tenant_id,company_id,branch_id,cash_session_id,amount,payment_method_id,sale_id,service_order_id,notes,idempotency_key,created_by_identity_id)
        values (v_tenant,v_session.company_id,v_session.branch_id,p_cash_session_id,p_amount,p_payment_method_id,p_sale_id,p_service_order_id,p_notes,p_idempotency_key,nullif(current_setting('app.actor_identity_id',true),'')::uuid)
        returning id into v_payment_id;
    exception when unique_violation then continue; end;
    v_reason := case when p_sale_id is not null then 'Recebimento de venda' when p_service_order_id is not null then 'Recebimento de ordem de serviço' else 'Recebimento avulso' end;
    insert into cash_movements (tenant_id,company_id,branch_id,cash_session_id,type,amount,resulting_balance,payment_id,reason,actor_identity_id)
      values (v_tenant,v_session.company_id,v_session.branch_id,p_cash_session_id,'receipt',p_amount,v_balance,v_payment_id,v_reason,nullif(current_setting('app.actor_identity_id',true),'')::uuid)
      returning id into v_move_id;
    return query select v_payment_id, v_move_id, v_balance, false;
    return;
  end loop;
end $$;

-- Estorno (seção 9): sempre append-only — nunca apaga/edita o `payments` original nem o
-- `cash_movements` de recebimento. `p_cash_session_id` é a sessão de onde o dinheiro sai AGORA
-- (precisa estar aberta), não necessariamente a mesma sessão do recebimento original (que pode
-- já ter sido fechada) — mesma lógica de uma gaveta física: o estorno sai do caixa que está
-- aberto hoje, não de um caixa fechado ontem. No máximo um estorno por pagamento
-- (`cash_movements_refund_once_uq`) — idempotente: uma segunda chamada para o mesmo pagamento
-- devolve o estorno já existente em vez de tentar duplicar.
--
-- Mesmo problema de concorrência de `receive_payment` (e mesma correção): duas chamadas de
-- estorno concorrentes para o MESMO pagamento podem ambas passar pela checagem "já estornado?"
-- antes de qualquer uma comitar; a que perder a disputa pelo lock `for update` da sessão
-- prosseguiria para inserir depois que a vencedora já comitou, batendo em
-- `cash_movements_refund_once_uq`. O loop com EXCEPTION WHEN unique_violation resolve isso do
-- mesmo jeito: na volta do loop, a checagem "já estornado?" agora encontra a linha e devolve
-- idempotent=true em vez de propagar 23505.
create function refund_payment(p_payment_id uuid, p_cash_session_id uuid, p_reason text)
returns table(movement_id uuid, resulting_balance numeric, idempotent boolean)
language plpgsql security definer set search_path=public as $$
declare v_tenant uuid := vetoros_current_tenant_id(); v_payment payments%rowtype; v_session cash_sessions%rowtype; v_move_id uuid; v_balance numeric;
begin
  if v_tenant is null then raise exception 'tenant context required' using errcode='42501'; end if;
  select * into v_payment from payments where tenant_id=v_tenant and id=p_payment_id;
  if not found then raise exception 'payment not found' using errcode='P0002'; end if;
  loop
    select cm.id,cm.resulting_balance into v_move_id,v_balance from cash_movements cm where cm.tenant_id=v_tenant and cm.payment_id=p_payment_id and cm.type='refund';
    if found then return query select v_move_id, v_balance, true; return; end if;
    select * into v_session from cash_sessions where tenant_id=v_tenant and id=p_cash_session_id for update;
    if not found then raise exception 'session not found' using errcode='P0002'; end if;
    if v_session.status <> 'open' then raise exception 'session not open' using errcode='55000'; end if;
    select cm.resulting_balance into v_balance from cash_movements cm where cm.tenant_id=v_tenant and cm.cash_session_id=p_cash_session_id order by cm.created_at desc, cm.id desc limit 1;
    v_balance := coalesce(v_balance, v_session.opening_amount) - v_payment.amount;
    if v_balance < 0 then raise exception 'insufficient session balance for refund' using errcode='23514'; end if;
    begin
      insert into cash_movements (tenant_id,company_id,branch_id,cash_session_id,type,amount,resulting_balance,payment_id,reason,actor_identity_id)
        values (v_tenant,v_session.company_id,v_session.branch_id,v_session.id,'refund',v_payment.amount,v_balance,p_payment_id,coalesce(nullif(trim(p_reason),''),'Estorno de recebimento'),nullif(current_setting('app.actor_identity_id',true),'')::uuid)
        returning id into v_move_id;
    exception when unique_violation then continue; end;
    return query select v_move_id, v_balance, false;
    return;
  end loop;
end $$;

insert into payment_methods (code,name) values
  ('cash','Dinheiro'), ('pix','PIX'), ('debit_card','Cartão de Débito'), ('credit_card','Cartão de Crédito'),
  ('bank_transfer','Transferência'), ('other','Outra');

insert into permissions (code,module,description) values
  ('cash.read','cash','cash.read'), ('cash.manage','cash','cash.manage'), ('cash.open','cash','cash.open'), ('cash.close','cash','cash.close'),
  ('payments.read','payments','payments.read'), ('payments.create','payments','payments.create'), ('payments.refund','payments','payments.refund')
on conflict (code) do nothing;

grant select on payment_methods to vetoros_runtime;
-- `cash_registers` é configuração simples (nome/status) — INSERT/UPDATE diretos, mesmo padrão de
-- `companies`/`branches`. `cash_sessions`/`payments`/`cash_movements` só mudam de estado através
-- das funções acima (que rodam como `security definer`, com os privilégios de quem as criou) —
-- por isso só SELECT aqui, mesma técnica restritiva de `stock_movements`/
-- `service_order_stock_operations`: nenhum caminho de escrita direto que pudesse contornar o
-- lock/idempotência/invariantes das funções.
grant select,insert,update on cash_registers to vetoros_runtime;
grant select on cash_sessions,payments,cash_movements to vetoros_runtime;
grant execute on function open_cash_session(uuid,numeric) to vetoros_runtime;
grant execute on function close_cash_session(uuid,numeric) to vetoros_runtime;
grant execute on function receive_payment(uuid,numeric,uuid,uuid,uuid,text,text) to vetoros_runtime;
grant execute on function refund_payment(uuid,uuid,text) to vetoros_runtime;
