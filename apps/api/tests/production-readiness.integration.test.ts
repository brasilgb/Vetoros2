import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const service = new AuthService(process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros', process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros', 3600);
const app = buildApp({ authService: service, loginRateLimitMax: 100 });
let cookie = '';

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId: '01992ea1-1250-7000-8000-000000000012', branchId: '01992ea1-1250-7000-8000-000000000013' } });
});
afterAll(async () => { await app.close(); await service.close(); });

describe('PRD-01 critical operational journey', () => {
  it('connects CRM, quote, service order, stock, sale, cash and reports using real persistence', async () => {
    const marker = randomUUID();
    const customer = await app.inject({ method: 'POST', url: '/customers', headers: { cookie }, payload: { personType: 'individual', legalName: `PRD-01 ${marker}` } });
    expect(customer.statusCode).toBe(201);

    const asset = await app.inject({ method: 'POST', url: '/assets', headers: { cookie }, payload: { customerId: customer.json().id, internalIdentifier: `PRD-${marker}`, category: 'Equipamento', brand: 'VetorOS' } });
    expect(asset.statusCode).toBe(201);

    const quote = await app.inject({ method: 'POST', url: '/quotes', headers: { cookie }, payload: { customerId: customer.json().id, customerAssetId: asset.json().id, title: `Jornada PRD-01 ${marker}` } });
    expect(quote.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `/quotes/${quote.json().id}/items`, headers: { cookie }, payload: { type: 'service', description: 'Diagnóstico integrado', quantity: 1, unitPrice: 50 } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'PATCH', url: `/quotes/${quote.json().id}`, headers: { cookie }, payload: { status: 'sent' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/quotes/${quote.json().id}`, headers: { cookie }, payload: { status: 'approved' } })).statusCode).toBe(200);
    const order = await app.inject({ method: 'POST', url: `/quotes/${quote.json().id}/convert`, headers: { cookie } });
    expect(order.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: `/service-orders/${order.json().id}`, headers: { cookie } })).json()).toMatchObject({ customer_id: customer.json().id, asset_id: asset.json().id });

    const part = await app.inject({ method: 'POST', url: '/inventory/parts', headers: { cookie }, payload: { sku: `PRD-${marker}`, description: 'Peça da jornada', unit: 'un', referencePrice: 15 } });
    expect(part.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/inventory/movements', headers: { cookie }, payload: { partId: part.json().id, type: 'entry', quantity: 5, reason: 'Carga da jornada PRD-01' } })).statusCode).toBe(201);

    const sale = await app.inject({ method: 'POST', url: '/sales', headers: { cookie }, payload: { customerId: customer.json().id, notes: `PRD-01 ${marker}` } });
    expect(sale.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `/sales/${sale.json().id}/items`, headers: { cookie }, payload: { type: 'part', inventoryPartId: part.json().id, description: 'Peça aplicada', quantity: 2, unitPrice: 15 } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `/sales/${sale.json().id}/confirm`, headers: { cookie } })).statusCode).toBe(200);
    expect(Number((await app.inject({ method: 'GET', url: `/inventory/parts/${part.json().id}`, headers: { cookie } })).json().balance)).toBe(3);

    const register = await app.inject({ method: 'POST', url: '/cash-registers', headers: { cookie }, payload: { name: `Caixa PRD-01 ${marker}` } });
    expect(register.statusCode).toBe(201);
    const cashSession = await app.inject({ method: 'POST', url: '/cash-sessions/open', headers: { cookie }, payload: { cashRegisterId: register.json().id, openingAmount: 0 } });
    expect(cashSession.statusCode).toBe(201);
    const methods = await app.inject({ method: 'GET', url: '/payment-methods', headers: { cookie } });
    const cashMethod = methods.json().find((method: { code: string }) => method.code === 'cash');
    const payment = await app.inject({ method: 'POST', url: '/payments', headers: { cookie }, payload: { cashSessionId: cashSession.json().session_id, amount: 30, paymentMethodId: cashMethod.id, saleId: sale.json().id, idempotencyKey: `prd01-${marker}` } });
    expect(payment.statusCode).toBe(201);

    const report = await app.inject({ method: 'GET', url: '/reports/summary', headers: { cookie } });
    expect(report.statusCode).toBe(200);
    expect(report.json().sales.total).toBeGreaterThanOrEqual(1);
    const csv = await app.inject({ method: 'GET', url: '/reports/export.csv', headers: { cookie } });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
  });
});
