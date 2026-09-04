CREATE TABLE customer_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, customer_id uuid NOT NULL,
  internal_identifier text NOT NULL, category text NOT NULL, brand text, model text, serial_number text, imei text, asset_tag text, description text, notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','retired')),
  origin_company_id uuid, origin_branch_id uuid, created_by_identity_id uuid REFERENCES identities(id), updated_by_identity_id uuid REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_assets_tenant_id_id_uq UNIQUE (tenant_id,id), CONSTRAINT customer_assets_identifier_uq UNIQUE (tenant_id,internal_identifier),
  CONSTRAINT customer_assets_customer_fk FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT customer_assets_company_fk FOREIGN KEY (tenant_id,origin_company_id) REFERENCES companies(tenant_id,id),
  CONSTRAINT customer_assets_branch_fk FOREIGN KEY (tenant_id,origin_company_id,origin_branch_id) REFERENCES branches(tenant_id,company_id,id), CONSTRAINT customer_assets_origin_ck CHECK (origin_branch_id IS NULL OR origin_company_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX customer_assets_customer_idx ON customer_assets(tenant_id,customer_id); CREATE INDEX customer_assets_search_idx ON customer_assets(tenant_id,lower(brand),lower(model),serial_number text_pattern_ops);
--> statement-breakpoint
CREATE TABLE customer_asset_identifiers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, asset_id uuid NOT NULL, identifier_type text NOT NULL, value text NOT NULL, value_normalized text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT customer_asset_identifiers_tenant_id_id_uq UNIQUE (tenant_id,id), CONSTRAINT customer_asset_identifiers_asset_fk FOREIGN KEY (tenant_id,asset_id) REFERENCES customer_assets(tenant_id,id) ON DELETE RESTRICT, CONSTRAINT customer_asset_identifiers_uq UNIQUE (tenant_id,identifier_type,value_normalized));
--> statement-breakpoint
CREATE INDEX customer_asset_identifiers_asset_idx ON customer_asset_identifiers(tenant_id,asset_id); CREATE INDEX customer_asset_identifiers_value_idx ON customer_asset_identifiers(tenant_id,value_normalized text_pattern_ops);
--> statement-breakpoint
ALTER TABLE customer_assets ENABLE ROW LEVEL SECURITY; ALTER TABLE customer_assets FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON customer_assets USING (tenant_id=vetoros_current_tenant_id()) WITH CHECK (tenant_id=vetoros_current_tenant_id());
ALTER TABLE customer_asset_identifiers ENABLE ROW LEVEL SECURITY; ALTER TABLE customer_asset_identifiers FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON customer_asset_identifiers USING (tenant_id=vetoros_current_tenant_id()) WITH CHECK (tenant_id=vetoros_current_tenant_id());
--> statement-breakpoint
DO $grants$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname='vetoros_runtime') THEN GRANT SELECT,INSERT,UPDATE ON customer_assets,customer_asset_identifiers TO vetoros_runtime; END IF; END $grants$;
