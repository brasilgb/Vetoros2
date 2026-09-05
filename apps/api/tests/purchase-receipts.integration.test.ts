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
let cookie = '';

async function makeApprovedOrder(quantity = 10) {
  const supplier = await app.inject({ method: 'POST', url: '/suppliers', headers: { cookie }, payload: { personType: 'company', legalName: `Fornecedor COM-03 ${randomUUID()}` } });
  const part = await app.inject({ method: 'POST', url: '/inventory/parts', headers: { cookie }, payload: { sku: `SKU-${randomUUID()}`, description: 'Peça COM-03', unit: 'un' } });
  const order = await app.inject({ method: 'POST', url: '/purchase-orders', headers: { cookie }, payload: { supplierId: supplier.json().id } });
  const orderId = order.json().id;
  const item = await app.inject({ method: 'POST', url: `/purchase-orders/${orderId}/items`, headers: { cookie }, payload: { inventoryPartId: part.json().id, quantity, unitCost: 5 } });
  await app.inject({ method: 'POST', url: `/purchase-orders/${orderId}/approve`, headers: { cookie } });
  return { orderId, orderItemId: item.json().id, partId: part.json().id };
}
async function insertBetaApprovedOrder() {
  const supplierId = randomUUID(), partId = randomUUID(), orderId = randomUUID(), itemId = randomUUID();
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${beta},true)`;
    await tx`insert into suppliers(id,tenant_id,supplier_number,person_type,legal_name,status) values(${supplierId},${beta},${Math.floor(Math.random() * 1000000)},'company','Fornecedor Beta','active')`;
    await tx`insert into inventory_parts(id,tenant_id,sku,description,unit) values(${partId},${beta},${`SKU-${randomUUID()}`},'Peça Beta','un')`;
    await tx`insert into purchase_order_number_counters(tenant_id,last_number) values(${beta},1) on conflict(tenant_id) do update set last_number=purchase_order_number_counters.last_number+1 returning last_number`;
    await tx`insert into purchase_orders(id,tenant_id,company_id,branch_id,purchase_order_number,supplier_id,status) values(${orderId},${beta},${betaCompany},${betaBranch},${Math.floor(Math.random() * 1000000) + 2000000},${supplierId},'approved')`;
    await tx`insert into purchase_order_items(id,tenant_id,purchase_order_id,inventory_part_id,description,quantity,unit_cost) values(${itemId},${beta},${orderId},${partId},'Peça Beta',10,5)`;
  });
  return { orderId, orderItemId: itemId };
}

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId: '01992ea1-1250-7000-8000-000000000012', branchId: '01992ea1-1250-7000-8000-000000000013' } });
});
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

const createReceipt = (purchaseOrderId: string, overrides: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/purchase-receipts', headers: { cookie }, payload: { purchaseOrderId, ...overrides } });
const addItem = (receiptId: string, purchaseOrderItemId: string, quantity: number) => app.inject({ method: 'POST', url: `/purchase-receipts/${receiptId}/items`, headers: { cookie }, payload: { purchaseOrderItemId, quantity } });
const confirm = (receiptId: string) => app.inject({ method: 'POST', url: `/purchase-receipts/${receiptId}/confirm`, headers: { cookie } });
const balanceOf = async (partId: string) => Number((await app.inject({ method: 'GET', url: `/inventory/parts/${partId}`, headers: { cookie } })).json().balance);

describe('COM-03 purchase receipts API', () => {
  it('requires authentication and operational context', async () => {
    expect((await app.inject({ method: 'GET', url: '/purchase-receipts' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'shared@vetoros.local', password } });
    expect((await app.inject({ method: 'GET', url: '/purchase-receipts', headers: { cookie: String(login.headers['set-cookie']).split(';')[0]! } })).statusCode).toBe(409);
  });

  it('rejects a nonexistent or cross-tenant purchase order, and one that is not approved', async () => {
    expect((await createReceipt(randomUUID())).statusCode).toBe(404);
    const { orderId: betaOrderId } = await insertBetaApprovedOrder();
    expect((await createReceipt(betaOrderId)).statusCode).toBe(404);
    const draftOrder = await app.inject({ method: 'POST', url: '/purchase-orders', headers: { cookie }, payload: { supplierId: (await app.inject({ method: 'POST', url: '/suppliers', headers: { cookie }, payload: { personType: 'company', legalName: `Fornecedor draft ${randomUUID()}` } })).json().id } });
    expect((await createReceipt(draftOrder.json().id)).statusCode).toBe(409);
    await app.inject({ method: 'POST', url: `/purchase-orders/${draftOrder.json().id}/cancel`, headers: { cookie } });
    expect((await createReceipt(draftOrder.json().id)).statusCode).toBe(409);
  });

  it('validates receipt items against the same order, part ownership and pending quantity', async () => {
    const { orderId, orderItemId } = await makeApprovedOrder(10);
    const receiptId = (await createReceipt(orderId)).json().id;
    expect((await addItem(receiptId, randomUUID(), 1)).statusCode).toBe(404);
    const other = await makeApprovedOrder(5);
    expect((await addItem(receiptId, other.orderItemId, 1)).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/purchase-receipts/${receiptId}/items`, headers: { cookie }, payload: { purchaseOrderItemId: orderItemId, quantity: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/purchase-receipts/${receiptId}/items`, headers: { cookie }, payload: { purchaseOrderItemId: orderItemId, quantity: -1 } })).statusCode).toBe(400);
    expect((await addItem(receiptId, orderItemId, 11)).statusCode).toBe(409);
    const added = await addItem(receiptId, orderItemId, 4);
    expect(added.statusCode).toBe(201);
    expect((await app.inject({ method: 'PATCH', url: `/purchase-receipts/${receiptId}/items/${added.json().id}`, headers: { cookie }, payload: { quantity: 11 } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/purchase-receipts/${receiptId}/items/${added.json().id}`, headers: { cookie } })).statusCode).toBe(200);
  });

  it('supports partial and multiple confirmed receipts, updates order state, and stays idempotent on re-confirmation', async () => {
    const { orderId, orderItemId, partId } = await makeApprovedOrder(10);
    const before = await balanceOf(partId);
    const r1 = (await createReceipt(orderId)).json().id;
    await addItem(r1, orderItemId, 4);
    expect((await confirm(r1)).statusCode).toBe(201);
    expect(await balanceOf(partId)).toBe(before + 4);
    expect((await confirm(r1)).statusCode).toBe(200); // idempotent
    expect(await balanceOf(partId)).toBe(before + 4); // no duplicate stock
    let orderDetail = (await app.inject({ method: 'GET', url: `/purchase-orders/${orderId}`, headers: { cookie } })).json();
    expect(Number(orderDetail.items[0].received_quantity)).toBe(4);
    expect(Number(orderDetail.items[0].pending_quantity)).toBe(6);
    expect(orderDetail.receipt_state).toBe('partially_received');
    const r2 = (await createReceipt(orderId)).json().id;
    await addItem(r2, orderItemId, 3);
    expect((await confirm(r2)).statusCode).toBe(201);
    const r3 = (await createReceipt(orderId)).json().id;
    await addItem(r3, orderItemId, 3);
    expect((await confirm(r3)).statusCode).toBe(201);
    expect(await balanceOf(partId)).toBe(before + 10);
    orderDetail = (await app.inject({ method: 'GET', url: `/purchase-orders/${orderId}`, headers: { cookie } })).json();
    expect(Number(orderDetail.items[0].pending_quantity)).toBe(0);
    expect(orderDetail.receipt_state).toBe('received');
  });

  it('blocks editing and cancellation after confirmation, and blocks confirming an empty or cancelled receipt', async () => {
    const { orderId, orderItemId } = await makeApprovedOrder(10);
    const emptyReceipt = (await createReceipt(orderId)).json().id;
    expect((await confirm(emptyReceipt)).statusCode).toBe(400);
    const confirmed = (await createReceipt(orderId)).json().id;
    const item = (await addItem(confirmed, orderItemId, 2)).json();
    expect((await confirm(confirmed)).statusCode).toBe(201);
    expect((await app.inject({ method: 'PATCH', url: `/purchase-receipts/${confirmed}`, headers: { cookie }, payload: { notes: 'x' } })).statusCode).toBe(409);
    expect((await addItem(confirmed, orderItemId, 1)).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/purchase-receipts/${confirmed}/items/${item.id}`, headers: { cookie } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/purchase-receipts/${confirmed}/cancel`, headers: { cookie } })).statusCode).toBe(409);
    const cancelled = (await createReceipt(orderId)).json().id;
    await addItem(cancelled, orderItemId, 1);
    expect((await app.inject({ method: 'POST', url: `/purchase-receipts/${cancelled}/cancel`, headers: { cookie } })).statusCode).toBe(200);
    expect((await confirm(cancelled)).statusCode).toBe(409);
    expect((await addItem(cancelled, orderItemId, 1)).statusCode).toBe(409);
  });

  it('lists, searches, paginates, filters by status and order, and returns detail with 404 for unknown ids', async () => {
    const { orderId, orderItemId } = await makeApprovedOrder(10);
    const receiptId = (await createReceipt(orderId)).json().id;
    await addItem(receiptId, orderItemId, 1);
    const list = await app.inject({ method: 'GET', url: `/purchase-receipts?purchaseOrderId=${orderId}&status=draft&page=1&pageSize=5`, headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: `/purchase-receipts/${receiptId}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/purchase-receipts/${randomUUID()}`, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/purchase-orders/${orderId}/receipts`, headers: { cookie } })).statusCode).toBe(200);
  });

  it('isolates purchase receipts between tenants', async () => {
    const { orderId: betaOrderId, orderItemId: betaItemId } = await insertBetaApprovedOrder();
    const betaReceiptId = randomUUID();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id',${beta},true)`;
      const [counter] = await tx<{ last_number: number }[]>`insert into purchase_receipt_number_counters(tenant_id,last_number) values(${beta},1) on conflict(tenant_id) do update set last_number=purchase_receipt_number_counters.last_number+1 returning last_number`;
      await tx`insert into purchase_receipts(id,tenant_id,company_id,branch_id,purchase_order_id,receipt_number) values(${betaReceiptId},${beta},${betaCompany},${betaBranch},${betaOrderId},${counter!.last_number})`;
      await tx`insert into purchase_receipt_items(tenant_id,purchase_receipt_id,purchase_order_id,purchase_order_item_id,inventory_part_id,description,quantity) select tenant_id,${betaReceiptId},${betaOrderId},id,inventory_part_id,description,1 from purchase_order_items where id=${betaItemId}`;
    });
    expect((await app.inject({ method: 'GET', url: `/purchase-receipts/${betaReceiptId}`, headers: { cookie } })).statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/purchase-receipts?pageSize=100', headers: { cookie } });
    expect((list.json().items as Array<{ id: string }>).some((r) => r.id === betaReceiptId)).toBe(false);
  });

  it('under concurrency, allows only one of two overlapping confirmations to exceed the pending quantity (6+6 on 10)', async () => {
    const { orderId, orderItemId, partId } = await makeApprovedOrder(10);
    const before = await balanceOf(partId);
    const r1 = (await createReceipt(orderId)).json().id, r2 = (await createReceipt(orderId)).json().id;
    await addItem(r1, orderItemId, 6); await addItem(r2, orderItemId, 6);
    const results = await Promise.all([confirm(r1), confirm(r2)]);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(1);
    expect(await balanceOf(partId)).toBe(before + 6);
    const orderDetail = (await app.inject({ method: 'GET', url: `/purchase-orders/${orderId}`, headers: { cookie } })).json();
    expect(Number(orderDetail.items[0].received_quantity)).toBe(6);
  });

  it('under concurrency, allows two non-conflicting confirmations to both succeed (5+5 on 10)', async () => {
    const { orderId, orderItemId, partId } = await makeApprovedOrder(10);
    const before = await balanceOf(partId);
    const r1 = (await createReceipt(orderId)).json().id, r2 = (await createReceipt(orderId)).json().id;
    await addItem(r1, orderItemId, 5); await addItem(r2, orderItemId, 5);
    const results = await Promise.all([confirm(r1), confirm(r2)]);
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    expect(await balanceOf(partId)).toBe(before + 10);
    const orderDetail = (await app.inject({ method: 'GET', url: `/purchase-orders/${orderId}`, headers: { cookie } })).json();
    expect(Number(orderDetail.items[0].pending_quantity)).toBe(0);
    expect(orderDetail.receipt_state).toBe('received');
  });
});
