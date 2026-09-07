-- VEN-01: fecha o contrato comercial do cabeçalho sem alterar os efeitos físicos de VEN-02
-- nem os estornos de VEN-03. `created_at` continua sendo data técnica; `sale_date` é a data
-- comercial informada pelo operador.
alter table sales
  add column sale_date date not null default current_date,
  add column subtotal numeric(14,2) not null default 0,
  add column discount_total numeric(14,2) not null default 0,
  add column total numeric(14,2) not null default 0,
  add constraint sales_totals_nonnegative check(subtotal>=0 and discount_total>=0 and total>=0),
  add constraint sales_totals_consistent check(total=subtotal-discount_total);

-- A tabela de itens é a fonte de verdade dos totais. O frontend e a API nunca conseguem
-- gravar um total arbitrário no cabeçalho; qualquer INSERT/UPDATE/DELETE recalcula o snapshot
-- agregado dentro da mesma transação PostgreSQL.
create function refresh_sale_totals() returns trigger
language plpgsql set search_path=public as $$
declare v_sale_id uuid := coalesce(new.sale_id,old.sale_id);
begin
  update sales s set
    subtotal=coalesce(a.subtotal,0),
    discount_total=coalesce(a.discount_total,0),
    total=coalesce(a.total,0)
  from (
    select
      round(coalesce(sum(si.quantity*si.unit_price),0),2)::numeric(14,2) subtotal,
      round(coalesce(sum(si.discount_amount),0),2)::numeric(14,2) discount_total,
      round(coalesce(sum(si.total),0),2)::numeric(14,2) total
    from sale_items si where si.sale_id=v_sale_id
  ) a
  where s.id=v_sale_id;
  return coalesce(new,old);
end $$;

create trigger sale_items_refresh_totals
after insert or update or delete on sale_items
for each row execute function refresh_sale_totals();

-- Backfill dos documentos existentes antes de a nova projeção ser consumida pela API.
update sales s set
  subtotal=a.subtotal,
  discount_total=a.discount_total,
  total=a.total
from (
  select
    s0.id,
    round(coalesce(sum(si.quantity*si.unit_price),0),2)::numeric(14,2) subtotal,
    round(coalesce(sum(si.discount_amount),0),2)::numeric(14,2) discount_total,
    round(coalesce(sum(si.total),0),2)::numeric(14,2) total
  from sales s0 left join sale_items si on si.sale_id=s0.id
  group by s0.id
) a
where s.id=a.id;

create index sales_sale_date_idx on sales(tenant_id,sale_date desc,sale_number desc);
