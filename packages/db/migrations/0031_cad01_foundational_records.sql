-- CAD-01: cadastros fundamentais e integridade inequívoca de itens.

CREATE TABLE product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120), status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by_identity_id uuid REFERENCES identities(id), updated_by_identity_id uuid REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id)
);
CREATE UNIQUE INDEX product_categories_name_uq ON product_categories(tenant_id,lower(name));
CREATE INDEX product_categories_list_idx ON product_categories(tenant_id,status,name);

CREATE TABLE product_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120), status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by_identity_id uuid REFERENCES identities(id), updated_by_identity_id uuid REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id)
);
CREATE UNIQUE INDEX product_brands_name_uq ON product_brands(tenant_id,lower(name));
CREATE INDEX product_brands_list_idx ON product_brands(tenant_id,status,name);

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY product_categories_tenant ON product_categories USING (tenant_id=vetoros_current_tenant_id()) WITH CHECK (tenant_id=vetoros_current_tenant_id());
ALTER TABLE product_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_brands FORCE ROW LEVEL SECURITY;
CREATE POLICY product_brands_tenant ON product_brands USING (tenant_id=vetoros_current_tenant_id()) WITH CHECK (tenant_id=vetoros_current_tenant_id());

ALTER TABLE inventory_parts
  ADD COLUMN category_id uuid,
  ADD COLUMN brand_id uuid,
  ADD COLUMN barcode_ean text,
  ADD COLUMN minimum_stock numeric(16,3) NOT NULL DEFAULT 0,
  ADD COLUMN default_location text,
  ADD COLUMN ncm char(8),
  ADD CONSTRAINT inventory_parts_category_fk FOREIGN KEY (tenant_id,category_id) REFERENCES product_categories(tenant_id,id),
  ADD CONSTRAINT inventory_parts_brand_fk FOREIGN KEY (tenant_id,brand_id) REFERENCES product_brands(tenant_id,id),
  ADD CONSTRAINT inventory_parts_minimum_stock_ck CHECK (minimum_stock>=0),
  ADD CONSTRAINT inventory_parts_barcode_ck CHECK (barcode_ean IS NULL OR barcode_ean ~ '^[0-9]{8,14}$'),
  ADD CONSTRAINT inventory_parts_ncm_ck CHECK (ncm IS NULL OR ncm ~ '^[0-9]{8}$');
CREATE UNIQUE INDEX inventory_parts_barcode_uq ON inventory_parts(tenant_id,barcode_ean) WHERE barcode_ean IS NOT NULL;
CREATE INDEX inventory_parts_category_idx ON inventory_parts(tenant_id,category_id,status);
CREATE INDEX inventory_parts_brand_idx ON inventory_parts(tenant_id,brand_id,status);

ALTER TABLE companies
  ADD COLUMN phone text,
  ADD COLUMN email text,
  ADD COLUMN postal_code text,
  ADD COLUMN street text,
  ADD COLUMN address_number text,
  ADD COLUMN address_complement text,
  ADD COLUMN district text,
  ADD COLUMN city text,
  ADD COLUMN state char(2),
  ADD COLUMN country char(2) NOT NULL DEFAULT 'BR',
  ADD COLUMN logo_url text,
  ADD CONSTRAINT companies_email_ck CHECK (email IS NULL OR position('@' in email)>1),
  ADD CONSTRAINT companies_state_ck CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT companies_country_ck CHECK (country ~ '^[A-Z]{2}$');

ALTER TABLE branches
  ADD COLUMN phone text,
  ADD COLUMN email text,
  ADD COLUMN postal_code text,
  ADD COLUMN street text,
  ADD COLUMN address_number text,
  ADD COLUMN address_complement text,
  ADD COLUMN district text,
  ADD COLUMN city text,
  ADD COLUMN state char(2),
  ADD COLUMN country char(2) NOT NULL DEFAULT 'BR',
  ADD CONSTRAINT branches_email_ck CHECK (email IS NULL OR position('@' in email)>1),
  ADD CONSTRAINT branches_state_ck CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT branches_country_ck CHECK (country ~ '^[A-Z]{2}$');
-- Compatibilidade: se dados antigos tiverem mais de uma filial padrão, mantém a mais antiga
-- de cada empresa e normaliza as demais antes de criar a garantia concorrente.
WITH ranked AS (
  SELECT id,row_number() OVER (PARTITION BY tenant_id,company_id ORDER BY created_at,id) AS position
  FROM branches WHERE is_default
)
UPDATE branches SET is_default=false,updated_at=now()
WHERE id IN (SELECT id FROM ranked WHERE position>1);
CREATE UNIQUE INDEX branches_one_default_per_company_uq ON branches(tenant_id,company_id) WHERE is_default;

ALTER TABLE customer_assets
  ADD COLUMN acquired_at date,
  ADD COLUMN warranty_until date,
  ADD COLUMN warranty_notes text,
  ADD COLUMN received_accessories text,
  ADD COLUMN intake_condition text;

ALTER TABLE suppliers
  ADD COLUMN commercial_terms text,
  ADD COLUMN default_lead_time_days integer,
  ADD CONSTRAINT suppliers_default_lead_time_ck CHECK (default_lead_time_days IS NULL OR default_lead_time_days>=0);

-- O dado legado não pode permanecer ambíguo. Um item antigo marcado como peça sem produto
-- passa a ser material não estocável; somente `part` representa estoque a partir daqui.
ALTER TABLE quote_items ADD COLUMN inventory_part_id uuid;
UPDATE quote_items SET type='non_stock' WHERE type='part';
ALTER TABLE quote_items DROP CONSTRAINT IF EXISTS quote_items_type_check;
ALTER TABLE quote_items
  ADD CONSTRAINT quote_items_type_ck CHECK (type IN ('service','part','non_stock')),
  ADD CONSTRAINT quote_items_inventory_part_fk FOREIGN KEY (tenant_id,inventory_part_id) REFERENCES inventory_parts(tenant_id,id),
  ADD CONSTRAINT quote_items_inventory_type_ck CHECK ((type='part' AND inventory_part_id IS NOT NULL) OR (type IN ('service','non_stock') AND inventory_part_id IS NULL));
CREATE INDEX quote_items_inventory_part_idx ON quote_items(tenant_id,inventory_part_id) WHERE inventory_part_id IS NOT NULL;

UPDATE service_order_items SET type='non_stock' WHERE type='part' AND inventory_part_id IS NULL;
ALTER TABLE service_order_items DROP CONSTRAINT IF EXISTS service_order_items_type_check;
ALTER TABLE service_order_items DROP CONSTRAINT IF EXISTS service_order_items_inventory_part_type_ck;
ALTER TABLE service_order_items
  ADD CONSTRAINT service_order_items_type_ck CHECK (type IN ('service','part','non_stock')),
  ADD CONSTRAINT service_order_items_inventory_type_ck CHECK ((type='part' AND inventory_part_id IS NOT NULL) OR (type IN ('service','non_stock') AND inventory_part_id IS NULL));

UPDATE sale_items SET type='non_stock' WHERE type='part' AND inventory_part_id IS NULL;
ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS sale_items_type_check;
ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS sale_items_inventory_part_id_check;
ALTER TABLE sale_items
  ADD CONSTRAINT sale_items_type_ck CHECK (type IN ('service','part','non_stock')),
  ADD CONSTRAINT sale_items_inventory_type_ck CHECK ((type='part' AND inventory_part_id IS NOT NULL) OR (type IN ('service','non_stock') AND inventory_part_id IS NULL));

GRANT SELECT,INSERT,UPDATE ON product_categories,product_brands TO vetoros_runtime;
