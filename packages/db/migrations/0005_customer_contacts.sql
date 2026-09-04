ALTER TABLE customers ADD COLUMN municipal_registration text;
--> statement-breakpoint
CREATE TABLE customer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  contact_type text NOT NULL CHECK (contact_type IN ('phone','mobile','whatsapp','email')),
  label text,
  value text NOT NULL,
  value_normalized text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_contacts_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT customer_contacts_customer_fk FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_contacts_primary_type_uq ON customer_contacts(tenant_id,customer_id,contact_type) WHERE is_primary;
CREATE INDEX customer_contacts_customer_idx ON customer_contacts(tenant_id,customer_id);
CREATE INDEX customer_contacts_value_idx ON customer_contacts(tenant_id,value_normalized text_pattern_ops);
--> statement-breakpoint
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_contacts USING (tenant_id=vetoros_current_tenant_id()) WITH CHECK (tenant_id=vetoros_current_tenant_id());
--> statement-breakpoint
DO $grants$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='vetoros_runtime') THEN
    GRANT SELECT,INSERT,UPDATE ON customer_contacts TO vetoros_runtime;
  END IF;
END $grants$;
