import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const tenant = '01992ea1-1250-7000-8000-000000000010';
const customer = '01992ea1-1250-7000-8000-000000000050';
const otherCustomer = '01992ea1-1250-7000-8000-000000000051';
const foreignCustomer = '01992ea1-1250-7000-8000-000000000052';
const responsible = '01992ea1-1250-7000-8000-000000000016';
const foreignResponsible = '01992ea1-1250-7000-8000-000000000025';
const company = '01992ea1-1250-7000-8000-000000000012';
const branch = '01992ea1-1250-7000-8000-000000000013';
const otherBranch = '01992ea1-1250-7000-8000-000000000018';

const service = new AuthService(authUrl, runtimeUrl, 3600);
const app = buildApp({ authService: service, loginRateLimitMax: 100 });
const admin = postgres(migrationUrl);
const createdScheduleIds = new Set<string>();
let cookie = '';

// Cada execução recebe uma janela temporal própria. O deslocamento é derivado de UUID e fica
// longe das datas operacionais/fixtures; o cleanup ao final impede crescimento de estado.
const runDayOffset = Number.parseInt(randomUUID().slice(0, 8), 16) % 100_000;
const runBase = Date.UTC(2035, 0, 1) + runDayOffset * 86_400_000;
const at = (hours: number) => new Date(runBase + hours * 3_600_000).toISOString();

const context = (companyId = company, branchId = branch) =>
  app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId, branchId } });

async function post(payload: Record<string, unknown>) {
  const response = await app.inject({ method: 'POST', url: '/schedules', headers: { cookie }, payload });
  if (response.statusCode === 201) {
    const id = (response.json() as { id?: string }).id;
    if (id) createdScheduleIds.add(id);
  }
  return response;
}

beforeAll(async () => {
  await app.ready();
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(response.headers['set-cookie']).split(';')[0]!;
  await context();
});

afterAll(async () => {
  try {
    if (createdScheduleIds.size > 0) {
      await admin`delete from schedules where tenant_id = ${tenant} and id in ${admin([...createdScheduleIds])}`;
    }
  } finally {
    await app.close();
    await service.close();
    await admin.end();
  }
});

describe('AGD-01 schedules API', () => {
  it('creates standalone, lists by period, updates and preserves an idempotent cancellation', async () => {
    const startsAt = at(0);
    const endsAt = at(1);
    const created = await post({ customerId: customer, responsibleUserProfileId: responsible, startsAt, endsAt, notes: 'Visita' });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const list = await app.inject({
      method: 'GET',
      url: `/schedules?from=${encodeURIComponent(at(-1))}&to=${encodeURIComponent(at(2))}`,
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.some((item: { id: string }) => item.id === id)).toBe(true);
    expect((await app.inject({ method: 'PATCH', url: `/schedules/${id}`, headers: { cookie }, payload: { notes: 'Reagendado' } })).statusCode).toBe(200);
    const canceled = await app.inject({ method: 'POST', url: `/schedules/${id}/cancel`, headers: { cookie } });
    expect(canceled.json().status).toBe('canceled');
    expect((await app.inject({ method: 'POST', url: `/schedules/${id}/cancel`, headers: { cookie } })).json().idempotent).toBe(true);
  });

  it('warns instead of blocking overlap and treats adjacent slots as non-conflicting', async () => {
    const first = await post({ customerId: customer, responsibleUserProfileId: responsible, startsAt: at(10), endsAt: at(11) });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().id as string;

    const adjacent = await post({ customerId: customer, responsibleUserProfileId: responsible, startsAt: at(11), endsAt: at(12) });
    expect(adjacent.statusCode).toBe(201);
    const adjacentBody = adjacent.json() as { id: string; conflicts: Array<{ id: string }> };
    // Dados externos podem existir no banco persistente; o contrato relevante é que o intervalo
    // imediatamente adjacente não conflite com o registro criado por este teste.
    expect(adjacentBody.conflicts.map((conflict) => conflict.id)).not.toContain(firstId);

    const overlap = await post({ customerId: customer, responsibleUserProfileId: responsible, startsAt: at(10.5), endsAt: at(11.5) });
    expect(overlap.statusCode).toBe(201);
    const conflictIds = (overlap.json().conflicts as Array<{ id: string }>).map((conflict) => conflict.id);
    expect(conflictIds).toEqual(expect.arrayContaining([firstId, adjacentBody.id]));
  });

  it('derives customer from OS and rejects divergent customer, foreign tenant UUID and unauthorized responsible', async () => {
    const serviceOrder = await app.inject({
      method: 'POST',
      url: '/service-orders',
      headers: { cookie },
      payload: { customerId: customer, title: 'Agenda OS', reportedProblem: 'Teste' },
    });
    const serviceOrderId = serviceOrder.json().id;
    const startsAt = at(20);
    const ok = await post({ serviceOrderId, startsAt });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().customer_id).toBe(customer);
    expect((await post({ serviceOrderId, customerId: otherCustomer, startsAt })).statusCode).toBe(400);
    expect((await post({ customerId: foreignCustomer, startsAt: at(21) })).statusCode).toBe(404);
    expect((await post({ customerId: customer, responsibleUserProfileId: foreignResponsible, startsAt: at(22) })).statusCode).toBe(400);
  });

  it('rejects an OS from another branch and an asset owned by another customer', async () => {
    await context(company, otherBranch);
    const serviceOrder = await app.inject({
      method: 'POST',
      url: '/service-orders',
      headers: { cookie },
      payload: { customerId: customer, title: 'Outra filial', reportedProblem: 'Teste' },
    });
    await context();
    expect((await post({ serviceOrderId: serviceOrder.json().id, startsAt: at(30) })).statusCode).toBe(404);
    const asset = await app.inject({
      method: 'POST',
      url: '/assets',
      headers: { cookie },
      payload: { customerId: otherCustomer, internalIdentifier: `AGD-${randomUUID()}`, category: 'Teste' },
    });
    expect((await post({ customerId: customer, assetId: asset.json().id, startsAt: at(31) })).statusCode).toBe(400);
  });
});
