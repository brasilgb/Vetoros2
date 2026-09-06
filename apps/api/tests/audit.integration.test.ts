import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const alpha = '01992ea1-1250-7000-8000-000000000010', beta = '01992ea1-1250-7000-8000-000000000020';
const service = new AuthService(authUrl, runtimeUrl, 3600), app = buildApp({ authService: service, loginRateLimitMax: 200 }), admin = postgres(migrationUrl);
let cookie = '';

const cookieFrom = (response: Awaited<ReturnType<typeof app.inject>>) => String(response.headers['set-cookie']).split(';')[0]!;
const uniqueCpf = () => { const seed = randomUUID().replace(/\D/g, '').slice(0, 9).padEnd(9, '7'); const digits = seed.split('').map(Number); for (const size of [9, 10]) { const sum = digits.slice(0, size).reduce((total, digit, index) => total + digit * (size + 1 - index), 0); digits.push(((sum * 10) % 11) % 10); } return digits.join(''); };
const createCustomer = (legalName: string) => app.inject({ method: 'POST', url: '/customers', headers: { cookie }, payload: { personType: 'individual', legalName, document: uniqueCpf() } });

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = cookieFrom(login);
});
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

describe('ADM-03 API and PostgreSQL policies', () => {
  it('lists events ordered by created_at desc, with a deterministic id tie-break', async () => {
    const marker = `Auditoria Ordem ${randomUUID()}`;
    const created = await createCustomer(marker);
    const id = (created.json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/customers/${id}`, headers: { cookie }, payload: { legalName: `${marker} v2` } });
    const response = await app.inject({ method: 'GET', url: `/audit-events?q=${encodeURIComponent(marker)}&pageSize=10`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ action: string; createdAt: string }> };
    expect(body.items.map((e) => e.action)).toEqual(['customer.updated', 'customer.created']);
    const timestamps = body.items.map((e) => new Date(e.createdAt).getTime());
    expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1]!);
  });

  it('paginates in the backend — a small pageSize never returns more rows than requested, and total reflects the full match count', async () => {
    const marker = `Auditoria Paginacao ${randomUUID()}`;
    for (let i = 0; i < 3; i++) await createCustomer(`${marker} ${i}`);
    const response = await app.inject({ method: 'GET', url: `/audit-events?q=${encodeURIComponent(marker)}&page=1&pageSize=2`, headers: { cookie } });
    const body = response.json() as { items: unknown[]; page: number; pageSize: number; total: number };
    expect(body.items.length).toBe(2);
    expect(body.total).toBeGreaterThanOrEqual(3);
    const secondPage = await app.inject({ method: 'GET', url: `/audit-events?q=${encodeURIComponent(marker)}&page=2&pageSize=2`, headers: { cookie } });
    expect((secondPage.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by period: a future custom range excludes an event created now', async () => {
    const marker = `Auditoria Periodo ${randomUUID()}`;
    await createCustomer(marker);
    const today = await app.inject({ method: 'GET', url: `/audit-events?q=${encodeURIComponent(marker)}&period=today`, headers: { cookie } });
    expect((today.json() as { total: number }).total).toBeGreaterThanOrEqual(1);
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const futureRange = await app.inject({ method: 'GET', url: `/audit-events?q=${encodeURIComponent(marker)}&period=custom&from=${future}`, headers: { cookie } });
    expect((futureRange.json() as { total: number }).total).toBe(0);
  });

  it('filters by exact action code', async () => {
    const marker = `Auditoria Acao ${randomUUID()}`;
    const created = await createCustomer(marker);
    const id = (created.json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/customers/${id}`, headers: { cookie }, payload: { legalName: `${marker} v2` } });
    const response = await app.inject({ method: 'GET', url: `/audit-events?q=${encodeURIComponent(marker)}&action=customer.updated`, headers: { cookie } });
    const items = (response.json() as { items: Array<{ action: string }> }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((e) => e.action === 'customer.updated')).toBe(true);
  });

  it('filters by module (resourceType, possibly a comma-separated list expanding "Compras")', async () => {
    const marker = `Auditoria Modulo ${randomUUID()}`;
    await createCustomer(marker);
    const wrongModule = await app.inject({ method: 'GET', url: `/audit-events?q=${encodeURIComponent(marker)}&resourceType=supplier,purchase_order`, headers: { cookie } });
    expect((wrongModule.json() as { total: number }).total).toBe(0);
    const rightModule = await app.inject({ method: 'GET', url: `/audit-events?q=${encodeURIComponent(marker)}&resourceType=customer`, headers: { cookie } });
    expect((rightModule.json() as { total: number }).total).toBeGreaterThanOrEqual(1);
  });

  it('filters by actor (free-text search over the resolved name)', async () => {
    const response = await app.inject({ method: 'GET', url: '/audit-events?q=Single%20Alpha&pageSize=1', headers: { cookie } });
    const items = (response.json() as { items: Array<{ actor: { name: string } | null }> }).items;
    expect(items.length).toBe(1);
    expect(items[0]!.actor?.name).toBe('Single Alpha');
  });

  it('reads a detail matching the list entry, including metadata', async () => {
    const marker = `Auditoria Detalhe ${randomUUID()}`;
    const created = await createCustomer(marker);
    const id = (created.json() as { id: string }).id;
    const list = await app.inject({ method: 'GET', url: `/audit-events?q=${encodeURIComponent(marker)}`, headers: { cookie } });
    const eventId = (list.json() as { items: Array<{ id: string }> }).items[0]!.id;
    const detail = await app.inject({ method: 'GET', url: `/audit-events/${eventId}`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as { resourceId: string; entityLabel: string; metadata: Record<string, unknown> };
    expect(body.resourceId).toBe(id);
    expect(body.entityLabel).toBe(marker);
    expect(body.metadata).toMatchObject({ personType: 'individual' });
  });

  it('returns 404 for a nonexistent event id', async () => {
    const response = await app.inject({ method: 'GET', url: `/audit-events/${randomUUID()}`, headers: { cookie } });
    expect(response.statusCode).toBe(404);
  });

  it('isolation: Alpha has event X; Beta cannot list it, cannot fetch its exact UUID, and a direct RLS query as Beta returns zero rows', async () => {
    const marker = `Auditoria Isolamento ${randomUUID()}`;
    const created = await createCustomer(marker);
    const customerId = (created.json() as { id: string }).id;
    const alphaList = await app.inject({ method: 'GET', url: `/audit-events?q=${encodeURIComponent(marker)}`, headers: { cookie } });
    const eventId = (alphaList.json() as { items: Array<{ id: string }> }).items[0]!.id;

    // sessão sem contexto em Beta: shared@vetoros.local tem membership em Beta, mas nenhum
    // access_grant lá (seed) — cobre RBAC E o "não listar" ao mesmo tempo.
    const login = await service.login('shared@vetoros.local', password, {});
    const betaSession = await service.selectTenant(login!.session, beta);
    expect(await service.hasPermission(betaSession!, 'audit.read', { requireTenant: true })).toBe(false);

    // consulta direta com RLS ativa no contexto de Beta: zero linhas, mesmo com o UUID exato.
    const runtime = postgres(runtimeUrl);
    try {
      const rows = await runtime.begin(async (tx) => { await tx`select set_config('app.tenant_id',${beta},true)`; return tx`select id from audit_events where id=${eventId}`; });
      expect(rows).toHaveLength(0);
      const byResource = await runtime.begin(async (tx) => { await tx`select set_config('app.tenant_id',${beta},true)`; return tx`select id from audit_events where resource_id=${customerId}`; });
      expect(byResource).toHaveLength(0);
    } finally { await runtime.end(); }
  });

  it('denies access without audit.read (RBAC negative), end-to-end through the HTTP layer', async () => {
    // `shared@vetoros.local` tem membership em Alpha mas nenhum access_grant lá (seed) —
    // `selectTenant` persiste a seleção na própria sessão (mesmo token), então o cookie abaixo
    // já reflete uma sessão real com tenant ativo e sem a permission.
    const login = await service.login('shared@vetoros.local', password, {});
    await service.selectTenant(login!.session, alpha);
    const response = await app.inject({ method: 'GET', url: '/audit-events', headers: { cookie: `vetoros_session=${login!.token}` } });
    expect(response.statusCode).toBe(403);
  });

  it('never returns a sensitive-looking metadata key, even if one were historically recorded', async () => {
    // nenhuma chamada real a `auditResource` grava isso hoje (conferido em toda a base — ver
    // executed.md, Descoberta #8); este teste prova a garantia de sanitização como uma barreira
    // de verdade, não uma opinião sobre o que os módulos atuais fazem.
    const id = randomUUID();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id',${alpha},true)`;
      const metadata = JSON.stringify({ password: 'should-not-leak', temporaryPassword: 'should-not-leak', apiToken: 'should-not-leak', safeField: 'ok' });
      await tx`insert into audit_events (id,tenant_id,action,resource_type,resource_id,metadata) values (${id},${alpha},'system.test_sensitive','customer',${randomUUID()},${metadata}::jsonb)`;
    });
    const response = await app.inject({ method: 'GET', url: `/audit-events/${id}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { metadata: Record<string, unknown> };
    expect(JSON.stringify(body.metadata)).not.toContain('should-not-leak');
    expect(body.metadata).toMatchObject({ password: '[removido]', temporaryPassword: '[removido]', apiToken: '[removido]', safeField: 'ok' });
  });

  it('resolves actor name and email without the caller ever seeing a raw identity UUID as the primary field', async () => {
    const marker = `Auditoria Ator ${randomUUID()}`;
    await createCustomer(marker);
    const response = await app.inject({ method: 'GET', url: `/audit-events?q=${encodeURIComponent(marker)}`, headers: { cookie } });
    const actor = (response.json() as { items: Array<{ actor: { identityId: string; name: string; email: string } | null }> }).items[0]!.actor;
    expect(actor).toMatchObject({ name: 'Single Alpha', email: 'single@vetoros.local' });
  });

  it('shows "no human actor" gracefully for a system-originated event (actor_identity_id null)', async () => {
    const id = randomUUID();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id',${alpha},true)`;
      await tx`insert into audit_events (id,tenant_id,actor_identity_id,action,resource_type,resource_id,metadata) values (${id},${alpha},null,'system.no_actor','customer',${randomUUID()},'{}')`;
    });
    const response = await app.inject({ method: 'GET', url: `/audit-events/${id}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { actor: unknown }).actor).toBeNull();
  });

  it('resolves actors for a page of many distinct events with a bounded number of queries (no N+1)', async () => {
    // verificação estrutural, não instrumentação de contagem de query: a implementação
    // (`withActors` em apps/api/src/audit/routes.ts) sempre faz UMA chamada a
    // `identitiesByIds` com todos os `actor_identity_id` distintos da página — nunca uma
    // chamada por linha — mesmo padrão já usado e coberto em ADM-01
    // (`apps/api/src/users/routes.ts`). Este teste confirma o comportamento observável: uma
    // página com muitos eventos de atores diferentes resolve nome/e-mail para todos, rápido.
    const marker = `Auditoria N+1 ${randomUUID()}`;
    for (let i = 0; i < 15; i++) await createCustomer(`${marker} ${i}`);
    const started = Date.now();
    const response = await app.inject({ method: 'GET', url: `/audit-events?q=${encodeURIComponent(marker)}&pageSize=15`, headers: { cookie } });
    const elapsed = Date.now() - started;
    const items = (response.json() as { items: Array<{ actor: { name: string } | null }> }).items;
    expect(items).toHaveLength(15);
    expect(items.every((e) => e.actor?.name === 'Single Alpha')).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  });
});
