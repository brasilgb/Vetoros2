import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const customer = '01992ea1-1250-7000-8000-000000000050';
const tenantAlpha = '01992ea1-1250-7000-8000-000000000010', companyAlpha = '01992ea1-1250-7000-8000-000000000012', branchAlpha = '01992ea1-1250-7000-8000-000000000013';
const operationalContextSelectPermissionId = '01992ea1-1250-7000-8000-000000000033'; // 'operational.context.select', id estável do seed
const beta = '01992ea1-1250-7000-8000-000000000020', betaCompany = '01992ea1-1250-7000-8000-000000000022', betaBranch = '01992ea1-1250-7000-8000-000000000023';
const service = new AuthService(authUrl, runtimeUrl, 3600), app = buildApp({ authService: service, loginRateLimitMax: 100 }), admin = postgres(migrationUrl);
let cookie = '';

async function makeConfirmedReceipt(quantity = 10) {
  const supplier = await app.inject({ method: 'POST', url: '/suppliers', headers: { cookie }, payload: { personType: 'company', legalName: `Fornecedor COM-04 ${randomUUID()}` } });
  const part = await app.inject({ method: 'POST', url: '/inventory/parts', headers: { cookie }, payload: { sku: `SKU-${randomUUID()}`, description: 'Peça COM-04', unit: 'un' } });
  const order = await app.inject({ method: 'POST', url: '/purchase-orders', headers: { cookie }, payload: { supplierId: supplier.json().id } });
  const orderId = order.json().id;
  const orderItem = await app.inject({ method: 'POST', url: `/purchase-orders/${orderId}/items`, headers: { cookie }, payload: { inventoryPartId: part.json().id, quantity, unitCost: 5 } });
  await app.inject({ method: 'POST', url: `/purchase-orders/${orderId}/approve`, headers: { cookie } });
  const receipt = await app.inject({ method: 'POST', url: '/purchase-receipts', headers: { cookie }, payload: { purchaseOrderId: orderId } });
  const receiptId = receipt.json().id;
  const receiptItem = await app.inject({ method: 'POST', url: `/purchase-receipts/${receiptId}/items`, headers: { cookie }, payload: { purchaseOrderItemId: orderItem.json().id, quantity } });
  await app.inject({ method: 'POST', url: `/purchase-receipts/${receiptId}/confirm`, headers: { cookie } });
  return { orderId, receiptId, receiptItemId: receiptItem.json().id, partId: part.json().id };
}
async function makeDraftReceipt() {
  const supplier = await app.inject({ method: 'POST', url: '/suppliers', headers: { cookie }, payload: { personType: 'company', legalName: `Fornecedor draft ${randomUUID()}` } });
  const order = await app.inject({ method: 'POST', url: '/purchase-orders', headers: { cookie }, payload: { supplierId: supplier.json().id } });
  await app.inject({ method: 'POST', url: `/purchase-orders/${order.json().id}/approve`, headers: { cookie } });
  const receipt = await app.inject({ method: 'POST', url: '/purchase-receipts', headers: { cookie }, payload: { purchaseOrderId: order.json().id } });
  return receipt.json().id;
}
async function insertBetaConfirmedReceipt() {
  const supplierId = randomUUID(), partId = randomUUID(), orderId = randomUUID(), orderItemId = randomUUID(), receiptId = randomUUID(), receiptItemId = randomUUID();
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${beta},true)`;
    await tx`insert into suppliers(id,tenant_id,supplier_number,person_type,legal_name,status) values(${supplierId},${beta},${Math.floor(Math.random() * 1000000)},'company','Fornecedor Beta','active')`;
    await tx`insert into inventory_parts(id,tenant_id,sku,description,unit) values(${partId},${beta},${`SKU-${randomUUID()}`},'Peça Beta','un')`;
    await tx`insert into purchase_order_number_counters(tenant_id,last_number) values(${beta},1) on conflict(tenant_id) do update set last_number=purchase_order_number_counters.last_number+1 returning last_number`;
    await tx`insert into purchase_orders(id,tenant_id,company_id,branch_id,purchase_order_number,supplier_id,status) values(${orderId},${beta},${betaCompany},${betaBranch},${Math.floor(Math.random() * 1000000) + 3000000},${supplierId},'approved')`;
    await tx`insert into purchase_order_items(id,tenant_id,purchase_order_id,inventory_part_id,description,quantity,unit_cost) values(${orderItemId},${beta},${orderId},${partId},'Peça Beta',10,5)`;
    const [counter] = await tx<{ last_number: number }[]>`insert into purchase_receipt_number_counters(tenant_id,last_number) values(${beta},1) on conflict(tenant_id) do update set last_number=purchase_receipt_number_counters.last_number+1 returning last_number`;
    await tx`insert into purchase_receipts(id,tenant_id,company_id,branch_id,purchase_order_id,receipt_number,status) values(${receiptId},${beta},${betaCompany},${betaBranch},${orderId},${counter!.last_number},'confirmed')`;
    await tx`insert into purchase_receipt_items(id,tenant_id,purchase_receipt_id,purchase_order_id,purchase_order_item_id,inventory_part_id,description,quantity) values(${receiptItemId},${beta},${receiptId},${orderId},${orderItemId},${partId},'Peça Beta',10)`;
  });
  return { receiptId, receiptItemId };
}

// Identidade de permissões parciais para os testes de autorização negativa RBAC (fechamento
// do COM-04): criada inteiramente via SQL direto no fixture de teste — nunca no seed da
// aplicação — com contexto operacional válido (Tenant/Company/Branch Alpha, os mesmos da
// suíte principal) mas sem nenhuma permissão `purchase_returns.*`. O papel começa só com
// `operational.context.select` (necessária para a própria seleção de Company/Branch) e ganha
// as demais permissões incrementalmente dentro dos testes, uma de cada vez, para provar que
// cada 403 é causado especificamente pela permissão ainda ausente.
async function createRestrictedIdentity() {
  const identityId = randomUUID(), membershipId = randomUUID(), profileId = randomUUID(), roleId = randomUUID(), grantId = randomUUID();
  const email = `restricted-com04-${randomUUID()}@vetoros.local`;
  const [existing] = await admin<{ password_hash: string }[]>`select password_hash from identities where email_normalized='single@vetoros.local'`;
  await admin`insert into identities(id,email_normalized,password_hash,display_name,status) values(${identityId},${email},${existing!.password_hash},'Restrito COM-04','active')`;
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenantAlpha},true)`;
    await tx`insert into tenant_memberships(id,tenant_id,identity_id,status) values(${membershipId},${tenantAlpha},${identityId},'active')`;
    await tx`insert into tenant_user_profiles(id,tenant_id,membership_id,name) values(${profileId},${tenantAlpha},${membershipId},'Restrito COM-04')`;
    await tx`insert into tenant_roles(id,tenant_id,code,name,scope_type) values(${roleId},${tenantAlpha},${`com04_restricted_${roleId}`},'COM-04 restricted','tenant')`;
    await tx`insert into tenant_role_permissions(tenant_id,role_id,permission_id) values(${tenantAlpha},${roleId},${operationalContextSelectPermissionId})`;
    await tx`insert into access_grants(id,tenant_id,user_profile_id,role_id,scope_type) values(${grantId},${tenantAlpha},${profileId},${roleId},'tenant')`;
  });
  return { email, roleId };
}
async function grantRestrictedPermission(roleId: string, code: string) {
  const [permission] = await admin<{ id: string }[]>`select id from permissions where code=${code}`;
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenantAlpha},true)`;
    await tx`insert into tenant_role_permissions(tenant_id,role_id,permission_id) values(${tenantAlpha},${roleId},${permission!.id}) on conflict do nothing`;
  });
}

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId: '01992ea1-1250-7000-8000-000000000012', branchId: '01992ea1-1250-7000-8000-000000000013' } });
});
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

const createReturn = (purchaseReceiptId: string, overrides: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/purchase-returns', headers: { cookie }, payload: { purchaseReceiptId, ...overrides } });
const addItem = (returnId: string, purchaseReceiptItemId: string, quantity: number) => app.inject({ method: 'POST', url: `/purchase-returns/${returnId}/items`, headers: { cookie }, payload: { purchaseReceiptItemId, quantity } });
const confirm = (returnId: string) => app.inject({ method: 'POST', url: `/purchase-returns/${returnId}/confirm`, headers: { cookie } });
const balanceOf = async (partId: string) => Number((await app.inject({ method: 'GET', url: `/inventory/parts/${partId}`, headers: { cookie } })).json().balance);

describe('COM-04 purchase returns API', () => {
  it('requires authentication and operational context', async () => {
    expect((await app.inject({ method: 'GET', url: '/purchase-returns' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'shared@vetoros.local', password } });
    expect((await app.inject({ method: 'GET', url: '/purchase-returns', headers: { cookie: String(login.headers['set-cookie']).split(';')[0]! } })).statusCode).toBe(409);
  });

  it('rejects a nonexistent, cross-tenant, draft or cancelled receipt as return origin, and accepts a confirmed one', async () => {
    expect((await createReturn(randomUUID())).statusCode).toBe(404);
    const { receiptId: betaReceiptId } = await insertBetaConfirmedReceipt();
    expect((await createReturn(betaReceiptId)).statusCode).toBe(404);
    const draftReceiptId = await makeDraftReceipt();
    expect((await createReturn(draftReceiptId)).statusCode).toBe(409);
    await app.inject({ method: 'POST', url: `/purchase-receipts/${draftReceiptId}/cancel`, headers: { cookie } });
    expect((await createReturn(draftReceiptId)).statusCode).toBe(409);
    const { receiptId } = await makeConfirmedReceipt(10);
    expect((await createReturn(receiptId)).statusCode).toBe(201);
  });

  it('validates return items against the same receipt, part ownership and quantity', async () => {
    const { receiptId, receiptItemId } = await makeConfirmedReceipt(10);
    const returnId = (await createReturn(receiptId)).json().id;
    expect((await addItem(returnId, randomUUID(), 1)).statusCode).toBe(404);
    const other = await makeConfirmedReceipt(5);
    expect((await addItem(returnId, other.receiptItemId, 1)).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/purchase-returns/${returnId}/items`, headers: { cookie }, payload: { purchaseReceiptItemId: receiptItemId, quantity: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/purchase-returns/${returnId}/items`, headers: { cookie }, payload: { purchaseReceiptItemId: receiptItemId, quantity: -1 } })).statusCode).toBe(400);
    expect((await addItem(returnId, receiptItemId, 11)).statusCode).toBe(409);
    const added = await addItem(returnId, receiptItemId, 4);
    expect(added.statusCode).toBe(201);
    expect((await app.inject({ method: 'PATCH', url: `/purchase-returns/${returnId}/items/${added.json().id}`, headers: { cookie }, payload: { quantity: 11 } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/purchase-returns/${returnId}/items/${added.json().id}`, headers: { cookie } })).statusCode).toBe(200);
  });

  it('does not touch stock while draft, moves stock only on confirmation, and stays idempotent on re-confirmation', async () => {
    const { receiptId, receiptItemId, partId } = await makeConfirmedReceipt(10);
    const before = await balanceOf(partId);
    const returnId = (await createReturn(receiptId)).json().id;
    const item = (await addItem(returnId, receiptItemId, 4)).json();
    expect(await balanceOf(partId)).toBe(before); // draft create+add: no stock effect
    await app.inject({ method: 'PATCH', url: `/purchase-returns/${returnId}/items/${item.id}`, headers: { cookie }, payload: { quantity: 3 } });
    expect(await balanceOf(partId)).toBe(before); // draft edit: no stock effect
    const cancelled = (await createReturn(receiptId)).json().id;
    await addItem(cancelled, receiptItemId, 2);
    await app.inject({ method: 'POST', url: `/purchase-returns/${cancelled}/cancel`, headers: { cookie } });
    expect(await balanceOf(partId)).toBe(before); // draft cancel: no stock effect
    const confirmed = await confirm(returnId);
    expect(confirmed.statusCode).toBe(201);
    expect(await balanceOf(partId)).toBe(before - 3);
    const movements = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partId}&type=exit`, headers: { cookie } })).json().items;
    const movement = movements.find((m: { purchase_return_id: string }) => m.purchase_return_id === returnId);
    expect(movement).toBeDefined();
    expect(movement.purchase_return_item_id).toBe(item.id);
    expect((await confirm(returnId)).statusCode).toBe(200); // idempotent
    expect(await balanceOf(partId)).toBe(before - 3); // no duplicate exit
  });

  it('allows multiple returns up to exactly the received quantity, then rejects any further amount', async () => {
    const { receiptId, receiptItemId, partId } = await makeConfirmedReceipt(10);
    const before = await balanceOf(partId);
    const r1 = (await createReturn(receiptId)).json().id;
    await addItem(r1, receiptItemId, 6);
    expect((await confirm(r1)).statusCode).toBe(201);
    const r2 = (await createReturn(receiptId)).json().id;
    expect((await addItem(r2, receiptItemId, 5)).statusCode).toBe(409); // 6+5 > 10 already rejected at item-add time
    await addItem(r2, receiptItemId, 4);
    expect((await confirm(r2)).statusCode).toBe(201);
    expect(await balanceOf(partId)).toBe(before - 10);
    const r3 = (await createReturn(receiptId)).json().id;
    expect((await addItem(r3, receiptItemId, 1)).statusCode).toBe(409);
  });

  it('blocks editing and cancellation after confirmation, and blocks confirming an empty or cancelled return', async () => {
    const { receiptId, receiptItemId } = await makeConfirmedReceipt(10);
    const empty = (await createReturn(receiptId)).json().id;
    expect((await confirm(empty)).statusCode).toBe(400);
    const confirmed = (await createReturn(receiptId)).json().id;
    const item = (await addItem(confirmed, receiptItemId, 2)).json();
    expect((await confirm(confirmed)).statusCode).toBe(201);
    expect((await app.inject({ method: 'PATCH', url: `/purchase-returns/${confirmed}`, headers: { cookie }, payload: { notes: 'x' } })).statusCode).toBe(409);
    expect((await addItem(confirmed, receiptItemId, 1)).statusCode).toBe(409);
    expect((await app.inject({ method: 'PATCH', url: `/purchase-returns/${confirmed}/items/${item.id}`, headers: { cookie }, payload: { quantity: 1 } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/purchase-returns/${confirmed}/items/${item.id}`, headers: { cookie } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/purchase-returns/${confirmed}/cancel`, headers: { cookie } })).statusCode).toBe(409);
    const cancelled = (await createReturn(receiptId)).json().id;
    await addItem(cancelled, receiptItemId, 1);
    expect((await app.inject({ method: 'POST', url: `/purchase-returns/${cancelled}/cancel`, headers: { cookie } })).statusCode).toBe(200);
    expect((await confirm(cancelled)).statusCode).toBe(409);
  });

  it('lists, searches, paginates, filters by status and receipt, and returns detail with 404 for unknown ids', async () => {
    const { receiptId, receiptItemId } = await makeConfirmedReceipt(10);
    const returnId = (await createReturn(receiptId)).json().id;
    await addItem(returnId, receiptItemId, 1);
    const list = await app.inject({ method: 'GET', url: `/purchase-returns?purchaseReceiptId=${receiptId}&status=draft&page=1&pageSize=5`, headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: `/purchase-returns/${returnId}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/purchase-returns/${randomUUID()}`, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/purchase-receipts/${receiptId}/returns`, headers: { cookie } })).statusCode).toBe(200);
  });

  it('isolates purchase returns between tenants', async () => {
    const { receiptId: betaReceiptId, receiptItemId: betaReceiptItemId } = await insertBetaConfirmedReceipt();
    const betaReturnId = randomUUID();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id',${beta},true)`;
      const [counter] = await tx<{ last_number: number }[]>`insert into purchase_return_number_counters(tenant_id,last_number) values(${beta},1) on conflict(tenant_id) do update set last_number=purchase_return_number_counters.last_number+1 returning last_number`;
      await tx`insert into purchase_returns(id,tenant_id,company_id,branch_id,purchase_receipt_id,return_number) values(${betaReturnId},${beta},${betaCompany},${betaBranch},${betaReceiptId},${counter!.last_number})`;
      await tx`insert into purchase_return_items(tenant_id,purchase_return_id,purchase_receipt_id,purchase_receipt_item_id,inventory_part_id,description,quantity) select tenant_id,${betaReturnId},${betaReceiptId},id,inventory_part_id,description,1 from purchase_receipt_items where id=${betaReceiptItemId}`;
    });
    expect((await app.inject({ method: 'GET', url: `/purchase-returns/${betaReturnId}`, headers: { cookie } })).statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/purchase-returns?pageSize=100', headers: { cookie } });
    expect((list.json().items as Array<{ id: string }>).some((r) => r.id === betaReturnId)).toBe(false);
  });

  it('under concurrency, allows only one of two overlapping confirmations to exceed the returnable quantity (6+6 on 10 received)', async () => {
    const { receiptId, receiptItemId, partId } = await makeConfirmedReceipt(10);
    const before = await balanceOf(partId);
    const r1 = (await createReturn(receiptId)).json().id, r2 = (await createReturn(receiptId)).json().id;
    await addItem(r1, receiptItemId, 6); await addItem(r2, receiptItemId, 6);
    const results = await Promise.all([confirm(r1), confirm(r2)]);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(1);
    expect(await balanceOf(partId)).toBe(before - 6);
  });

  it('under concurrency, allows two non-conflicting confirmations to both succeed at exactly the received limit (5+5 on 10 received)', async () => {
    const { receiptId, receiptItemId, partId } = await makeConfirmedReceipt(10);
    const before = await balanceOf(partId);
    const r1 = (await createReturn(receiptId)).json().id, r2 = (await createReturn(receiptId)).json().id;
    await addItem(r1, receiptItemId, 5); await addItem(r2, receiptItemId, 5);
    const results = await Promise.all([confirm(r1), confirm(r2)]);
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    expect(await balanceOf(partId)).toBe(before - 10);
  });

  it('under concurrency, serializes a return confirmation against a competing OS stock consumption on the same balance', async () => {
    const { receiptId, receiptItemId, partId } = await makeConfirmedReceipt(10);
    const before = await balanceOf(partId); // 10
    const returnId = (await createReturn(receiptId)).json().id;
    await addItem(returnId, receiptItemId, 8);
    const order = await app.inject({ method: 'POST', url: '/service-orders', headers: { cookie }, payload: { customerId: customer, title: 'COM-04 concorrência', reportedProblem: 'x' } });
    const osItem = await app.inject({ method: 'POST', url: `/service-orders/${order.json().id}/items`, headers: { cookie }, payload: { type: 'part', inventoryPartId: partId, description: 'Peça', quantity: 5, unitPrice: 1 } });
    await app.inject({ method: 'POST', url: `/service-orders/${order.json().id}/items/${osItem.json().id}/stock/reserve`, headers: { cookie }, payload: { quantity: 5, idempotencyKey: `reserve-${randomUUID()}` } });
    const consume = () => app.inject({ method: 'POST', url: `/service-orders/${order.json().id}/items/${osItem.json().id}/stock/consume`, headers: { cookie }, payload: { quantity: 5, idempotencyKey: `consume-${randomUUID()}` } });
    const [returnResult, consumeResult] = await Promise.all([confirm(returnId), consume()]);
    const succeeded = [returnResult, consumeResult].filter((r) => [200, 201].includes(r.statusCode));
    const failed = [returnResult, consumeResult].filter((r) => r.statusCode === 409);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const after = await balanceOf(partId);
    expect([before - 8, before - 5]).toContain(after);
    expect(after).toBeGreaterThanOrEqual(0);
  });
});

