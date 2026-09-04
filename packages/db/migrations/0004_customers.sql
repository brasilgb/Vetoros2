CREATE TABLE customer_number_counters (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  customer_number bigint NOT NULL,
  person_type text NOT NULL CHECK (person_type IN ('individual','company')),
  legal_name text NOT NULL CHECK (length(legal_name) BETWEEN 1 AND 200),
  trade_name text,
  document_type text CHECK (document_type IN ('cpf','cnpj')),
  document_normalized text,
  rg_state_registration text,
  phone text,
  mobile text,
  whatsapp text,
  email text,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  origin_company_id uuid,
  origin_branch_id uuid,
  created_by_identity_id uuid REFERENCES identities(id),
  updated_by_identity_id uuid REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT customers_number_uq UNIQUE (tenant_id,customer_number),
  CONSTRAINT customers_document_shape_ck CHECK (
    (document_normalized IS NULL AND document_type IS NULL) OR
    (document_type='cpf' AND person_type='individual' AND document_normalized ~ '^[0-9]{11}$') OR
    (document_type='cnpj' AND person_type='company' AND document_normalized ~ '^[0-9]{14}$')
  ),
  CONSTRAINT customers_origin_company_fk FOREIGN KEY (tenant_id,origin_company_id) REFERENCES companies(tenant_id,id),
  CONSTRAINT customers_origin_branch_fk FOREIGN KEY (tenant_id,origin_company_id,origin_branch_id) REFERENCES branches(tenant_id,company_id,id),
  CONSTRAINT customers_origin_ck CHECK (origin_branch_id IS NULL OR origin_company_id IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX customers_document_uq ON customers(tenant_id,document_type,document_normalized) WHERE document_normalized IS NOT NULL;
CREATE INDEX customers_name_search_idx ON customers(tenant_id,lower(legal_name) text_pattern_ops);
CREATE INDEX customers_trade_name_search_idx ON customers(tenant_id,lower(trade_name) text_pattern_ops) WHERE trade_name IS NOT NULL;
CREATE INDEX customers_document_search_idx ON customers(tenant_id,document_normalized text_pattern_ops) WHERE document_normalized IS NOT NULL;
CREATE INDEX customers_number_search_idx ON customers(tenant_id,customer_number);
--> statement-breakpoint
CREATE TABLE customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  address_type text NOT NULL DEFAULT 'main' CHECK (address_type IN ('main','billing','shipping','other')),
  postal_code text,
  street text NOT NULL,
  number text,
  complement text,
  district text,
  city text NOT NULL,
  state char(2),
  country char(2) NOT NULL DEFAULT 'BR',
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_addresses_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT customer_addresses_customer_fk FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX customer_addresses_primary_uq ON customer_addresses(tenant_id,customer_id) WHERE is_primary;
CREATE INDEX customer_addresses_customer_idx ON customer_addresses(tenant_id,customer_id);
--> statement-breakpoint
ALTER TABLE customer_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_number_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_number_counters USING (tenant_id=vetoros_current_tenant_id()) WITH CHECK (tenant_id=vetoros_current_tenant_id());
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers USING (tenant_id=vetoros_current_tenant_id()) WITH CHECK (tenant_id=vetoros_current_tenant_id());
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_addresses USING (tenant_id=vetoros_current_tenant_id()) WITH CHECK (tenant_id=vetoros_current_tenant_id());
--> statement-breakpoint
DO $grants$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='vetoros_runtime') THEN
    GRANT SELECT,INSERT,UPDATE ON customer_number_counters TO vetoros_runtime;
    GRANT SELECT,INSERT,UPDATE ON customers,customer_addresses TO vetoros_runtime;
  END IF;
END $grants$;
