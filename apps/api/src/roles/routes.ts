import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthService, AuthSession } from '../auth/service.js';
import { requirePermission } from '../auth/service.js';

// ADM-02 — ver executed.md "Descoberta". `tenant_roles` já distinguia papel de sistema de
// personalizado de forma inequívoca desde DB-01 (`system_role_template_id` nullable +
// `is_system_managed`) — nenhuma tabela nova aqui, só o CRUD que faltava sobre a estrutura
// existente (`Permission → Role → RolePermission → AccessGrant → UserProfile`, seção 2 do
// correio.md). Papéis de sistema (os 9 templates instanciados no ADM-01) nunca são criados,
// editados ou excluídos por este arquivo — são só consultados; a proteção correspondente
// também existe no banco (migration 0020, trigger `tenant_roles_protect_system`), então mesmo
// um bug aqui não conseguiria alterá-los.

const idSchema = z.object({ id: z.string().uuid() });
const listSchema = z.object({ search: z.string().trim().max(100).optional() }).strict();
const roleCreate = z.object({ name: z.string().trim().min(1).max(120), permissionIds: z.array(z.string().uuid()).max(200).default([]) }).strict();
const roleUpdate = z.object({ name: z.string().trim().min(1).max(120).optional(), status: z.enum(['active', 'inactive']).optional(), permissionIds: z.array(z.string().uuid()).max(200).optional() }).strict();

const isSystemRoleProtected = (error: unknown) => { const c = error as { code?: string; cause?: { code?: string } } | null; return c?.code === 'VT002' || c?.cause?.code === 'VT002'; };
const isForeignKeyViolation = (error: unknown) => { const c = error as { code?: string; cause?: { code?: string } } | null; return c?.code === '23503' || c?.cause?.code === '23503'; };

/** Gera um `code` técnico interno para um papel personalizado — o usuário nunca digita um
 * (seção 6 do correio.md). Prefixo `custom_` garante, por construção, que nunca colide com os 9
 * códigos reservados dos templates de sistema (owner/administrator/...), que não usam esse
 * prefixo — é essa distinção que `protect_last_administrator()` (ADM-01) depende via `code IN
 * ('owner','administrator')`. */
function generateRoleCode(name: string): string {
  const slug = name.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'papel';
  return `custom_${slug}_${randomBytes(3).toString('hex')}`;
}

const grantCountSelect = sql`(select count(*) from access_grants g join tenant_user_profiles p on p.tenant_id=g.tenant_id and p.id=g.user_profile_id where g.tenant_id=r.tenant_id and g.role_id=r.id and g.status='active' and p.status='active')::int as grant_count`;

/** Checa nome de papel duplicado no tenant (case-insensitive) antes de criar/renomear — uma
 * nicety de UX (evitar dois papéis com o mesmo nome no seletor), não um invariante de segurança,
 * por isso é uma checagem de aplicação e não uma constraint de banco (ver migration 0020 para o
 * motivo: várias suítes de teste de rodadas anteriores já inserem `tenant_roles` ad hoc com
 * nomes fixos, e uma UNIQUE colidiria com esse padrão pré-existente entre execuções). */
async function nameTaken(service: AuthService, session: AuthSession, name: string, excludeId?: string): Promise<boolean> {
  const rows = await service.withAuthenticatedTenant(session, (tx) => tx.execute<{ id: string }>(sql`select id from tenant_roles where tenant_id=${session.activeTenantId!} and lower(name)=lower(${name}) ${excludeId ? sql`and id<>${excludeId}` : sql``}`));
  return rows.length > 0;
}

