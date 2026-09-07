import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';
import { csvCell } from '../src/reports/routes.js';

const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const service = new AuthService(process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros', process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros', 3600);
const app = buildApp({ authService: service, loginRateLimitMax: 100 });
const admin = postgres(process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros');
let cookie = '';

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId: '01992ea1-1250-7000-8000-000000000012', branchId: '01992ea1-1250-7000-8000-000000000013' } });
});
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

describe('REL-01 reports summary', () => {
  it('requires authentication and validates the half-open period', async () => {
    expect((await app.inject({ method: 'GET', url: '/reports/summary' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/reports/export.csv' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/reports/summary?from=2026-01-02&to=2026-01-01', headers: { cookie } })).statusCode).toBe(400);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
    const contextlessCookie = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/reports/export.csv', headers: { cookie: contextlessCookie } })).statusCode).toBe(409);
  });

  it('uses the same filters and isolates tenant, company and branch in JSON and CSV', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
    const numberBase = Number(String(Date.now()).slice(-8)) * 10;
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id','01992ea1-1250-7000-8000-000000000010',true)`;
      await tx`insert into service_orders(id,tenant_id,company_id,branch_id,order_number,customer_id,title,reported_problem,opened_at) values
        (${ids[0]},'01992ea1-1250-7000-8000-000000000010','01992ea1-1250-7000-8000-000000000012','01992ea1-1250-7000-8000-000000000013',${numberBase},'01992ea1-1250-7000-8000-000000000050','REL-02 ativa','teste','2086-06-01T12:00:00Z'),
        (${ids[1]},'01992ea1-1250-7000-8000-000000000010','01992ea1-1250-7000-8000-000000000012','01992ea1-1250-7000-8000-000000000018',${numberBase + 1},'01992ea1-1250-7000-8000-000000000050','REL-02 outra filial','teste','2086-06-01T12:00:00Z'),
        (${ids[2]},'01992ea1-1250-7000-8000-000000000010','01992ea1-1250-7000-8000-000000000017','01992ea1-1250-7000-8000-000000000019',${numberBase + 2},'01992ea1-1250-7000-8000-000000000050','REL-02 outra empresa','teste','2086-06-01T12:00:00Z')`;
    });
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id','01992ea1-1250-7000-8000-000000000020',true)`;
      await tx`insert into service_orders(id,tenant_id,company_id,branch_id,order_number,customer_id,title,reported_problem,opened_at) values
        (${ids[3]},'01992ea1-1250-7000-8000-000000000020','01992ea1-1250-7000-8000-000000000022','01992ea1-1250-7000-8000-000000000023',${numberBase + 3},'01992ea1-1250-7000-8000-000000000052','REL-02 outro tenant','teste','2086-06-01T12:00:00Z')`;
    });

    const suffix = '?from=2086-06-01&to=2086-06-02';
    const summary = await app.inject({ method: 'GET', url: `/reports/summary${suffix}`, headers: { cookie } });
    const csv = await app.inject({ method: 'GET', url: `/reports/export.csv${suffix}`, headers: { cookie } });
    expect(summary.statusCode).toBe(200);
    expect(csv.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ serviceOrders: { total: 1 } });
    expect(csv.body).toContain('"ordens_servico","total","Total de OS","1","2086-06-01","2086-06-02"');
    expect(csv.body).not.toContain('REL-02 outra filial');
    expect(csv.body).not.toContain('REL-02 outra empresa');
    expect(csv.body).not.toContain('REL-02 outro tenant');
  });

  it('exports the same empty period as a valid deterministic UTF-8 CSV', async () => {
    const response = await app.inject({ method: 'GET', url: '/reports/export.csv?from=2099-01-01&to=2099-01-02', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('vetoros-relatorio-2099-01-01-2099-01-02.csv');
    expect(response.body.startsWith('\uFEFF"secao","metrica","rotulo","valor","from","to"')).toBe(true);
    expect(response.body).toContain('"ordens_servico","total","Total de OS","0","2099-01-01","2099-01-02"');
  });

  it('escapes CSV syntax and neutralizes formula injection', () => {
    expect(csvCell('texto, "citado"\nlinha')).toBe('"texto, ""citado""\nlinha"');
    expect(csvCell('=2+2')).toBe('"\'=2+2"');
    expect(csvCell('+SUM(A1)')).toBe('"\'+SUM(A1)"');
    expect(csvCell('-1')).toBe('"\'-1"');
    expect(csvCell('@cmd')).toBe('"\'@cmd"');
  });

  it('returns a stable zero-safe structure for an empty period', async () => {
    const response = await app.inject({ method: 'GET', url: '/reports/summary?from=2099-01-01&to=2099-01-02', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ period: { from: '2099-01-01', to: '2099-01-02' }, serviceOrders: { total: 0, completed: 0, canceled: 0, byStatus: [] }, sales: { total: 0, canceled: 0 }, customers: { total: 0 }, stockMovements: [] });
  });

  it('returns 403 for an authenticated user without reports.read', async () => {
    const identityId = randomUUID(), membershipId = randomUUID(), profileId = randomUUID(), roleId = randomUUID(), grantId = randomUUID();
    const email = `reports-restricted-${identityId}@vetoros.local`;
    const [source] = await admin<{ password_hash: string }[]>`select password_hash from identities where email_normalized='single@vetoros.local'`;
    await admin`insert into identities(id,email_normalized,password_hash,display_name,status) values(${identityId},${email},${source!.password_hash},'Reports restrito','active')`;
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id','01992ea1-1250-7000-8000-000000000010',true)`;
      await tx`insert into tenant_memberships(id,tenant_id,identity_id,status) values(${membershipId},'01992ea1-1250-7000-8000-000000000010',${identityId},'active')`;
      await tx`insert into tenant_user_profiles(id,tenant_id,membership_id,name) values(${profileId},'01992ea1-1250-7000-8000-000000000010',${membershipId},'Reports restrito')`;
      await tx`insert into tenant_roles(id,tenant_id,code,name,scope_type) values(${roleId},'01992ea1-1250-7000-8000-000000000010',${`reports_restricted_${roleId}`},'Reports restrito','tenant')`;
      await tx`insert into tenant_role_permissions(tenant_id,role_id,permission_id) values('01992ea1-1250-7000-8000-000000000010',${roleId},'01992ea1-1250-7000-8000-000000000033')`;
      await tx`insert into access_grants(id,tenant_id,user_profile_id,role_id,scope_type) values(${grantId},'01992ea1-1250-7000-8000-000000000010',${profileId},${roleId},'tenant')`;
    });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    const restrictedCookie = String(login.headers['set-cookie']).split(';')[0]!;
    await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie: restrictedCookie }, payload: { companyId: '01992ea1-1250-7000-8000-000000000012', branchId: '01992ea1-1250-7000-8000-000000000013' } });
    expect((await app.inject({ method: 'GET', url: '/reports/summary?from=2099-01-01&to=2099-01-02', headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/reports/export.csv?from=2099-01-01&to=2099-01-02', headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
  });
});
