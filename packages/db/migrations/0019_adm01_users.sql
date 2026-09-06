-- ADM-01: transforma a infraestrutura de Identity/Membership/Profile/Role/Permission (DB-01,
-- AUTH-01, CORE-01) em um módulo administrável. Não cria uma segunda modelagem de usuários —
-- reaproveita integralmente as tabelas existentes. Ver executed.md (seção "Descoberta") para o
-- levantamento completo que justifica cada passo abaixo.

-- 0) Gap confirmado na descoberta (pergunta 8 do correio.md): `vetoros_auth` (migration 0002)
-- só tinha SELECT e UPDATE(last_login_at,updated_at) em `identities` — nunca INSERT. Sem isso,
-- não existe forma de criar um usuário novo sem alterar AUTH-01 mais a fundo. Único grant novo
-- desta migration; não amplia UPDATE nem toca em nenhuma outra tabela de AUTH-01.
DO $grant$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='vetoros_auth') THEN
    GRANT INSERT ON identities TO vetoros_auth;
  END IF;
END $grant$;
--> statement-breakpoint

-- 1) `users.*` são permissions novas (módulo ainda não existia). Nenhuma permission antiga é alterada.
INSERT INTO permissions (code,module,description) VALUES
  ('users.read','users','users.read'), ('users.create','users','users.create'),
  ('users.update','users','users.update'), ('users.manage_roles','users','users.manage_roles')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- 2) e 3) `system_role_template_permissions` (existia desde DB-01, nunca populada) e o
-- provisionamento de `tenant_roles` a partir dos templates NÃO são feitos aqui, por um motivo
-- real encontrado ao testar contra um Postgres limpo (create→migrate→seed do zero, diferente do
-- banco de desenvolvimento já populado onde isso passou despercebido na primeira tentativa):
-- migrations rodam ANTES de `packages/db/src/seed.ts` — nem os `tenants` nem a maior parte dos
-- códigos de `permissions` (customers.read, service_orders.read etc.) existem ainda neste ponto,
-- só as 4 `users.*` inseridas acima. Um mapeamento `system_role_template_permissions` escrito
-- aqui acabaria associando os templates só a essas 4 permissions. Por isso as duas etapas
-- (mapear template→permission e instanciar tenant_roles per tenant) foram movidas para
-- `packages/db/src/seed.ts` (`mapTemplatePermissions`/`provisionRoleTemplates`), chamadas depois
-- que todas as permissions e os tenants já existem — mesma lógica, lugar certo. Uma futura
-- rotina de criação de tenant pela API deve chamar a mesma provisão (pendência em executed.md).

-- 4) Proteção do último administrador (seção 10 do correio.md): nunca pode existir um tenant sem
-- pelo menos um usuário ativo com uma concessão ativa para um papel de código 'owner' ou
-- 'administrator'. Implementada como trigger de banco (não só validação de API/UI) e cobre as
-- duas únicas formas como o ADM-01 tira alguém desse estado: revogar/deletar o access_grant
-- administrativo (troca de papel) e inativar o tenant_user_profile (inativar usuário). Os
-- `SELECT ... FOR UPDATE` antes da contagem existem especificamente para fechar a condição de
-- corrida de dois administradores sendo removidos ao mesmo tempo: cada transação passa a
-- disputar o lock das linhas de access_grants administrativas do tenant, então a segunda só
-- prossegue (e já vê o resultado committado da primeira) depois que a primeira termina.
CREATE FUNCTION protect_last_administrator() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE remaining int;
BEGIN
  IF TG_TABLE_NAME = 'access_grants' THEN
    IF OLD.status <> 'active' THEN RETURN COALESCE(NEW, OLD); END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = 'active' THEN RETURN NEW; END IF;
    IF NOT EXISTS (SELECT 1 FROM tenant_roles WHERE tenant_id=OLD.tenant_id AND id=OLD.role_id AND code IN ('owner','administrator')) THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    PERFORM 1 FROM access_grants g JOIN tenant_roles r ON r.tenant_id=g.tenant_id AND r.id=g.role_id
      WHERE g.tenant_id=OLD.tenant_id AND r.code IN ('owner','administrator') AND g.id<>OLD.id FOR UPDATE OF g;
    SELECT count(*) INTO remaining FROM access_grants g
      JOIN tenant_roles r ON r.tenant_id=g.tenant_id AND r.id=g.role_id
      JOIN tenant_user_profiles p ON p.tenant_id=g.tenant_id AND p.id=g.user_profile_id
      WHERE g.tenant_id=OLD.tenant_id AND r.code IN ('owner','administrator') AND g.id<>OLD.id
        AND g.status='active' AND p.status='active' AND (g.valid_until IS NULL OR g.valid_until>now());
    IF remaining = 0 THEN RAISE EXCEPTION 'last_administrator_protected' USING ERRCODE='VT001'; END IF;
    RETURN COALESCE(NEW, OLD);
  ELSIF TG_TABLE_NAME = 'tenant_user_profiles' THEN
    IF NOT (OLD.status='active' AND NEW.status='inactive') THEN RETURN NEW; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM access_grants g JOIN tenant_roles r ON r.tenant_id=g.tenant_id AND r.id=g.role_id
      WHERE g.tenant_id=OLD.tenant_id AND g.user_profile_id=OLD.id AND r.code IN ('owner','administrator') AND g.status='active'
        AND (g.valid_until IS NULL OR g.valid_until>now())
    ) THEN RETURN NEW; END IF;
    PERFORM 1 FROM access_grants g JOIN tenant_roles r ON r.tenant_id=g.tenant_id AND r.id=g.role_id
      WHERE g.tenant_id=OLD.tenant_id AND r.code IN ('owner','administrator') AND g.user_profile_id<>OLD.id FOR UPDATE OF g;
    SELECT count(*) INTO remaining FROM access_grants g
      JOIN tenant_roles r ON r.tenant_id=g.tenant_id AND r.id=g.role_id
      JOIN tenant_user_profiles p ON p.tenant_id=g.tenant_id AND p.id=g.user_profile_id
      WHERE g.tenant_id=OLD.tenant_id AND r.code IN ('owner','administrator') AND p.id<>OLD.id
        AND g.status='active' AND p.status='active' AND (g.valid_until IS NULL OR g.valid_until>now());
    IF remaining = 0 THEN RAISE EXCEPTION 'last_administrator_protected' USING ERRCODE='VT001'; END IF;
    RETURN NEW;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER access_grants_protect_last_administrator BEFORE UPDATE OR DELETE ON access_grants FOR EACH ROW EXECUTE FUNCTION protect_last_administrator();
--> statement-breakpoint
CREATE TRIGGER tenant_user_profiles_protect_last_administrator BEFORE UPDATE ON tenant_user_profiles FOR EACH ROW EXECUTE FUNCTION protect_last_administrator();