export function registerRoleRoutes(app: FastifyInstance, service: AuthService) {
  async function authenticated(request: FastifyRequest, reply: FastifyReply): Promise<AuthSession | undefined> {
    const session = await service.session(request.cookies.vetoros_session);
    if (!session) { reply.code(401).send({ error: 'unauthorized' }); return; }
    if (!session.activeTenantId) { reply.code(409).send({ error: 'tenant_required' }); return; }
    return session;
  }
  // Seção 10 do correio.md: leitura usa `users.read`; qualquer alteração de papel/matriz usa
  // `users.manage_roles` — nunca `users.update` (esse é só para editar dados do usuário, ADM-01).
  async function authorize(reply: FastifyReply, session: AuthSession, permission: string) {
    try { await requirePermission(service, session, permission, { requireTenant: true }); return true; }
    catch { reply.code(403).send({ error: 'forbidden' }); return false; }
  }

  app.get('/permissions', async (request, reply) => {
    const session = await authenticated(request, reply); if (!session) return;
    if (!await authorize(reply, session, 'users.read')) return;
    return service.withAuthenticatedTenant(session, (tx) => tx.execute(sql`select id,code,module,description from permissions order by module,code`));
  });

  app.get('/roles', async (request, reply) => {
    const query = listSchema.safeParse(request.query); if (!query.success) return reply.code(400).send({ error: 'invalid_request' });
    const session = await authenticated(request, reply); if (!session) return;
    if (!await authorize(reply, session, 'users.read')) return;
    const namePrefix = query.data.search ? `${query.data.search.toLocaleLowerCase('pt-BR')}%` : null;
    const rows = await service.withAuthenticatedTenant(session, (tx) => tx.execute<{ id: string; code: string; name: string; is_system_managed: boolean; status: string; grant_count: number }>(sql`
      select r.id,r.code,r.name,r.is_system_managed,r.status,${grantCountSelect}
      from tenant_roles r
      where (${namePrefix}::text is null or lower(r.name) like ${namePrefix})
      order by r.is_system_managed desc, r.name`));
    return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, isSystemManaged: row.is_system_managed, status: row.status, grantCount: row.grant_count }));
  });

  app.get('/roles/:id', async (request, reply) => {
    const params = idSchema.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    const session = await authenticated(request, reply); if (!session) return;
    if (!await authorize(reply, session, 'users.read')) return;
    const [role, permissionRows] = await service.withAuthenticatedTenant(session, async (tx) => {
      const [r] = await tx.execute<{ id: string; code: string; name: string; is_system_managed: boolean; status: string; grant_count: number }>(sql`select r.id,r.code,r.name,r.is_system_managed,r.status,${grantCountSelect} from tenant_roles r where r.id=${params.data.id}`);
      const p = r ? await tx.execute<{ permission_id: string }>(sql`select permission_id from tenant_role_permissions where tenant_id=${session.activeTenantId!} and role_id=${params.data.id}`) : [];
      return [r, p] as const;
    });
    if (!role) return reply.code(404).send({ error: 'not_found' });
    return { id: role.id, code: role.code, name: role.name, isSystemManaged: role.is_system_managed, status: role.status, grantCount: role.grant_count, permissionIds: permissionRows.map((p) => p.permission_id) };
  });

  app.post('/roles', async (request, reply) => {
    const body = roleCreate.safeParse(request.body); if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    const session = await authenticated(request, reply); if (!session) return;
    if (!await authorize(reply, session, 'users.manage_roles')) return;
    if (body.data.permissionIds.length > 0) {
      const found = await service.withAuthenticatedTenant(session, (tx) => tx.execute<{ id: string }>(sql`select id from permissions where id in (${sql.join(body.data.permissionIds.map((id) => sql`${id}::uuid`), sql`,`)})`));
      if (found.length !== new Set(body.data.permissionIds).size) return reply.code(400).send({ error: 'invalid_permission' });
    }
    if (await nameTaken(service, session, body.data.name)) return reply.code(409).send({ error: 'role_name_already_exists' });
    const code = generateRoleCode(body.data.name);
    const { role, codes } = await service.withAuthenticatedTenant(session, async (tx) => {
      const [created] = await tx.execute<{ id: string; code: string; name: string; status: string }>(sql`insert into tenant_roles (tenant_id,code,name,scope_type,inherits_descendants,is_system_managed,status) values (${session.activeTenantId!},${code},${body.data.name},'tenant',false,false,'active') returning id,code,name,status`);
      if (body.data.permissionIds.length > 0) await tx.execute(sql`insert into tenant_role_permissions (tenant_id,role_id,permission_id) select ${session.activeTenantId!},${created!.id},x.id from (values ${sql.join(body.data.permissionIds.map((id) => sql`(${id}::uuid)`), sql`,`)}) as x(id)`);
      const grantedCodes = body.data.permissionIds.length > 0 ? (await tx.execute<{ code: string }>(sql`select code from permissions where id in (${sql.join(body.data.permissionIds.map((id) => sql`${id}::uuid`), sql`,`)})`)).map((p) => p.code) : [];
      return { role: created!, codes: grantedCodes };
    });
    await service.auditResource(session, 'role.created', 'tenant_role', role.id, { permissions: codes });
    return reply.code(201).send({ id: role.id, code: role.code, name: role.name, status: role.status, isSystemManaged: false, grantCount: 0, permissionIds: body.data.permissionIds });
  });

  app.patch('/roles/:id', async (request, reply) => {
    const params = idSchema.safeParse(request.params), body = roleUpdate.safeParse(request.body);
    if (!params.success || !body.success || Object.keys(body.data).length === 0) return reply.code(400).send({ error: 'invalid_request' });
    const session = await authenticated(request, reply); if (!session) return;
    if (!await authorize(reply, session, 'users.manage_roles')) return;
    const requestedPermissionIds = body.data.permissionIds;
    if (requestedPermissionIds && requestedPermissionIds.length > 0) {
      const found = await service.withAuthenticatedTenant(session, (tx) => tx.execute<{ id: string }>(sql`select id from permissions where id in (${sql.join(requestedPermissionIds.map((id) => sql`${id}::uuid`), sql`,`)})`));
      if (found.length !== new Set(requestedPermissionIds).size) return reply.code(400).send({ error: 'invalid_permission' });
    }
    if (body.data.name !== undefined && await nameTaken(service, session, body.data.name, params.data.id)) return reply.code(409).send({ error: 'role_name_already_exists' });
    try {
      const result = await service.withAuthenticatedTenant(session, async (tx) => {
        const [current] = await tx.execute<{ id: string; is_system_managed: boolean }>(sql`select id,is_system_managed from tenant_roles where id=${params.data.id}`);
        if (!current) return { notFound: true as const };
        if (current.is_system_managed) return { forbidden: true as const };
        let nameChanged = false;
        if (body.data.name !== undefined) { await tx.execute(sql`update tenant_roles set name=${body.data.name},updated_at=now() where id=${params.data.id}`); nameChanged = true; }
        if (body.data.status !== undefined) await tx.execute(sql`update tenant_roles set status=${body.data.status},updated_at=now() where id=${params.data.id}`);
        let added: string[] = [], removed: string[] = [];
        if (body.data.permissionIds !== undefined) {
          const before = (await tx.execute<{ code: string }>(sql`select pe.code from tenant_role_permissions rp join permissions pe on pe.id=rp.permission_id where rp.tenant_id=${session.activeTenantId!} and rp.role_id=${params.data.id}`)).map((r) => r.code);
          await tx.execute(sql`delete from tenant_role_permissions where tenant_id=${session.activeTenantId!} and role_id=${params.data.id}`);
          let after: string[] = [];
          if (body.data.permissionIds.length > 0) {
            await tx.execute(sql`insert into tenant_role_permissions (tenant_id,role_id,permission_id) select ${session.activeTenantId!},${params.data.id},x.id from (values ${sql.join(body.data.permissionIds.map((id) => sql`(${id}::uuid)`), sql`,`)}) as x(id)`);
            after = (await tx.execute<{ code: string }>(sql`select code from permissions where id in (${sql.join(body.data.permissionIds.map((id) => sql`${id}::uuid`), sql`,`)})`)).map((r) => r.code);
          }
          const beforeSet = new Set(before), afterSet = new Set(after);
          added = after.filter((c) => !beforeSet.has(c));
          removed = before.filter((c) => !afterSet.has(c));
        }
        return { nameChanged, permissionsChanged: body.data.permissionIds !== undefined, added, removed };
      });
      if ('notFound' in result) return reply.code(404).send({ error: 'not_found' });
      if ('forbidden' in result) return reply.code(403).send({ error: 'system_role_protected', message: 'Papéis de sistema não podem ser alterados.' });
      if (result.nameChanged) await service.auditResource(session, 'role.updated', 'tenant_role', params.data.id, {});
      if (result.permissionsChanged) await service.auditResource(session, 'role.permissions_changed', 'tenant_role', params.data.id, { added: result.added, removed: result.removed });
      const [row] = await service.withAuthenticatedTenant(session, (tx) => tx.execute<{ id: string; code: string; name: string; is_system_managed: boolean; status: string; grant_count: number }>(sql`select r.id,r.code,r.name,r.is_system_managed,r.status,${grantCountSelect} from tenant_roles r where r.id=${params.data.id}`));
      const permissionIds = (await service.withAuthenticatedTenant(session, (tx) => tx.execute<{ permission_id: string }>(sql`select permission_id from tenant_role_permissions where tenant_id=${session.activeTenantId!} and role_id=${params.data.id}`))).map((p) => p.permission_id);
      return { id: row!.id, code: row!.code, name: row!.name, isSystemManaged: row!.is_system_managed, status: row!.status, grantCount: row!.grant_count, permissionIds };
    } catch (error) {
      if (isSystemRoleProtected(error)) return reply.code(403).send({ error: 'system_role_protected', message: 'Papéis de sistema não podem ser alterados.' });
      throw error;
    }
  });

  app.delete('/roles/:id', async (request, reply) => {
    const params = idSchema.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    const session = await authenticated(request, reply); if (!session) return;
    if (!await authorize(reply, session, 'users.manage_roles')) return;
    try {
      const result = await service.withAuthenticatedTenant(session, async (tx) => {
        const [current] = await tx.execute<{ id: string; is_system_managed: boolean }>(sql`select id,is_system_managed from tenant_roles where id=${params.data.id}`);
        if (!current) return 'not_found' as const;
        if (current.is_system_managed) return 'forbidden' as const;
        await tx.execute(sql`delete from tenant_role_permissions where tenant_id=${session.activeTenantId!} and role_id=${params.data.id}`);
        await tx.execute(sql`delete from tenant_roles where id=${params.data.id}`);
        return 'deleted' as const;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (result === 'forbidden') return reply.code(403).send({ error: 'system_role_protected', message: 'Papéis de sistema não podem ser excluídos.' });
      await service.auditResource(session, 'role.deleted', 'tenant_role', params.data.id, {});
      return reply.code(204).send();
    } catch (error) {
      // FK de access_grants → tenant_roles bloqueia a exclusão física se o papel já foi
      // concedido a alguém alguma vez (mesmo que hoje revogado) — preserva o histórico de
      // auditoria em vez de deixar `access_grants` órfão (seção 12 do correio.md). O caminho
      // correto para "remover de uso" quando isso acontece é inativar (`status='inactive'`),
      // que já é o suficiente para o papel sumir do seletor de `/app/users` (`GET /roles`
      // filtra por status='active').
      if (isForeignKeyViolation(error)) return reply.code(409).send({ error: 'role_in_use', message: 'Este papel já foi atribuído a algum usuário e não pode ser excluído — inative-o para impedir novas atribuições.' });
      throw error;
    }
  });
}
