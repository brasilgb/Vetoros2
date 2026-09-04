CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES identities(id),
  token_hash text NOT NULL UNIQUE,
  active_tenant_id uuid,
  active_membership_id uuid,
  active_user_profile_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((active_tenant_id IS NULL AND active_membership_id IS NULL AND active_user_profile_id IS NULL) OR
         (active_tenant_id IS NOT NULL AND active_membership_id IS NOT NULL AND active_user_profile_id IS NOT NULL)),
  FOREIGN KEY (active_tenant_id,active_membership_id) REFERENCES tenant_memberships(tenant_id,id),
  FOREIGN KEY (active_tenant_id,active_user_profile_id) REFERENCES tenant_user_profiles(tenant_id,id)
);
--> statement-breakpoint
CREATE INDEX auth_sessions_identity_status_idx ON auth_sessions(identity_id,status,expires_at);
--> statement-breakpoint
CREATE POLICY auth_membership_self ON tenant_memberships FOR SELECT TO vetoros_auth
USING (identity_id::text = NULLIF(current_setting('app.actor_identity_id', true), ''));
--> statement-breakpoint
CREATE POLICY auth_profile_self ON tenant_user_profiles FOR SELECT TO vetoros_auth
USING (EXISTS (
  SELECT 1 FROM tenant_memberships membership
  WHERE membership.tenant_id=tenant_user_profiles.tenant_id
    AND membership.id=tenant_user_profiles.membership_id
    AND membership.identity_id::text=NULLIF(current_setting('app.actor_identity_id', true), '')
));
--> statement-breakpoint
DO $grants$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='vetoros_auth') THEN
    GRANT USAGE ON SCHEMA public TO vetoros_auth;
    GRANT SELECT, UPDATE (last_login_at,updated_at) ON identities TO vetoros_auth;
    GRANT SELECT ON tenants, tenant_memberships, tenant_user_profiles TO vetoros_auth;
    GRANT SELECT, INSERT, UPDATE (active_tenant_id,active_membership_id,active_user_profile_id,status,revoked_at,last_seen_at) ON auth_sessions TO vetoros_auth;
  END IF;
END $grants$;
