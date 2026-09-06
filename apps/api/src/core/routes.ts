import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthService, AuthSession, ResourceScope } from '../auth/service.js';
import { requirePermission } from '../auth/service.js';

const idSchema = z.object({ id: z.string().uuid() });
const companyCreate = z.object({ legalName: z.string().min(1).max(200), tradeName: z.string().max(200).nullable().optional(), taxIdType: z.enum(['cpf','cnpj','other']), taxIdNormalized: z.string().min(1).max(32), stateRegistration: z.string().max(32).nullable().optional(), municipalRegistration: z.string().max(32).nullable().optional(), taxRegime: z.string().max(40).nullable().optional(), currencyCode: z.string().length(3).default('BRL') }).strict();
const companyUpdate = companyCreate.pick({ legalName: true, tradeName: true, stateRegistration: true, municipalRegistration: true, taxRegime: true }).partial().extend({ status: z.enum(['active','inactive']).optional() }).strict();
const branchCreate = z.object({ companyId: z.string().uuid(), code: z.string().min(1).max(40), name: z.string().min(1).max(200), timezone: z.string().min(1).max(100).default('America/Sao_Paulo'), isDefault: z.boolean().default(false) }).strict();
const branchUpdate = branchCreate.pick({ name: true, timezone: true, isDefault: true }).partial().extend({ status: z.enum(['active','inactive']).optional() }).strict();
const operationalContext = z.object({ companyId: z.string().uuid(), branchId: z.string().uuid().optional() }).strict();

