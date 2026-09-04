ALTER TABLE auth_sessions ADD COLUMN active_company_id uuid;
--> statement-breakpoint
ALTER TABLE auth_sessions ADD COLUMN active_branch_id uuid;
--> statement-breakpoint
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_active_company_fk FOREIGN KEY (active_tenant_id,active_company_id) REFERENCES companies(tenant_id,id);
--> statement-breakpoint
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_active_branch_fk FOREIGN KEY (active_tenant_id,active_company_id,active_branch_id) REFERENCES branches(tenant_id,company_id,id);
--> statement-breakpoint
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_operational_context_ck CHECK (active_branch_id IS NULL OR active_company_id IS NOT NULL);
--> statement-breakpoint
DO $grants$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='vetoros_auth') THEN
    GRANT UPDATE (active_company_id,active_branch_id) ON auth_sessions TO vetoros_auth;
  END IF;
END $grants$;
