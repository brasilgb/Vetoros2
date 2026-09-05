import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const beta = '01992ea1-1250-7000-8000-000000000020', betaCompany = '01992ea1-1250-7000-8000-000000000022', betaBranch = '01992ea1-1250-7000-8000-000000000023';
const service = new AuthService(authUrl, runtimeUrl, 3600), app = buildApp({ authService: service, loginRateLimitMax: 100 }), admin = postgres(migrationUrl);
let cookie = ''; let supplierId = ''; let partId = '';

async function insertBetaSupplier() {
  const id = randomUUID();
  await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${beta},true)`; await tx`insert into suppliers(id,tenant_id,supplier_number,person_type,legal_name,status) values(${id},${beta},${Math.floor(Math.random() * 1000000)},'company','Fornecedor Beta','active')`; });
  return id;
}
async function insertBetaPart() {
  const id = randomUUID();
  await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${beta},true)`; await tx`insert into inventory_parts(id,tenant_id,sku,description,unit) values(${id},${beta},${`SKU-${randomUUID()}`},'Peça Beta','un')`; });
  return id;
}

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId: '01992ea1-1250-7000-8000-000000000012', branchId: '01992ea1-1250-7000-8000-000000000013' } });
  const supplier = await app.inject({ method: 'POST', url: '/suppliers', headers: { cookie }, payload: { personType: 'company', legalName: `Fornecedor COM-02 ${randomUUID()}` } });
  supplierId = supplier.json().id;
  const part = await app.inject({ method: 'POST', url: '/inventory/parts', headers: { cookie }, payload: { sku: `SKU-${randomUUID()}`, description: 'Peça COM-02', unit: 'un' } });
  partId = part.json().id;
});
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

const create = (overrides: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/purchase-orders', headers: { cookie }, payload: { supplierId, ...overrides } });
const addItem = (orderId: string, overrides: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `/purchase-orders/${orderId}/items`, headers: { cookie }, payload: { inventoryPartId: partId, quantity: 2, unitCost: 10, ...overrides } });

