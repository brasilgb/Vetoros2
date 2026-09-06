-- ADM-02: administração de Papéis e Permissões sobre a arquitetura RBAC já consolidada em
-- DB-01/AUTH-01/ADM-01. Nenhuma tabela nova, nenhum segundo mecanismo RBAC — ver executed.md
-- "Descoberta" para o levantamento completo. `tenant_roles` já distingue papel de sistema de
-- papel customizado de forma inequívoca desde DB-01 (`system_role_template_id` nullable +
-- `is_system_managed`), então nenhuma coluna nova foi necessária para isso.
--
-- Nome de papel duplicado dentro do tenant (uma nicety de UX, não um invariante de segurança —
-- ao contrário da proteção do último administrador) é checado em `apps/api/src/roles/routes.ts`
-- antes de cada INSERT/UPDATE, não com uma constraint aqui: várias suítes de rodadas anteriores
-- (`sales.integration.test.ts`, `core.integration.test.ts`, `customers.integration.test.ts`)
-- já inserem `tenant_roles` ad hoc via SQL direto com nomes fixos como fixture de teste — uma
-- UNIQUE de banco sobre `(tenant_id, lower(name))` colidiria com esse padrão pré-existente ao
-- rodar a suíte mais de uma vez contra o mesmo banco (uma constraint pertence ao domínio real,
-- não a como um teste não relacionado nomeia sua fixture descartável).

-- Proteção de papéis de sistema no banco, não só na API (mesmo espírito de
-- `protect_last_administrator()` do ADM-01, seção 4 do correio.md ADM-02: "se for necessário
-- proteger invariantes no banco, fazê-lo no banco"). `owner`/`administrator` — cuja proteção
-- específica o ADM-01 já depende via `code IN ('owner','administrator')` em
-- `protect_last_administrator()` — ficam automaticamente cobertos por esta regra mais ampla, sem
-- precisar de uma segunda regra especial só para os dois: NENHUM papel de sistema (os 9
-- templates instanciados) pode ser renomeado, ter suas permissions alteradas, ser inativado ou
-- excluído por este módulo. Só a API de seed (que nunca faz UPDATE em papel já existente, só
-- INSERT quando ainda não existe — ver `provisionRoleTemplates` em seed.ts) escreve nessas linhas.
CREATE FUNCTION reject_system_role_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'system_role_protected' USING ERRCODE='VT002';
END $$;
--> statement-breakpoint
CREATE TRIGGER tenant_roles_protect_system BEFORE UPDATE OR DELETE ON tenant_roles
  FOR EACH ROW WHEN (OLD.is_system_managed) EXECUTE FUNCTION reject_system_role_mutation();
