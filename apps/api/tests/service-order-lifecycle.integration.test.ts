import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { HTTPMethods } from 'fastify';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TestResponse = { statusCode: number; json: () => any };

const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const customerAlpha = '01992ea1-1250-7000-8000-000000000050';
const companyAlpha = '01992ea1-1250-7000-8000-000000000012';
const branchAlpha = '01992ea1-1250-7000-8000-000000000013';
const tenantAlpha = '01992ea1-1250-7000-8000-000000000010';
const singleRole = '01992ea1-1250-7000-8000-000000000031';
const service = new AuthService(authUrl, runtimeUrl, 3600);
const app = buildApp({ authService: service, loginRateLimitMax: 100 });
const admin = postgres(migrationUrl, { max: 2 });
let cookie = '';

const inject = (method: HTTPMethods, url: string, payload?: Record<string, unknown>) => {
  const options = { method, url, ...(cookie ? { headers: { cookie } } : {}), ...(payload ? { payload } : {}) };
  return app.inject(options as never) as unknown as Promise<TestResponse>;
};
const createOrder = () => inject('POST', '/service-orders', { customerId: customerAlpha, title: `OS lifecycle ${randomUUID()}`, reportedProblem: 'Falha' });
const operational = (id: string, payload: Record<string, unknown>) => inject('PATCH', `/service-orders/${id}/operational`, payload);
const cancel = (id: string, payload: Record<string, unknown> = {}) => inject('POST', `/service-orders/${id}/cancel`, payload);
const history = (id: string) => inject('GET', `/service-orders/${id}/history`);

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId: companyAlpha, branchId: branchAlpha } });
});

afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

describe('OS-ADV-02 — máquina de estados e cancelamento', () => {
  it('permite transições válidas e grava histórico automaticamente para qualquer via de escrita', async () => {
    const id = (await createOrder()).json().id;
    expect((await operational(id, { status: 'in_progress' })).statusCode).toBe(200);
    expect((await operational(id, { status: 'ready' })).statusCode).toBe(200);
    expect((await operational(id, { status: 'delivered' })).statusCode).toBe(200);
    const entries = (await history(id)).json() as Array<{ new_status: string }>;
    expect(entries.map((e) => e.new_status)).toEqual(['in_progress', 'ready', 'delivered']);
  });

  it('rejeita transições fora da máquina de estados (pular etapas, avançar a partir de estado terminal)', async () => {
    const id = (await createOrder()).json().id;
    // open -> completed direto não existe no fluxo real.
    expect((await operational(id, { status: 'completed' })).statusCode).toBe(409);
    expect((await operational(id, { status: 'completed' })).json()).toMatchObject({ error: 'invalid_status_transition' });
    await operational(id, { status: 'in_progress' });
    await operational(id, { status: 'ready' });
    await operational(id, { status: 'delivered' });
    // `delivered` é terminal, exceto para `canceled` (via /cancel dedicado, não aqui).
    expect((await operational(id, { status: 'ready' })).statusCode).toBe(409);
    const canceledId = (await createOrder()).json().id;
    expect((await cancel(canceledId)).statusCode).toBe(200);
    // `canceled` é terminal de verdade — nem para trás nem para frente.
    expect((await operational(canceledId, { status: 'open' })).statusCode).toBe(409);
    expect((await cancel(canceledId)).statusCode).toBe(409);
  });

  it('cancela com motivo, grava no histórico e é ação exclusiva de /cancel (não aceita mais em /operational)', async () => {
    const id = (await createOrder()).json().id;
    const response = await cancel(id, { reason: 'Cliente desistiu' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'canceled' });
    const entries = (await history(id)).json() as Array<{ new_status: string; reason: string | null }>;
    expect(entries).toMatchObject([{ new_status: 'canceled', reason: 'Cliente desistiu' }]);
    // O schema de `/operational` não aceita mais `canceled` como valor de status.
    const other = (await createOrder()).json().id;
    expect((await operational(other, { status: 'canceled' })).statusCode).toBe(400);
  });

  it('bloqueia cancelamento com reserva de estoque ativa, preservando a OS', async () => {
    const id = (await createOrder()).json().id;
    const part = (await inject('POST', '/inventory/parts', { sku: `LIFE-${randomUUID()}`, description: 'Peça lifecycle', unit: 'un' })).json();
    await inject('POST', '/inventory/movements', { partId: part.id, type: 'entry', quantity: 5, reason: 'Carga lifecycle' });
    const item = (await inject('POST', `/service-orders/${id}/items`, { type: 'part', inventoryPartId: part.id, description: 'Peça', quantity: 2, unitPrice: 10 })).json();
    await inject('POST', `/service-orders/${id}/items/${item.id}/stock/reserve`, { quantity: 2, idempotencyKey: randomUUID() });
    expect((await cancel(id)).statusCode).toBe(409);
    expect((await inject('GET', `/service-orders/${id}`)).json()).toMatchObject({ status: 'open' });
  });

  it('RBAC: nega cancelamento sem a permission service_orders.cancel, preservando a OS', async () => {
    const id = (await createOrder()).json().id;
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantAlpha}, true)`;
      await tx`delete from tenant_role_permissions where tenant_id=${tenantAlpha} and role_id=${singleRole} and permission_id=(select id from permissions where code='service_orders.cancel')`;
    });
    try {
      expect((await cancel(id)).statusCode).toBe(403);
      expect((await inject('GET', `/service-orders/${id}`)).json()).toMatchObject({ status: 'open' });
    } finally {
      await admin.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantAlpha}, true)`;
        await tx`insert into tenant_role_permissions(tenant_id,role_id,permission_id) select ${tenantAlpha},${singleRole},id from permissions where code='service_orders.cancel' on conflict do nothing`;
      });
    }
  });

  it('não expõe UUID no /cancel sem sessão -> 401', async () => {
    expect((await app.inject({ method: 'POST', url: `/service-orders/${randomUUID()}/cancel` })).statusCode).toBe(401);
  });

  it('lista técnicos ativos do tenant para o combobox de atribuição (Web/UX, seção 15)', async () => {
    const response = await inject('GET', '/service-orders/technicians');
    expect(response.statusCode).toBe(200);
    const rows = response.json() as Array<{ id: string; name: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => typeof row.id === 'string' && typeof row.name === 'string')).toBe(true);
  });
});