export function registerCoreRoutes(app: FastifyInstance, service: AuthService) {
  async function authenticated(request: FastifyRequest, reply: FastifyReply): Promise<AuthSession | undefined> {
    const session = await service.session(request.cookies.vetoros_session);
    if (!session) { reply.code(401).send({ error: 'unauthorized' }); return; }
    if (!session.activeTenantId) { reply.code(409).send({ error: 'tenant_required' }); return; }
    return session;
  }
  async function authorize(reply: FastifyReply, session: AuthSession, permission: string, scope: ResourceScope = {}) {
    try { await requirePermission(service, session, permission, scope); return true; }
    catch { reply.code(403).send({ error: 'forbidden' }); return false; }
  }

  app.get('/companies', async (request, reply) => {
    const session = await authenticated(request, reply); if (!session) return;
    return service.withAuthenticatedTenant(session, async (tx) => tx.execute(sql`select c.* from companies c where exists (
      select 1 from access_grants g join tenant_roles r on r.tenant_id=g.tenant_id and r.id=g.role_id join tenant_role_permissions rp on rp.tenant_id=r.tenant_id and rp.role_id=r.id join permissions p on p.id=rp.permission_id
      where g.user_profile_id=${session.activeUserProfileId!} and p.code='companies.read' and g.status='active' and r.status='active' and g.valid_from<=now() and (g.valid_until is null or g.valid_until>now())
        and (g.scope_type='tenant' or (g.scope_type='company' and g.company_id=c.id))) order by c.legal_name`));
  });
  app.get('/companies/:id', async (request, reply) => {
    const params=idSchema.safeParse(request.params); if(!params.success)return reply.code(400).send({error:'invalid_request'}); const session=await authenticated(request,reply);if(!session)return;
    if(!await authorize(reply,session,'companies.read',{companyId:params.data.id}))return;
    const rows=await service.withAuthenticatedTenant(session,tx=>tx.execute(sql`select * from companies where id=${params.data.id}`)); return rows[0]??reply.code(404).send({error:'not_found'});
  });
  app.post('/companies', async (request, reply) => {
    const body=companyCreate.safeParse(request.body);if(!body.success)return reply.code(400).send({error:'invalid_request'});const session=await authenticated(request,reply);if(!session)return;if(!await authorize(reply,session,'companies.create',{requireTenant:true}))return;
    const [row]=await service.withAuthenticatedTenant(session,tx=>tx.execute(sql`insert into companies(tenant_id,legal_name,trade_name,tax_id_type,tax_id_normalized,state_registration,municipal_registration,tax_regime,currency_code) values(${session.activeTenantId!},${body.data.legalName},${body.data.tradeName??null},${body.data.taxIdType},${body.data.taxIdNormalized},${body.data.stateRegistration??null},${body.data.municipalRegistration??null},${body.data.taxRegime??null},${body.data.currencyCode}) returning *`));
    await service.auditResource(session,'company.created','company',String(row!.id));return reply.code(201).send(row);
  });
  app.patch('/companies/:id', async (request, reply) => {
    const params=idSchema.safeParse(request.params),body=companyUpdate.safeParse(request.body);if(!params.success||!body.success||Object.keys(body.data).length===0)return reply.code(400).send({error:'invalid_request'});const session=await authenticated(request,reply);if(!session)return;if(!await authorize(reply,session,'companies.update',{companyId:params.data.id}))return;
    const [row]=await service.withAuthenticatedTenant(session,tx=>tx.execute(sql`update companies set legal_name=coalesce(${body.data.legalName??null},legal_name),trade_name=coalesce(${body.data.tradeName??null},trade_name),status=coalesce(${body.data.status??null},status),updated_at=now() where id=${params.data.id} returning *`));if(!row)return reply.code(404).send({error:'not_found'});await service.auditResource(session,'company.updated','company',params.data.id);return row;
  });

  app.get('/branches', async (request, reply) => {
    const session=await authenticated(request,reply);if(!session)return;return service.withAuthenticatedTenant(session,tx=>tx.execute(sql`select b.* from branches b where exists (
      select 1 from access_grants g join tenant_roles r on r.tenant_id=g.tenant_id and r.id=g.role_id join tenant_role_permissions rp on rp.tenant_id=r.tenant_id and rp.role_id=r.id join permissions p on p.id=rp.permission_id
      where g.user_profile_id=${session.activeUserProfileId!} and p.code='branches.read' and g.status='active' and r.status='active' and g.valid_from<=now() and (g.valid_until is null or g.valid_until>now()) and (g.scope_type='tenant' or (g.scope_type='company' and g.company_id=b.company_id) or (g.scope_type='branch' and g.branch_id=b.id))) order by b.name`));
  });
  app.get('/branches/:id', async (request, reply) => {
    // ADM-01 seção 19: antes este endpoint devolvia só {id,company_id} (o restante dos campos só
    // existia na listagem) — apps/web/app/app/branches/[id]/page.tsx tinha que buscar TODAS as
    // filiais e procurar a certa. Corrigido para devolver os mesmos campos da listagem; o
    // workaround no frontend foi removido junto (ver Implementação/"Correção de Branch").
    const params=idSchema.safeParse(request.params);if(!params.success)return reply.code(400).send({error:'invalid_request'});const session=await authenticated(request,reply);if(!session)return;const [target]=await service.withAuthenticatedTenant(session,tx=>tx.execute(sql`select * from branches where id=${params.data.id}`));if(!target)return reply.code(404).send({error:'not_found'});if(!await authorize(reply,session,'branches.read',{companyId:String(target.company_id),branchId:params.data.id}))return;return target;
  });
  app.post('/branches', async (request, reply) => {
    const body=branchCreate.safeParse(request.body);if(!body.success)return reply.code(400).send({error:'invalid_request'});const session=await authenticated(request,reply);if(!session)return;if(!await authorize(reply,session,'branches.create',{companyId:body.data.companyId}))return;
    const companyExists=await service.withAuthenticatedTenant(session,tx=>tx.execute(sql`select id from companies where id=${body.data.companyId} and status='active'`));if(companyExists.length===0)return reply.code(404).send({error:'company_not_found'});
    const [row]=await service.withAuthenticatedTenant(session,tx=>tx.execute(sql`insert into branches(tenant_id,company_id,code,name,timezone,is_default) values(${session.activeTenantId!},${body.data.companyId},${body.data.code},${body.data.name},${body.data.timezone},${body.data.isDefault}) returning *`));await service.auditResource(session,'branch.created','branch',String(row!.id),{companyId:body.data.companyId});return reply.code(201).send(row);
  });
  app.patch('/branches/:id', async (request, reply) => {
    const params=idSchema.safeParse(request.params),body=branchUpdate.safeParse(request.body);if(!params.success||!body.success||Object.keys(body.data).length===0)return reply.code(400).send({error:'invalid_request'});const session=await authenticated(request,reply);if(!session)return;const [target]=await service.withAuthenticatedTenant(session,tx=>tx.execute(sql`select id,company_id from branches where id=${params.data.id}`));if(!target)return reply.code(404).send({error:'not_found'});if(!await authorize(reply,session,'branches.update',{companyId:String(target.company_id),branchId:params.data.id}))return;
    const [row]=await service.withAuthenticatedTenant(session,tx=>tx.execute(sql`update branches set name=coalesce(${body.data.name??null},name),timezone=coalesce(${body.data.timezone??null},timezone),status=coalesce(${body.data.status??null},status),is_default=coalesce(${body.data.isDefault??null},is_default),updated_at=now() where id=${params.data.id} returning *`));await service.auditResource(session,'branch.updated','branch',params.data.id);return row;
  });
  app.post('/auth/operational-context', async (request, reply) => { const body=operationalContext.safeParse(request.body);if(!body.success)return reply.code(400).send({error:'invalid_request'});const session=await authenticated(request,reply);if(!session)return;const updated=await service.selectOperationalContext(session,{companyId:body.data.companyId,...(body.data.branchId?{branchId:body.data.branchId}:{})});if(!updated)return reply.code(403).send({error:'context_forbidden'});return {companyId:updated.activeCompanyId,branchId:updated.activeBranchId}; });
}
