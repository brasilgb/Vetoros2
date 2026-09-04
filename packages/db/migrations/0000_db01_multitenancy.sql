CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email_normalized text NOT NULL UNIQUE, password_hash text,
  display_name text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('active','blocked','pending')),
  mfa_required boolean NOT NULL DEFAULT false, last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, legal_name text NOT NULL, trade_name text,
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','suspended','cancelled')), default_locale text NOT NULL DEFAULT 'pt-BR',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), identity_id uuid NOT NULL REFERENCES identities(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','revoked')), joined_at timestamptz, expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,id), UNIQUE (tenant_id,identity_id)
);
--> statement-breakpoint
CREATE TABLE tenant_user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, membership_id uuid NOT NULL, name text NOT NULL, phone text, employee_code text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,membership_id), FOREIGN KEY (tenant_id,membership_id) REFERENCES tenant_memberships(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), legal_name text NOT NULL, trade_name text,
  tax_id_type text NOT NULL, tax_id_normalized text NOT NULL, state_registration text, municipal_registration text, tax_regime text,
  currency_code char(3) NOT NULL DEFAULT 'BRL', status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,id), UNIQUE (tenant_id,tax_id_type,tax_id_normalized)
);
--> statement-breakpoint
CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL, code text NOT NULL, name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo', status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')), is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,company_id,id), UNIQUE (tenant_id,company_id,code),
  FOREIGN KEY (tenant_id,company_id) REFERENCES companies(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, module text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE system_role_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL, scope_type text NOT NULL CHECK (scope_type IN ('tenant','company','branch')),
  inherits_descendants boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE system_role_template_permissions (
  role_template_id uuid NOT NULL REFERENCES system_role_templates(id), permission_id uuid NOT NULL REFERENCES permissions(id), PRIMARY KEY (role_template_id,permission_id)
);
--> statement-breakpoint
CREATE TABLE tenant_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), system_role_template_id uuid REFERENCES system_role_templates(id),
  code text NOT NULL, name text NOT NULL, scope_type text NOT NULL CHECK (scope_type IN ('tenant','company','branch')), inherits_descendants boolean NOT NULL DEFAULT false,
  is_system_managed boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,id), UNIQUE (tenant_id,code)
);
--> statement-breakpoint
CREATE TABLE tenant_role_permissions (
  tenant_id uuid NOT NULL, role_id uuid NOT NULL, permission_id uuid NOT NULL REFERENCES permissions(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,role_id,permission_id), FOREIGN KEY (tenant_id,role_id) REFERENCES tenant_roles(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, user_profile_id uuid NOT NULL, role_id uuid NOT NULL,
  scope_type text NOT NULL CHECK ((scope_type='tenant' AND company_id IS NULL AND branch_id IS NULL) OR (scope_type='company' AND company_id IS NOT NULL AND branch_id IS NULL) OR (scope_type='branch' AND company_id IS NOT NULL AND branch_id IS NOT NULL)),
  company_id uuid, branch_id uuid, valid_from timestamptz NOT NULL DEFAULT now(), valid_until timestamptz, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  granted_by_user_profile_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,user_profile_id) REFERENCES tenant_user_profiles(tenant_id,id), FOREIGN KEY (tenant_id,role_id) REFERENCES tenant_roles(tenant_id,id),
  FOREIGN KEY (tenant_id,company_id) REFERENCES companies(tenant_id,id), FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id),
  FOREIGN KEY (tenant_id,granted_by_user_profile_id) REFERENCES tenant_user_profiles(tenant_id,id)
);
--> statement-breakpoint
CREATE INDEX access_grants_profile_idx ON access_grants(tenant_id,user_profile_id);
--> statement-breakpoint
CREATE TABLE branch_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid NOT NULL, user_profile_id uuid NOT NULL,
  job_type text, starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,id), FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id),
  FOREIGN KEY (tenant_id,user_profile_id) REFERENCES tenant_user_profiles(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, actor_identity_id uuid REFERENCES identities(id), effective_user_profile_id uuid,
  action text NOT NULL, resource_type text NOT NULL, resource_id uuid, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), FOREIGN KEY (tenant_id,effective_user_profile_id) REFERENCES tenant_user_profiles(tenant_id,id)
);
--> statement-breakpoint
CREATE INDEX audit_events_tenant_created_idx ON audit_events(tenant_id,created_at DESC);
--> statement-breakpoint
CREATE FUNCTION vetoros_current_tenant_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN current_setting('app.tenant_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN current_setting('app.tenant_id', true)::uuid ELSE NULL END
$$;
--> statement-breakpoint
DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['tenant_memberships','tenant_user_profiles','companies','branches','tenant_roles','tenant_role_permissions','access_grants','branch_memberships','audit_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = vetoros_current_tenant_id()) WITH CHECK (tenant_id = vetoros_current_tenant_id())', table_name);
  END LOOP;
END $rls$;
--> statement-breakpoint
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_events is append-only'; END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
--> statement-breakpoint
DO $grants$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='vetoros_runtime') THEN
    GRANT USAGE ON SCHEMA public TO vetoros_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_memberships, tenant_user_profiles, companies, branches, tenant_roles, tenant_role_permissions, access_grants, branch_memberships TO vetoros_runtime;
    GRANT SELECT, INSERT ON audit_events TO vetoros_runtime;
    GRANT SELECT ON permissions, system_role_templates, system_role_template_permissions TO vetoros_runtime;
    GRANT EXECUTE ON FUNCTION vetoros_current_tenant_id() TO vetoros_runtime;
  END IF;
END $grants$;
