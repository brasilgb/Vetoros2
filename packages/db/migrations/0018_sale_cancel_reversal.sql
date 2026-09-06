-- VEN-03: o estorno de cancelamento reaproveita a MESMA coluna sale_item_id da saída original
-- (VEN-02) para se referenciar a ela, em vez de uma coluna/FK nova dedicada a apontar para o
-- movimento original. A saída fica com type='exit' e o estorno com type='entry', ambos com o
-- mesmo sale_item_id; `type` já basta para distinguir uma da outra (seção 4/21 do VEN-03: a
-- estrutura existente já permite identificar o estorno inequivocamente, sem precisar de
-- referência explícita nova).
--
-- O índice único anterior (sale_item_id) — criado em 0017 para impedir uma segunda SAÍDA do
-- mesmo item — agora precisa admitir também a ENTRADA de estorno subsequente. Trocado por
-- unique(sale_item_id, type): continua impedindo uma segunda saída (dupla confirmação) e passa
-- a impedir, com a mesma força estrutural, um segundo estorno (dupla cancelamento) — nenhuma
-- das duas garantias depende só de `if (status === 'cancelled')` na aplicação (seção 7/12).
drop index stock_movements_sale_item_uq;
create unique index stock_movements_sale_item_type_uq on stock_movements(sale_item_id,type) where sale_item_id is not null;
