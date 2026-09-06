import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthService, AuthSession } from '../auth/service.js';
import { requirePermission } from '../auth/service.js';

// ADM-01 — ver executed.md "Descoberta" para as respostas completas às perguntas arquiteturais.
// Resumo do que este arquivo assume (não reinventa nada): um usuário do tenant é a combinação
// Identity (global, e-mail/senha, fora de RLS) + tenant_membership (vínculo com o tenant) +
// tenant_user_profile (nome/status dentro do tenant) + um access_grant ativo apontando para um
// tenant_role (o "papel"). Não existe edição de permission individual nem multi-role nesta
// rodada — "Papel" é sempre um único `<select>` (seção 18 do correio.md).

const idSchema = z.object({ id: z.string().uuid() });
const listSchema = z.object({ search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict();
const userCreate = z.object({ name: z.string().trim().min(1).max(200), email: z.string().trim().toLowerCase().email().max(254), roleId: z.string().uuid(), status: z.enum(['active', 'inactive']).default('active') }).strict();
const userUpdate = z.object({ name: z.string().trim().min(1).max(200).optional(), roleId: z.string().uuid().optional(), status: z.enum(['active', 'inactive']).optional() }).strict();

const isDuplicate = (error: unknown) => { if (typeof error !== 'object' || !error) return false; const candidate = error as { code?: string; cause?: { code?: string } }; return candidate.code === '23505' || candidate.cause?.code === '23505'; };
const isLastAdministratorProtected = (error: unknown) => { if (typeof error !== 'object' || !error) return false; const candidate = error as { code?: string; cause?: { code?: string } }; return candidate.code === 'VT001' || candidate.cause?.code === 'VT001'; };

// Uma linha de `tenant_user_profiles` + o papel ativo (0 ou 1 — nunca multi-role nesta rodada),
// resolvida com LEFT JOIN LATERAL para o access_grant ativo mais recente. E-mail/último acesso
// não vêm daqui — moram em `identities`, fora do alcance de RLS do vetoros_runtime (ver
// AuthService.identitiesByIds), então são resolvidos à parte e combinados em memória.
const roleLateral = sql`left join lateral (
  select r.id as role_id, r.code as role_code, r.name as role_name from access_grants g
  join tenant_roles r on r.tenant_id=g.tenant_id and r.id=g.role_id
  where g.user_profile_id=p.id and g.status='active' and (g.valid_until is null or g.valid_until>now())
  order by g.created_at desc limit 1
) ag on true`;

export function registerUserRoutes(app: FastifyInstance, service: AuthService) {
  async function authenticated(request: FastifyRequest, reply: FastifyReply): Promise<AuthSession | undefined> {
    const session = await service.session(request.cookies.vetoros_session);
    if (!session) { reply.code(401).send({ error: 'unauthorized' }); return; }
    if (!session.activeTenantId) { reply.code(409).send({ error: 'tenant_required' }); return; }
    return session;
  }
  async function authorize(reply: FastifyReply, session: AuthSession, permission: string) {
    try { await requirePermission(service, session, permission, { requireTenant: true }); return true; }
    catch { reply.code(403).send({ error: 'forbidden' }); return false; }
  }
  async function withEmails<T extends { identity_id: string }>(rows: T[]) {
    const identities = await service.identitiesByIds([...new Set(rows.map((row) => row.identity_id))]);
    const byId = new Map(identities.map((identity) => [identity.id, identity]));
    return rows.map((row) => ({ ...row, identity: byId.get(row.identity_id) }));
  }

  // `GET /roles` e o resto do CRUD de papéis moraram aqui até o ADM-02 — agora vivem em
  // `../roles/routes.ts`, que cresceu o suficiente para merecer seu próprio módulo.

  app.get('/users', async (request, reply) => {
    const query = listSchema.safeParse(request.query); if (!query.success) return reply.code(400).send({ error: 'invalid_request' });
    const session = await authenticated(request, reply); if (!session) return;
    if (!await authorize(reply, session, 'users.read')) return;
    const { search, page, pageSize } = query.data, offset = (page - 1) * pageSize;
    const matchedIdentityIds = search ? await service.findIdentityIdsByEmailPrefix(`${search.toLowerCase()}%`) : [];
    // O `sql` tag do drizzle não serializa um array JS puro como parâmetro de `= any(...)` (vira
    // `any(())`, SQL inválido) — `sql.join` monta um `IN (...)` explícito, uma linha por id.
    const identityMatch = matchedIdentityIds.length > 0 ? sql`m.identity_id in (${sql.join(matchedIdentityIds.map((id) => sql`${id}::uuid`), sql`,`)})` : sql`false`;
    const namePrefix = search ? `${search.toLocaleLowerCase('pt-BR')}%` : null;
    const rows = await service.withAuthenticatedTenant(session, (tx) => tx.execute<{ id: string; name: string; status: string; identity_id: string; role_id: string | null; role_code: string | null; role_name: string | null; total: number }>(sql`
      select p.id,p.name,p.status,m.identity_id,ag.role_id,ag.role_code,ag.role_name,count(*) over()::int as total
      from tenant_user_profiles p join tenant_memberships m on m.tenant_id=p.tenant_id and m.id=p.membership_id
      ${roleLateral}
      where (${namePrefix}::text is null or lower(p.name) like ${namePrefix} or ${identityMatch})
      order by p.name limit ${pageSize} offset ${offset}`));
    const merged = await withEmails(rows);
    return {
      items: merged.map((row) => ({ id: row.id, name: row.name, status: row.status, email: row.identity?.emailNormalized ?? null, lastLoginAt: row.identity?.lastLoginAt ?? null, role: row.role_id ? { id: row.role_id, code: row.role_code, name: row.role_name } : null })),
      page, pageSize, total: Number(rows[0]?.total ?? 0),
    };
  });

  app.get('/users/:id', async (request, reply) => {
    const params = idSchema.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    const session = await authenticated(request, reply); if (!session) return;
    if (!await authorize(reply, session, 'users.read')) return;
    const [row] = await service.withAuthenticatedTenant(session, (tx) => tx.execute<{ id: string; name: string; status: string; identity_id: string; role_id: string | null; role_code: string | null; role_name: string | null }>(sql`
      select p.id,p.name,p.status,m.identity_id,ag.role_id,ag.role_code,ag.role_name
      from tenant_user_profiles p join tenant_memberships m on m.tenant_id=p.tenant_id and m.id=p.membership_id ${roleLateral}
      where p.id=${params.data.id}`));
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const [identity] = await service.identitiesByIds([row.identity_id]);
    const permissions = await service.withAuthenticatedTenant(session, (tx) => tx.execute<{ code: string; module: string; description: string | null }>(sql`
      select distinct pe.code,pe.module,pe.description from access_grants g
      join tenant_roles r on r.tenant_id=g.tenant_id and r.id=g.role_id
      join tenant_role_permissions rp on rp.tenant_id=r.tenant_id and rp.role_id=r.id
      join permissions pe on pe.id=rp.permission_id
      where g.user_profile_id=${params.data.id} and g.status='active' and r.status='active' and (g.valid_until is null or g.valid_until>now())
      order by pe.module,pe.code`));
    return { id: row.id, name: row.name, status: row.status, email: identity?.emailNormalized ?? null, lastLoginAt: identity?.lastLoginAt ?? null, identityStatus: identity?.status ?? null, role: row.role_id ? { id: row.role_id, code: row.role_code, name: row.role_name } : null, permissions };
  });

  app.post('/users', async (request, reply) => {
    const body = userCreate.safeParse(request.body); if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    const session = await authenticated(request, reply); if (!session) return;
    if (!await authorize(reply, session, 'users.create')) return;
    const roleExists = await service.withAuthenticatedTenant(session, (tx) => tx.execute(sql`select id from tenant_roles where id=${body.data.roleId} and status='active'`));
    if (roleExists.length === 0) return reply.code(400).send({ error: 'invalid_role' });
    const identity = await service.findOrCreateIdentity(body.data.email, body.data.name);
    try {
      const profile = await service.withAuthenticatedTenant(session, async (tx) => {
        const existingMembership = await tx.execute(sql`select id from tenant_memberships where tenant_id=${session.activeTenantId!} and identity_id=${identity.id}`);
        if (existingMembership.length > 0) throw Object.assign(new Error('membership_already_exists'), { code: 'MEMBERSHIP_EXISTS' });
        const [membership] = await tx.execute<{ id: string }>(sql`insert into tenant_memberships (tenant_id,identity_id,status) values (${session.activeTenantId!},${identity.id},'active') returning id`);
        const [created] = await tx.execute<{ id: string; name: string; status: string }>(sql`insert into tenant_user_profiles (tenant_id,membership_id,name,status) values (${session.activeTenantId!},${membership!.id},${body.data.name},${body.data.status}) returning id,name,status`);
        await tx.execute(sql`insert into access_grants (tenant_id,user_profile_id,role_id,scope_type,granted_by_user_profile_id) values (${session.activeTenantId!},${created!.id},${body.data.roleId},'tenant',${session.activeUserProfileId!})`);
        return created!;
      });
      await service.auditResource(session, 'user.created', 'tenant_user_profile', profile.id, { roleId: body.data.roleId, identityReused: !identity.isNew });
      return reply.code(201).send({ id: profile.id, name: profile.name, status: profile.status, email: body.data.email, ...(identity.isNew ? { temporaryPassword: identity.temporaryPassword } : {}) });
    } catch (error) {
      if (isDuplicate(error) || (error instanceof Error && error.message === 'membership_already_exists')) return reply.code(409).send({ error: 'membership_already_exists' });
      throw error;
    }
  });

  app.patch('/users/:id', async (request, reply) => {
    const params = idSchema.safeParse(request.params), body = userUpdate.safeParse(request.body);
    if (!params.success || !body.success || Object.keys(body.data).length === 0) return reply.code(400).send({ error: 'invalid_request' });
    const session = await authenticated(request, reply); if (!session) return;
    if (!await authorize(reply, session, 'users.update')) return;
    if (body.data.roleId) {
      const roleExists = await service.withAuthenticatedTenant(session, (tx) => tx.execute(sql`select id from tenant_roles where id=${body.data.roleId} and status='active'`));
      if (roleExists.length === 0) return reply.code(400).send({ error: 'invalid_role' });
    }
    try {
      const result = await service.withAuthenticatedTenant(session, async (tx) => {
        const [current] = await tx.execute<{ id: string; status: string }>(sql`select id,status from tenant_user_profiles where id=${params.data.id}`);
        if (!current) return null;
        const [currentGrant] = await tx.execute<{ role_id: string }>(sql`select role_id from access_grants where user_profile_id=${params.data.id} and status='active' order by created_at desc limit 1`);
        const roleChanged = body.data.roleId !== undefined && body.data.roleId !== currentGrant?.role_id;
        const statusChanged = body.data.status !== undefined && body.data.status !== current.status;
        if (body.data.name !== undefined) await tx.execute(sql`update tenant_user_profiles set name=${body.data.name},updated_at=now() where id=${params.data.id}`);
        if (body.data.status !== undefined) await tx.execute(sql`update tenant_user_profiles set status=${body.data.status},updated_at=now() where id=${params.data.id}`);
        if (roleChanged) {
          await tx.execute(sql`update access_grants set status='revoked' where user_profile_id=${params.data.id} and status='active'`);
          await tx.execute(sql`insert into access_grants (tenant_id,user_profile_id,role_id,scope_type,granted_by_user_profile_id) values (${session.activeTenantId!},${params.data.id},${body.data.roleId},'tenant',${session.activeUserProfileId!})`);
        }
        return { roleChanged, statusChanged };
      });
      if (!result) return reply.code(404).send({ error: 'not_found' });
      if (result.statusChanged) await service.auditResource(session, 'user.status_changed', 'tenant_user_profile', params.data.id, { status: body.data.status });
      if (result.roleChanged) await service.auditResource(session, 'user.role_changed', 'tenant_user_profile', params.data.id, { roleId: body.data.roleId });
      if (body.data.name !== undefined) await service.auditResource(session, 'user.profile_updated', 'tenant_user_profile', params.data.id, {});
      const [row] = await service.withAuthenticatedTenant(session, (tx) => tx.execute<{ id: string; name: string; status: string; identity_id: string; role_id: string | null; role_code: string | null; role_name: string | null }>(sql`
        select p.id,p.name,p.status,m.identity_id,ag.role_id,ag.role_code,ag.role_name
        from tenant_user_profiles p join tenant_memberships m on m.tenant_id=p.tenant_id and m.id=p.membership_id ${roleLateral}
        where p.id=${params.data.id}`));
      return { id: row!.id, name: row!.name, status: row!.status, role: row!.role_id ? { id: row!.role_id, code: row!.role_code, name: row!.role_name } : null };
    } catch (error) {
      if (isLastAdministratorProtected(error)) return reply.code(409).send({ error: 'last_administrator_protected', message: 'O tenant precisa manter ao menos um administrador ativo.' });
      throw error;
    }
  });
}