describe('COM-02 purchase orders API', () => {
  it('requires authentication and operational context', async () => {
    expect((await app.inject({ method: 'GET', url: '/purchase-orders' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'shared@vetoros.local', password } });
    expect((await app.inject({ method: 'GET', url: '/purchase-orders', headers: { cookie: String(login.headers['set-cookie']).split(';')[0]! } })).statusCode).toBe(409);
  });

  it('creates a purchase order with valid context and zeroed totals', async () => {
    const made = await create();
    expect(made.statusCode).toBe(201);
    const body = made.json();
    expect(body.status).toBe('draft');
    expect(Number(body.subtotal)).toBe(0); expect(Number(body.discount_total)).toBe(0); expect(Number(body.total)).toBe(0);
  });

  it('rejects invalid payload and a nonexistent or cross-tenant supplier', async () => {
    expect((await create({ supplierId: undefined })).statusCode).toBe(400);
    expect((await create({ supplierId: randomUUID() })).statusCode).toBe(404);
    const betaSupplierId = await insertBetaSupplier();
    expect((await create({ supplierId: betaSupplierId })).statusCode).toBe(404);
  });

  it('generates unique sequential numbers under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => create()));
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const numbers = results.map((r) => Number(r.json().purchase_order_number));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('validates items against part existence, ownership and quantity, and computes deterministic totals', async () => {
    const orderId = (await create()).json().id;
    expect((await addItem(orderId, { inventoryPartId: randomUUID() })).statusCode).toBe(404);
    const betaPartId = await insertBetaPart();
    expect((await addItem(orderId, { inventoryPartId: betaPartId })).statusCode).toBe(404);
    expect((await addItem(orderId, { quantity: 0 })).statusCode).toBe(400);
    expect((await addItem(orderId, { discount: 100 })).statusCode).toBe(400);
    const first = await addItem(orderId, { quantity: 2, unitCost: 10, discount: 1 });
    expect(first.statusCode).toBe(201);
    expect(Number(first.json().total)).toBe(19);
    await addItem(orderId, { quantity: 1, unitCost: 5, discount: 0 });
    const detail = (await app.inject({ method: 'GET', url: `/purchase-orders/${orderId}`, headers: { cookie } })).json();
    expect(detail.items).toHaveLength(2);
    expect(Number(detail.subtotal)).toBe(25); // 2*10 + 1*5, gross
    expect(Number(detail.discount_total)).toBe(1);
    expect(Number(detail.total)).toBe(24); // subtotal - discount_total + freight(0) + other(0)
  });

  it('updates header fields while in draft and recalculates the total with freight and other costs', async () => {
    const orderId = (await create()).json().id;
    await addItem(orderId, { quantity: 1, unitCost: 100, discount: 0 });
    const patched = await app.inject({ method: 'PATCH', url: `/purchase-orders/${orderId}`, headers: { cookie }, payload: { freightTotal: 10, otherCostsTotal: 5, supplierReference: 'REF-1' } });
    expect(patched.statusCode).toBe(200);
    expect(Number(patched.json().total)).toBe(115); // 100 - 0 + 10 + 5
    expect(patched.json().supplier_reference).toBe('REF-1');
    expect((await app.inject({ method: 'PATCH', url: `/purchase-orders/${orderId}`, headers: { cookie }, payload: {} })).statusCode).toBe(400);
  });

  it('blocks header and item mutation once approved, and rejects invalid transitions', async () => {
    const orderId = (await create()).json().id;
    const item = await addItem(orderId);
    expect((await app.inject({ method: 'POST', url: `/purchase-orders/${orderId}/approve`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/purchase-orders/${orderId}`, headers: { cookie }, payload: { notes: 'x' } })).statusCode).toBe(409);
    expect((await addItem(orderId)).statusCode).toBe(409);
    expect((await app.inject({ method: 'PATCH', url: `/purchase-orders/${orderId}/items/${item.json().id}`, headers: { cookie }, payload: { quantity: 5 } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/purchase-orders/${orderId}/items/${item.json().id}`, headers: { cookie } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/purchase-orders/${orderId}/approve`, headers: { cookie } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/purchase-orders/${orderId}/cancel`, headers: { cookie } })).statusCode).toBe(409);
  });

  it('edits and removes items while in draft, and cancels a draft order blocking further mutation', async () => {
    const orderId = (await create()).json().id;
    const item = (await addItem(orderId, { quantity: 2, unitCost: 10 })).json();
    expect((await app.inject({ method: 'PATCH', url: `/purchase-orders/${orderId}/items/${item.id}`, headers: { cookie }, payload: { quantity: 3 } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/purchase-orders/${orderId}/items/${item.id}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/purchase-orders/${orderId}`, headers: { cookie } })).json().items).toHaveLength(0);
    expect((await app.inject({ method: 'POST', url: `/purchase-orders/${orderId}/cancel`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/purchase-orders/${orderId}/approve`, headers: { cookie } })).statusCode).toBe(409);
    expect((await addItem(orderId)).statusCode).toBe(409);
  });

  it('lists, searches, paginates, filters by status and returns detail with 404 for unknown ids', async () => {
    const made = await create({ supplierReference: `Busca-COM02-${randomUUID()}` });
    const list = await app.inject({ method: 'GET', url: `/purchase-orders?search=${made.json().supplier_reference}&status=draft&page=1&pageSize=5`, headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: `/purchase-orders/${made.json().id}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/purchase-orders/${randomUUID()}`, headers: { cookie } })).statusCode).toBe(404);
  });

  it('isolates purchase orders between tenants', async () => {
    const betaSupplierId = await insertBetaSupplier();
    const betaOrderId = randomUUID();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id',${beta},true)`;
      await tx`insert into purchase_order_number_counters(tenant_id,last_number) values(${beta},1) on conflict(tenant_id) do update set last_number=purchase_order_number_counters.last_number+1 returning last_number`;
      await tx`insert into purchase_orders(id,tenant_id,company_id,branch_id,purchase_order_number,supplier_id) values(${betaOrderId},${beta},${betaCompany},${betaBranch},${Math.floor(Math.random() * 1000000) + 1000000},${betaSupplierId})`;
    });
    expect((await app.inject({ method: 'GET', url: `/purchase-orders/${betaOrderId}`, headers: { cookie } })).statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/purchase-orders?pageSize=100', headers: { cookie } });
    expect((list.json().items as Array<{ id: string }>).some((o) => o.id === betaOrderId)).toBe(false);
  });
});
