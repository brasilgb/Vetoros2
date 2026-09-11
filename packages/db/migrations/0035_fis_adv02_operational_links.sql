-- FIS-ADV-02: uma origem operacional possui no máximo um documento fiscal.
-- A garantia fica no banco para cobrir UI, API, retries e futuras entradas.
create unique index fiscal_documents_one_sale_origin_uq
  on fiscal_documents(tenant_id, origin_sale_id)
  where origin_sale_id is not null;

create unique index fiscal_documents_one_service_order_origin_uq
  on fiscal_documents(tenant_id, origin_service_order_id)
  where origin_service_order_id is not null;
