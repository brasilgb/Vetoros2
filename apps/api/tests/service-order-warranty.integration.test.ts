import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { HTTPMethods } from 'fastify';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

// The injected response body is intentionally left open because each endpoint returns a distinct DTO.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TestResponse = { statusCode: number; json: () => any };

const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const tenantAlpha = '01992ea1-1250-7000-8000-000000000010';
const tenantBeta = '01992ea1-1250-7000-8000-000000000020';
const customerAlpha = '01992ea1-1250-7000-8000-000000000050';
const customerBeta = '01992ea1-1250-7000-8000-000000000052';
const companyAlpha = '01992ea1-1250-7000-8000-000000000012';
const branchAlpha = '01992ea1-1250-7000-8000-000000000013';
const companyBeta = '01992ea1-1250-7000-8000-000000000022';
const branchBeta = '01992ea1-1250-7000-8000-000000000023';
const profileAlpha = '01992ea1-1250-7000-8000-000000000015';
const profileBeta = '01992ea1-1250-7000-8000-000000000025';
const service = new AuthService(authUrl, runtimeUrl, 3600);
const app = buildApp({ authService: service, loginRateLimitMax: 100 });
const admin = postgres(migrationUrl, { max: 2 });
const runtime = postgres(runtimeUrl, { max: 1 });
let cookie = '';

const inject = (method: HTTPMethods, url: string, payload?: Record<string, unknown>) => {
  const options = { method, url, ...(cookie ? { headers: { cookie } } : {}), ...(payload ? { payload } : {}) };
  return app.inject(options as never) as unknown as Promise<TestResponse>;
};
const createOrder = (payload: Record<string, unknown> = {}) => inject('POST', '/service-orders', {
  customerId: customerAlpha, title: `OS ADV ${randomUUID()}`, reportedProblem: 'Falha intermitente', ...payload,
});
const updateOperational = (id: string, payload: Record<string, unknown>) => inject('PATCH', `/service-orders/${id}/operational`, payload);
const setCompleted = async (id: string) => { const response = await updateOperational(id, { status: 'completed', reason: 'teste' }); expect(response.statusCode).toBe(200); };

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId: companyAlpha, branchId: branchAlpha } });
});

afterAll(async () => { await app.close(); await service.close(); await admin.end(); await runtime.end(); });

