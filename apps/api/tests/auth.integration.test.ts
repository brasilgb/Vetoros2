import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';

const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const alpha = '01992ea1-1250-7000-8000-000000000010';
const beta = '01992ea1-1250-7000-8000-000000000020';
const singleProfile = '01992ea1-1250-7000-8000-000000000016';
const service = new AuthService(authUrl, runtimeUrl, 3600);
const app = buildApp({ authService: service, sessionTtlSeconds: 3600, loginRateLimitMax: 100 });
const admin = postgres(migrationUrl);

const cookieFrom = (response: Awaited<ReturnType<typeof app.inject>>) => String(response.headers['set-cookie']).split(';')[0]!;

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

describe('AUTH-01 login and session', () => {
  it('creates a valid opaque session and auto-selects one tenant', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ authenticated: true, tenantSelectionRequired: false, activeTenantId: alpha });
    expect(response.headers['set-cookie']).toContain('HttpOnly'); expect(response.headers['set-cookie']).toContain('SameSite=Strict');
    const session = await app.inject({ method: 'GET', url: '/auth/session', headers: { cookie: cookieFrom(response) } });
    expect(session.statusCode).toBe(200); expect(session.json()).toMatchObject({ activeTenantId: alpha });
  });
  it.each([['wrong password','single@vetoros.local','wrong'],['unknown identity','unknown@vetoros.local',password]])('returns the same response for %s', async (_case, email, attempt) => {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: attempt } });
    expect(response.statusCode).toBe(401); expect(response.json()).toEqual({ error: 'invalid_credentials', message: 'E-mail ou senha inválidos.' });
  });
  it('returns no available tenant without exposing internals', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'none@vetoros.local', password } });
    expect(response.json()).toMatchObject({ authenticated: true, hasAvailableTenant: false, activeTenantId: null });
  });
  it('rejects missing, expired and revoked sessions', async () => {
    expect((await app.inject({ method: 'GET', url: '/auth/session' })).statusCode).toBe(401);
    for (const column of ['expires_at', 'status'] as const) {
      const login = await service.login('single@vetoros.local', password, {}); expect(login).not.toBeNull();
      if (column === 'expires_at') await admin`update auth_sessions set expires_at=now()-interval '1 second' where id=${login!.session.id}`;
      else await admin`update auth_sessions set status='revoked',revoked_at=now() where id=${login!.session.id}`;
      expect(await service.session(login!.token)).toBeNull();
    }
  });
  it('logout revokes the session and clears the cookie', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } }); const cookie = cookieFrom(login);
    const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } }); expect(logout.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/auth/session', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('tenant selection and trusted context', () => {
  it('lists two memberships and selects only one belonging to identity', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'shared@vetoros.local', password } }); const cookie = cookieFrom(login);
    expect(login.json()).toMatchObject({ tenantSelectionRequired: true, activeTenantId: null });
    const tenants = await app.inject({ method: 'GET', url: '/auth/tenants', headers: { cookie } });
    expect((tenants.json() as { tenants: unknown[] }).tenants).toHaveLength(2);
    expect((await app.inject({ method: 'POST', url: '/auth/select-tenant', headers: { cookie }, payload: { tenantId: crypto.randomUUID() } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/auth/select-tenant', headers: { cookie }, payload: { tenantId: beta } })).statusCode).toBe(200);
  });
  it('rejects client-controlled identity or privilege fields', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'shared@vetoros.local', password } });
    const response = await app.inject({ method: 'POST', url: '/auth/select-tenant', headers: { cookie: cookieFrom(login) }, payload: { tenantId: alpha, identityId: crypto.randomUUID(), permission: '*' } });
    expect(response.statusCode).toBe(400);
  });
  it('excludes an inactive membership', async () => {
    const login = await service.login('shared@vetoros.local', password, {}); expect(login).not.toBeNull();
    await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id', ${beta}, true)`; await tx`update tenant_memberships set status='suspended' where tenant_id=${beta} and identity_id=${login!.session.identityId}`; });
    expect(await service.tenants(login!.session)).toHaveLength(1);
    await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id', ${beta}, true)`; await tx`update tenant_memberships set status='active' where tenant_id=${beta} and identity_id=${login!.session.identityId}`; });
  });
  it('derives all PostgreSQL context values from the persisted session', async () => {
    const login = await service.login('single@vetoros.local', password, {}); expect(login).not.toBeNull();
    const context = await service.withAuthenticatedTenant(login!.session, async (tx) => (await tx.execute<{ tenant: string; actor: string; profile: string }>(sql`
      select current_setting('app.tenant_id') tenant,current_setting('app.actor_identity_id') actor,current_setting('app.effective_user_profile_id') profile
    `))[0]);
    expect(context).toMatchObject({ tenant: alpha, actor: login!.session.identityId, profile: singleProfile });
  });
});

describe('central permission resolution', () => {
  it('allows an explicit permission and denies an absent one', async () => {
    const login = await service.login('single@vetoros.local', password, {}); expect(login).not.toBeNull();
    expect(await service.hasPermission(login!.session, 'auth.session.read')).toBe(true);
    expect(await service.hasPermission(login!.session, 'auth.nonexistent')).toBe(false);
  });
});