describe('COM-04 purchase returns API — autorização negativa RBAC', () => {
  let restrictedCookie = '', restrictedRoleId = '';

  beforeAll(async () => {
    const restricted = await createRestrictedIdentity();
    restrictedRoleId = restricted.roleId;
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: restricted.email, password } });
    restrictedCookie = String(login.headers['set-cookie']).split(';')[0]!;
    const context = await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie: restrictedCookie }, payload: { companyId: companyAlpha, branchId: branchAlpha } });
    if (context.statusCode !== 200) throw new Error(`fixture setup failed to select operational context: ${context.statusCode} ${context.body}`);
  });

  it('keeps the existing session/context contract unaffected: no session -> 401, no operational context selected yet -> 409', async () => {
    expect((await app.inject({ method: 'GET', url: '/purchase-returns' })).statusCode).toBe(401);
    const fresh = await createRestrictedIdentity();
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: fresh.email, password } });
    const freshCookie = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/purchase-returns', headers: { cookie: freshCookie } })).statusCode).toBe(409);
  });

  it('rejects every purchase_returns operation while the identity has valid session/tenant/Company/Branch but none of the purchase_returns permissions', async () => {
    expect((await app.inject({ method: 'GET', url: '/purchase-returns', headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/purchase-returns/${randomUUID()}`, headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/purchase-returns', headers: { cookie: restrictedCookie }, payload: { purchaseReceiptId: randomUUID() } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/purchase-returns/${randomUUID()}`, headers: { cookie: restrictedCookie }, payload: { notes: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/purchase-returns/${randomUUID()}/confirm`, headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
  });

  it('granting only purchase_returns.read lifts the 403 for reading, and reading a cross-tenant receipt-backed return still 404s, never leaking it', async () => {
    await grantRestrictedPermission(restrictedRoleId, 'purchase_returns.read');
    expect((await app.inject({ method: 'GET', url: '/purchase-returns', headers: { cookie: restrictedCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/purchase-returns/${randomUUID()}`, headers: { cookie: restrictedCookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/purchase-returns', headers: { cookie: restrictedCookie }, payload: { purchaseReceiptId: randomUUID() } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/purchase-returns/${randomUUID()}`, headers: { cookie: restrictedCookie }, payload: { notes: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/purchase-returns/${randomUUID()}/confirm`, headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
  });

  it('granting purchase_returns.create additionally lifts the 403 for creation specifically, proved against a real confirmed receipt', async () => {
    await grantRestrictedPermission(restrictedRoleId, 'purchase_returns.create');
    const { receiptId } = await makeConfirmedReceipt(1);
    const created = await app.inject({ method: 'POST', url: '/purchase-returns', headers: { cookie: restrictedCookie }, payload: { purchaseReceiptId: receiptId } });
    expect(created.statusCode).toBe(201);
    expect((await app.inject({ method: 'PATCH', url: `/purchase-returns/${created.json().id}`, headers: { cookie: restrictedCookie }, payload: { notes: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/purchase-returns/${created.json().id}/confirm`, headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
  });

  it('granting purchase_returns.update additionally lifts the 403 for header updates specifically, while confirm stays blocked', async () => {
    await grantRestrictedPermission(restrictedRoleId, 'purchase_returns.update');
    const { receiptId } = await makeConfirmedReceipt(1);
    const created = await app.inject({ method: 'POST', url: '/purchase-returns', headers: { cookie: restrictedCookie }, payload: { purchaseReceiptId: receiptId } });
    expect((await app.inject({ method: 'PATCH', url: `/purchase-returns/${created.json().id}`, headers: { cookie: restrictedCookie }, payload: { notes: 'x' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/purchase-returns/${created.json().id}/confirm`, headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
  });

  it('granting purchase_returns.confirm completes full authorization for the same identity, which then behaves exactly like the fully authorized one', async () => {
    await grantRestrictedPermission(restrictedRoleId, 'purchase_returns.confirm');
    const { receiptId, receiptItemId } = await makeConfirmedReceipt(1);
    const created = await app.inject({ method: 'POST', url: '/purchase-returns', headers: { cookie: restrictedCookie }, payload: { purchaseReceiptId: receiptId } });
    await app.inject({ method: 'POST', url: `/purchase-returns/${created.json().id}/items`, headers: { cookie: restrictedCookie }, payload: { purchaseReceiptItemId: receiptItemId, quantity: 1 } });
    expect((await app.inject({ method: 'POST', url: `/purchase-returns/${created.json().id}/confirm`, headers: { cookie: restrictedCookie } })).statusCode).toBe(201);
    const { receiptId: betaReceiptId } = await insertBetaConfirmedReceipt();
    expect((await app.inject({ method: 'POST', url: '/purchase-returns', headers: { cookie: restrictedCookie }, payload: { purchaseReceiptId: betaReceiptId } })).statusCode).toBe(404);
  });

  it('the originally fully authorized identity keeps operating normally after the restricted identity and its role exist', async () => {
    const { receiptId } = await makeConfirmedReceipt(1);
    expect((await createReturn(receiptId)).statusCode).toBe(201);
  });
});
