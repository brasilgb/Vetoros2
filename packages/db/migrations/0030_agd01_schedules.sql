INSERT INTO permissions (code,module,description) VALUES
 ('schedules.read','schedules','Consultar agenda operacional'),
 ('schedules.create','schedules','Criar agendamento operacional'),
 ('schedules.update','schedules','Editar ou reagendar atendimento'),
 ('schedules.cancel','schedules','Cancelar agendamento operacional') ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
CREATE TABLE schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid NOT NULL,
 service_order_id uuid, customer_id uuid NOT NULL, asset_id uuid, responsible_user_profile_id uuid,
 starts_at timestamptz NOT NULL, ends_at timestamptz, status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','canceled')),
 notes text, created_by_identity_id uuid REFERENCES identities(id), updated_by_identity_id uuid REFERENCES identities(id),
 canceled_by_identity_id uuid REFERENCES identities(id), canceled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,id),
 CHECK (ends_at IS NULL OR ends_at > starts_at),
 CHECK ((status='scheduled' AND canceled_at IS NULL AND canceled_by_identity_id IS NULL) OR (status='canceled' AND canceled_at IS NOT NULL AND canceled_by_identity_id IS NOT NULL)),
 FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id),
 FOREIGN KEY (tenant_id,service_order_id) REFERENCES service_orders(tenant_id,id), FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
 FOREIGN KEY (tenant_id,asset_id) REFERENCES customer_assets(tenant_id,id),
 FOREIGN KEY (tenant_id,responsible_user_profile_id) REFERENCES tenant_user_profiles(tenant_id,id)
);
--> statement-breakpoint
CREATE INDEX schedules_branch_start_idx ON schedules(tenant_id,branch_id,starts_at,id);
--> statement-breakpoint
CREATE INDEX schedules_responsible_start_idx ON schedules(tenant_id,branch_id,responsible_user_profile_id,starts_at) WHERE status='scheduled' AND responsible_user_profile_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX schedules_service_order_idx ON schedules(tenant_id,service_order_id) WHERE service_order_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION validate_schedule_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_order service_orders%ROWTYPE;
BEGIN
 IF NEW.service_order_id IS NOT NULL THEN
  SELECT * INTO linked_order FROM service_orders WHERE tenant_id=NEW.tenant_id AND id=NEW.service_order_id;
  IF NOT FOUND OR linked_order.branch_id<>NEW.branch_id OR linked_order.company_id<>NEW.company_id THEN RAISE EXCEPTION 'schedule_service_order_scope_mismatch' USING ERRCODE='23514'; END IF;
  IF linked_order.customer_id<>NEW.customer_id THEN RAISE EXCEPTION 'schedule_service_order_customer_mismatch' USING ERRCODE='23514'; END IF;
  IF linked_order.asset_id IS NOT NULL AND linked_order.asset_id IS DISTINCT FROM NEW.asset_id THEN RAISE EXCEPTION 'schedule_service_order_asset_mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customer_assets a WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.asset_id AND a.customer_id=NEW.customer_id) THEN RAISE EXCEPTION 'schedule_asset_customer_mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.responsible_user_profile_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM tenant_user_profiles p JOIN tenant_memberships m ON m.tenant_id=p.tenant_id AND m.id=p.membership_id
  JOIN access_grants g ON g.tenant_id=p.tenant_id AND g.user_profile_id=p.id JOIN tenant_roles r ON r.tenant_id=g.tenant_id AND r.id=g.role_id
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.responsible_user_profile_id AND p.status='active' AND m.status='active' AND r.status='active' AND g.status='active'
   AND g.valid_from<=now() AND (g.valid_until IS NULL OR g.valid_until>now())
   AND (g.scope_type='tenant' OR (g.scope_type='company' AND g.company_id=NEW.company_id) OR (g.scope_type='branch' AND g.company_id=NEW.company_id AND g.branch_id=NEW.branch_id))
 ) THEN RAISE EXCEPTION 'schedule_responsible_not_authorized' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER schedules_validate_links BEFORE INSERT OR UPDATE OF tenant_id,company_id,branch_id,service_order_id,customer_id,asset_id,responsible_user_profile_id ON schedules FOR EACH ROW EXECUTE FUNCTION validate_schedule_links();
--> statement-breakpoint
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE schedules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY schedules_tenant_isolation ON schedules USING (tenant_id=vetoros_current_tenant_id()) WITH CHECK (tenant_id=vetoros_current_tenant_id());
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON schedules TO vetoros_runtime;
