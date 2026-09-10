import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthService, AuthSession, ResourceScope } from '../auth/service.js';
import { requirePermission } from '../auth/service.js';

const idSchema = z.object({ id: z.string().uuid() });
const optionalText=(max:number)=>z.string().trim().max(max).nullable().optional();
const contactAddress={phone:optionalText(30),email:z.string().trim().toLowerCase().email().max(254).nullable().optional(),postalCode:z.string().trim().regex(/^[0-9]{8}$/).nullable().optional(),street:optionalText(200),addressNumber:optionalText(30),addressComplement:optionalText(100),district:optionalText(100),city:optionalText(100),state:z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable().optional(),country:z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default('BR')};
const companyCreate = z.object({ legalName: z.string().trim().min(1).max(200), tradeName: optionalText(200), taxIdType: z.enum(['cpf','cnpj','other']), taxIdNormalized: z.string().trim().min(1).max(32), stateRegistration: optionalText(32), municipalRegistration: optionalText(32), taxRegime: optionalText(40), currencyCode: z.string().length(3).default('BRL'),...contactAddress,logoUrl:z.string().trim().url().max(1000).nullable().optional() }).strict();
const companyUpdate = companyCreate.omit({taxIdType:true,taxIdNormalized:true,currencyCode:true}).partial().extend({ status: z.enum(['active','inactive']).optional() }).strict();
const branchCreate = z.object({ companyId: z.string().uuid(), code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(200), timezone: z.string().trim().min(1).max(100).default('America/Sao_Paulo'), isDefault: z.boolean().default(false),...contactAddress }).strict();
const branchUpdate = branchCreate.omit({companyId:true,code:true}).partial().extend({ status: z.enum(['active','inactive']).optional() }).strict();
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
    const [row]=await service.withAuthenticatedTenant(session,tx=>tx.execute(sql`insert into companies(tenant_id,legal_name,trade_name,tax_id_type,tax_id_normalized,state_registration,municipal_registration,tax_regime,currency_code,phone,email,postal_code,street,address_number,address_complement,district,city,state,country,logo_url) values(${session.activeTenantId!},${body.data.legalName},${body.data.tradeName??null},${body.data.taxIdType},${body.data.taxIdNormalized},${body.data.stateRegistration??null},${body.data.municipalRegistration??null},${body.data.taxRegime??null},${body.data.currencyCode},${body.data.phone??null},${body.data.email??null},${body.data.postalCode??null},${body.data.street??null},${body.data.addressNumber??null},${body.data.addressComplement??null},${body.data.district??null},${body.data.city??null},${body.data.state??null},${body.data.country},${body.data.logoUrl??null}) returning *`));
    await service.auditResource(session,'company.created','company',String(row!.id));return reply.code(201).send(row);
  });
  app.patch('/companies/:id', async (request, reply) => {
    const params=idSchema.safeParse(request.params),body=companyUpdate.safeParse(request.body);if(!params.success||!body.success||Object.keys(body.data).length===0)return reply.code(400).send({error:'invalid_request'});const session=await authenticated(request,reply);if(!session)return;if(!await authorize(reply,session,'companies.update',{companyId:params.data.id}))return;
    const [row]=await service.withAuthenticatedTenant(session,tx=>tx.execute(sql`update companies set legal_name=coalesce(${body.data.legalName??null},legal_name),trade_name=case when ${'tradeName'in body.data} then ${body.data.tradeName??null} else trade_name end,state_registration=case when ${'stateRegistration'in body.data} then ${body.data.stateRegistration??null} else state_registration end,municipal_registration=case when ${'municipalRegistration'in body.data} then ${body.data.municipalRegistration??null} else municipal_registration end,tax_regime=case when ${'taxRegime'in body.data} then ${body.data.taxRegime??null} else tax_regime end,phone=case when ${'phone'in body.data} then ${body.data.phone??null} else phone end,email=case when ${'email'in body.data} then ${body.data.email??null} else email end,postal_code=case when ${'postalCode'in body.data} then ${body.data.postalCode??null} else postal_code end,street=case when ${'street'in body.data} then ${body.data.street??null} else street end,address_number=case when ${'addressNumber'in body.data} then ${body.data.addressNumber??null} else address_number end,address_complement=case when ${'addressComplement'in body.data} then ${body.data.addressComplement??null} else address_complement end,district=case when ${'district'in body.data} then ${body.data.district??null} else district end,city=case when ${'city'in body.data} then ${body.data.city??null} else city end,state=case when ${'state'in body.data} then ${body.data.state??null} else state end,country=coalesce(${body.data.country??null},country),logo_url=case when ${'logoUrl'in body.data} then ${body.data.logoUrl??null} else logo_url end,status=coalesce(${body.data.status??null},status),updated_at=now() where id=${params.data.id} returning *`));if(!row)return reply.code(404).send({error:'not_found'});await service.auditResource(session,'company.updated','company',params.data.id);return row;
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
    const row=await service.withAuthenticatedTenant(session,async tx=>{if(body.data.isDefault)await tx.execute(sql`update branches set is_default=false,updated_at=now() where company_id=${body.data.companyId} and is_default`);return tx.execute(sql`insert into branches(tenant_id,company_id,code,name,timezone,is_default,phone,email,postal_code,street,address_number,address_complement,district,city,state,country) values(${session.activeTenantId!},${body.data.companyId},${body.data.code},${body.data.name},${body.data.timezone},${body.data.isDefault},${body.data.phone??null},${body.data.email??null},${body.data.postalCode??null},${body.data.street??null},${body.data.addressNumber??null},${body.data.addressComplement??null},${body.data.district??null},${body.data.city??null},${body.data.state??null},${body.data.country}) returning *`).then(rows=>rows[0]);});await service.auditResource(session,'branch.created','branch',String(row!.id),{companyId:body.data.companyId,isDefault:body.data.isDefault});return reply.code(201).send(row);
  });
  app.patch('/branches/:id', async (request, reply) => {
    const params=idSchema.safeParse(request.params),body=branchUpdate.safeParse(request.body);if(!params.success||!body.success||Object.keys(body.data).length===0)return reply.code(400).send({error:'invalid_request'});const session=await authenticated(request,reply);if(!session)return;const [target]=await service.withAuthenticatedTenant(session,tx=>tx.execute(sql`select id,company_id from branches where id=${params.data.id}`));if(!target)return reply.code(404).send({error:'not_found'});if(!await authorize(reply,session,'branches.update',{companyId:String(target.company_id),branchId:params.data.id}))return;
    const row=await service.withAuthenticatedTenant(session,async tx=>{if(body.data.isDefault)await tx.execute(sql`update branches set is_default=false,updated_at=now() where company_id=${target.company_id} and id<>${params.data.id} and is_default`);const[updated]=await tx.execute(sql`update branches set name=coalesce(${body.data.name??null},name),timezone=coalesce(${body.data.timezone??null},timezone),status=coalesce(${body.data.status??null},status),is_default=coalesce(${body.data.isDefault??null},is_default),phone=case when ${'phone'in body.data} then ${body.data.phone??null} else phone end,email=case when ${'email'in body.data} then ${body.data.email??null} else email end,postal_code=case when ${'postalCode'in body.data} then ${body.data.postalCode??null} else postal_code end,street=case when ${'street'in body.data} then ${body.data.street??null} else street end,address_number=case when ${'addressNumber'in body.data} then ${body.data.addressNumber??null} else address_number end,address_complement=case when ${'addressComplement'in body.data} then ${body.data.addressComplement??null} else address_complement end,district=case when ${'district'in body.data} then ${body.data.district??null} else district end,city=case when ${'city'in body.data} then ${body.data.city??null} else city end,state=case when ${'state'in body.data} then ${body.data.state??null} else state end,country=coalesce(${body.data.country??null},country),updated_at=now() where id=${params.data.id} returning *`);return updated;});await service.auditResource(session,'branch.updated','branch',params.data.id,{isDefault:body.data.isDefault});return row;
  });
  app.post('/auth/operational-context', async (request, reply) => { const body=operationalContext.safeParse(request.body);if(!body.success)return reply.code(400).send({error:'invalid_request'});const session=await authenticated(request,reply);if(!session)return;const updated=await service.selectOperationalContext(session,{companyId:body.data.companyId,...(body.data.branchId?{branchId:body.data.branchId}:{})});if(!updated)return reply.code(403).send({error:'context_forbidden'});return {companyId:updated.activeCompanyId,branchId:updated.activeBranchId}; });
}
