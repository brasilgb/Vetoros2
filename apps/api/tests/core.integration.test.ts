import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

const authUrl=process.env.AUTH_DATABASE_URL??'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';const runtimeUrl=process.env.DATABASE_URL??'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';const migrationUrl=process.env.MIGRATION_DATABASE_URL??'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';const password=process.env.DEV_SEED_PASSWORD??'change-me-local-only';
const alpha='01992ea1-1250-7000-8000-000000000010',beta='01992ea1-1250-7000-8000-000000000020',companyAlpha='01992ea1-1250-7000-8000-000000000012',companyAlphaServices='01992ea1-1250-7000-8000-000000000017',companyBeta='01992ea1-1250-7000-8000-000000000022',branchBeta='01992ea1-1250-7000-8000-000000000023';
const service=new AuthService(authUrl,runtimeUrl,3600);const app=buildApp({authService:service,loginRateLimitMax:100});const admin=postgres(migrationUrl);let cookie='';
const cookieFrom=(response:Awaited<ReturnType<typeof app.inject>>)=>String(response.headers['set-cookie']).split(';')[0]!;

beforeAll(async()=>{await app.ready();const login=await app.inject({method:'POST',url:'/auth/login',payload:{email:'single@vetoros.local',password}});cookie=cookieFrom(login);});
afterAll(async()=>{await app.close();await service.close();await admin.end();});

describe('company and branch endpoints',()=>{
  it('lists only accessible resources and rejects client tenant authority',async()=>{const list=await app.inject({method:'GET',url:'/companies',headers:{cookie}});expect(list.statusCode).toBe(200);expect((list.json() as unknown[]).length).toBeGreaterThanOrEqual(2);const attack=await app.inject({method:'POST',url:'/companies',headers:{cookie},payload:{tenantId:beta,legalName:'Attack',taxIdType:'cnpj',taxIdNormalized:randomUUID()}});expect(attack.statusCode).toBe(400);});
  it('creates, reads and updates a company with audit',async()=>{const tax=randomUUID().replaceAll('-','').slice(0,14);const created=await app.inject({method:'POST',url:'/companies',headers:{cookie},payload:{legalName:'CORE Test',taxIdType:'cnpj',taxIdNormalized:tax}});expect(created.statusCode).toBe(201);const id=(created.json() as {id:string}).id;expect((await app.inject({method:'GET',url:`/companies/${id}`,headers:{cookie}})).statusCode).toBe(200);expect((await app.inject({method:'PATCH',url:`/companies/${id}`,headers:{cookie},payload:{tradeName:'CORE Updated'}})).statusCode).toBe(200);});
  it('creates and updates a branch only for a company in the current tenant',async()=>{const created=await app.inject({method:'POST',url:'/branches',headers:{cookie},payload:{companyId:companyAlpha,code:`T-${randomUUID().slice(0,6)}`,name:'CORE Branch'}});expect(created.statusCode).toBe(201);const id=(created.json() as {id:string}).id;expect((await app.inject({method:'PATCH',url:`/branches/${id}`,headers:{cookie},payload:{name:'CORE Branch Updated'}})).statusCode).toBe(200);expect((await app.inject({method:'POST',url:'/branches',headers:{cookie},payload:{companyId:companyBeta,code:'ATTACK',name:'Attack'}})).statusCode).toBe(404);});
  it('rejects a known UUID from another tenant',async()=>expect((await app.inject({method:'GET',url:`/companies/${companyBeta}`,headers:{cookie}})).statusCode).toBe(404));
  it('persists only a validated operational context',async()=>{expect((await app.inject({method:'POST',url:'/auth/operational-context',headers:{cookie},payload:{companyId:companyAlpha}})).statusCode).toBe(200);expect((await app.inject({method:'POST',url:'/auth/operational-context',headers:{cookie},payload:{companyId:companyBeta,branchId:branchBeta}})).statusCode).toBe(403);});
});

describe('authorization scope',()=>{
  it('enforces tenant, company and branch boundaries plus grant expiry',async()=>{
    const sharedA=await service.login('shared@vetoros.local',password,{}),sharedB=await service.login('shared@vetoros.local',password,{});expect(sharedA&&sharedB).toBeTruthy();const alphaSession=await service.selectTenant(sharedA!.session,alpha),betaSession=await service.selectTenant(sharedB!.session,beta);expect(alphaSession&&betaSession).toBeTruthy();
    const roleA=randomUUID(),roleB=randomUUID(),grantA=randomUUID(),grantB=randomUUID();
    for(const setup of [{tenant:alpha,role:roleA,grant:grantA,profile:alphaSession!.activeUserProfileId!,scope:'company',company:companyAlpha,branch:null},{tenant:beta,role:roleB,grant:grantB,profile:betaSession!.activeUserProfileId!,scope:'branch',company:companyBeta,branch:branchBeta}])await admin.begin(async tx=>{await tx`select set_config('app.tenant_id',${setup.tenant},true)`;await tx`insert into tenant_roles(id,tenant_id,code,name,scope_type) values(${setup.role},${setup.tenant},${`scope-${setup.role}`},'Scope test',${setup.scope})`;await tx`insert into tenant_role_permissions(tenant_id,role_id,permission_id) select ${setup.tenant},${setup.role},id from permissions where code in ('companies.read','branches.read')`;await tx`insert into access_grants(id,tenant_id,user_profile_id,role_id,scope_type,company_id,branch_id) values(${setup.grant},${setup.tenant},${setup.profile},${setup.role},${setup.scope},${setup.company},${setup.branch})`;});
    expect(await service.hasPermission(alphaSession!,'companies.read',{companyId:companyAlpha})).toBe(true);expect(await service.hasPermission(alphaSession!,'companies.read',{companyId:companyAlphaServices})).toBe(false);
    expect(await service.hasPermission(betaSession!,'branches.read',{companyId:companyBeta,branchId:branchBeta})).toBe(true);expect(await service.hasPermission(betaSession!,'companies.read',{companyId:companyBeta})).toBe(false);expect(await service.hasPermission(betaSession!,'branches.read',{companyId:companyBeta,branchId:randomUUID()})).toBe(false);
    await admin.begin(async tx=>{await tx`select set_config('app.tenant_id',${alpha},true)`;await tx`update access_grants set valid_until=now()-interval '1 second' where id=${grantA}`;});expect(await service.hasPermission(alphaSession!,'companies.read',{companyId:companyAlpha})).toBe(false);
  });
});