describe('OS-ADV-01 — cobertura dedicada', () => {
  it('atualiza e persiste campos operacionais, prioridade, técnico e datas', async () => {
    const created = await createOrder();
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const response = await updateOperational(id, {
      priority: 'urgent', technicianUserProfileId: profileAlpha, diagnosis: 'Diagnóstico', executedSolution: 'Solução',
      technicalNotes: 'Notas técnicas', startedAt: '2026-09-09T10:00:00.000Z', technicallyCompletedAt: '2026-09-09T11:00:00.000Z',
      deliveredAt: '2026-09-09T12:00:00.000Z', deliveryNotes: 'Entregue', status: 'completed', reason: 'Concluído',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ priority: 'urgent', technician_user_profile_id: profileAlpha, diagnosis: 'Diagnóstico', executed_solution: 'Solução', status: 'completed' });
    expect((await inject('GET', `/service-orders/${id}`)).json()).toMatchObject({ delivery_notes: 'Entregue', technically_completed_at: expect.anything(), delivered_at: expect.anything() });
  });

  it('rejeita prioridade, UUID de técnico e vínculo de técnico inválidos', async () => {
    const created = await createOrder();
    const id = created.json().id;
    expect((await updateOperational(id, { priority: 'critical' })).statusCode).toBe(400);
    expect((await updateOperational(id, { technicianUserProfileId: randomUUID() })).statusCode).toBe(404);
    expect((await updateOperational(id, { technicianUserProfileId: profileBeta })).statusCode).toBe(403);
  });

  it('registra histórico ordenado e mantém o histórico append-only', async () => {
    const created = await createOrder();
    const id = created.json().id;
    await updateOperational(id, { status: 'awaiting_diagnosis', reason: 'Triagem' });
    await updateOperational(id, { status: 'in_progress', reason: 'Execução' });
    const history = await inject('GET', `/service-orders/${id}/history`);
    expect(history.statusCode).toBe(200);
    const entries = history.json() as Array<{ id: string; new_status: string; created_at: string }>;
    expect(entries.map((entry) => entry.new_status)).toEqual(['awaiting_diagnosis', 'in_progress']);
    expect(new Date(entries[0]!.created_at).getTime()).toBeLessThanOrEqual(new Date(entries[1]!.created_at).getTime());
    const historyId = entries[0]!.id;
    await expect(runtime.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantAlpha}, true)`;
      await tx`update service_order_status_history set reason='alterado' where id=${historyId}`;
    })).rejects.toThrow();
    await expect(runtime.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantAlpha}, true)`;
      await tx`delete from service_order_status_history where id=${historyId}`;
    })).rejects.toThrow();
  });

  it.each([
    ['within_warranty', true, '2099-12-31'],
    ['expired', true, '2020-01-01'],
    ['not_applicable', false, null],
  ])('persiste o snapshot de garantia %s', async (expected, enabled, endsAt) => {
    const created = await createOrder();
    const id = created.json().id;
    expect((await inject('PATCH', `/service-orders/${id}/warranty`, { enabled, startedAt: enabled ? '2020-01-01' : null, endsAt, notes: 'Política' })).statusCode).toBe(200);
    await setCompleted(id);
    const returned = await inject('POST', `/service-orders/${id}/warranty-return`, { reportedProblem: 'Retorno' });
    expect(returned.statusCode).toBe(201);
    expect(returned.json().warranty_snapshot_status).toBe(expected);
  });

  it('rejeita configuração de garantia com período invertido', async () => {
    const created = await createOrder();
    expect((await inject('PATCH', `/service-orders/${created.json().id}/warranty`, { enabled: true, startedAt: '2026-09-10', endsAt: '2026-09-09' })).statusCode).toBe(400);
  });

  it('só cria retorno a partir de OS concluída/entregue e preserva a origem', async () => {
    const open = await createOrder();
    expect((await inject('POST', `/service-orders/${open.json().id}/warranty-return`, { reportedProblem: 'Ainda aberta' })).statusCode).toBe(409);
    const original = await createOrder({ title: 'Origem preservada' });
    const originalId = original.json().id;
    await setCompleted(originalId);
    const returned = await inject('POST', `/service-orders/${originalId}/warranty-return`, { reportedProblem: 'Falha recorrente', title: 'Retorno' });
    expect(returned.statusCode).toBe(201);
    expect(returned.json()).toMatchObject({ service_order_kind: 'warranty_return', original_service_order_id: originalId });
    expect((await inject('GET', `/service-orders/${originalId}`)).json()).toMatchObject({ title: 'Origem preservada', status: 'completed' });
  });

  it('permite múltiplos retornos independentes e lista todos na mesma origem', async () => {
    const original = await createOrder();
    const originalId = original.json().id;
    await setCompleted(originalId);
    const one = await inject('POST', `/service-orders/${originalId}/warranty-return`, { reportedProblem: 'Retorno 1' });
    const two = await inject('POST', `/service-orders/${originalId}/warranty-return`, { reportedProblem: 'Retorno 2' });
    expect(one.statusCode).toBe(201); expect(two.statusCode).toBe(201);
    expect(one.json().id).not.toBe(two.json().id);
    expect(one.json().order_number).not.toBe(two.json().order_number);
    const listed = await inject('GET', `/service-orders/${originalId}/returns`);
    expect(listed.statusCode).toBe(200);
    const returns = listed.json() as Array<{ original_service_order_id: string }>;
    expect(returns.filter((entry) => entry.original_service_order_id === originalId)).toHaveLength(2);
  });

  it('mantém isolamento de tenant no endpoint e no UUID conhecido', async () => {
    const betaId = randomUUID();
    await admin`insert into service_orders(id,tenant_id,company_id,branch_id,order_number,customer_id,status,title,reported_problem) values(${betaId},${tenantBeta},${companyBeta},${branchBeta},${Math.floor(Math.random() * 1000000) + 9000000},${customerBeta},'open','Beta','Beta')`;
    expect((await inject('GET', `/service-orders/${betaId}`)).statusCode).toBe(404);
    expect((await inject('POST', `/service-orders/${betaId}/warranty-return`, { reportedProblem: 'Cross tenant' })).statusCode).toBe(404);
    await admin`delete from service_orders where id=${betaId}`;
  });

  it('rejeita FK composta cross-tenant fisicamente', async () => {
    await expect(admin`insert into service_orders(tenant_id,company_id,branch_id,order_number,customer_id,status,title,reported_problem) values(${tenantAlpha},${companyAlpha},${branchAlpha},${Math.floor(Math.random() * 1000000) + 8000000},${customerBeta},'open','Inválida','Inválida')`).rejects.toThrow();
  });

  it('aplica RBAC para ausência de sessão e alterações sem permission', async () => {
    expect((await app.inject({ method: 'GET', url: '/service-orders' })).statusCode).toBe(401);
    const created = await createOrder();
    const role = '01992ea1-1250-7000-8000-000000000031';
    await admin`delete from tenant_role_permissions where tenant_id=${tenantAlpha} and role_id=${role} and permission_id=(select id from permissions where code='service_orders.update')`;
    try { expect((await updateOperational(created.json().id, { diagnosis: 'Sem permissão' })).statusCode).toBe(403); }
    finally { await admin`insert into tenant_role_permissions(tenant_id,role_id,permission_id) select ${tenantAlpha},${role},id from permissions where code='service_orders.update' on conflict do nothing`; }
  });
});
