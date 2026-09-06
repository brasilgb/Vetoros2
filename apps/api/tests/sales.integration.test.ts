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
const operationalContextSelectPermissionId = '01992ea1-1250-7000-8000-000000000033';
const beta = '01992ea1-1250-7000-8000-000000000020', betaCompany = '01992ea1-1250-7000-8000-000000000022', betaBranch = '01992ea1-1250-7000-8000-000000000023';
const service = new AuthService(authUrl, runtimeUrl, 3600), app = buildApp({ authService: service, loginRateLimitMax: 100 }), admin = postgres(migrationUrl);
let cookie = '';

const balanceOf = async (partId: string) => Number((await app.inject({ method: 'GET', url: `/inventory/parts/${partId}`, headers: { cookie } })).json().balance);
async function makePartWithBalance(quantity: number) {
  const partId = await makePart();
  await app.inject({ method: 'POST', url: '/inventory/movements', headers: { cookie }, payload: { partId, type: 'entry', quantity, reason: 'Estoque inicial VEN-02' } });
  return partId;
}
async function makePart() {
  const part = await app.inject({ method: 'POST', url: '/inventory/parts', headers: { cookie }, payload: { sku: `SKU-${randomUUID()}`, description: 'Peça VEN-01', unit: 'un' } });
  return part.json().id;
}
async function insertBetaCustomer() {
  const id = randomUUID();
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${beta},true)`;
    const [counter] = await tx<{ last_number: number }[]>`insert into customer_number_counters(tenant_id,last_number) values(${beta},1) on conflict(tenant_id) do update set last_number=customer_number_counters.last_number+1 returning last_number`;
    await tx`insert into customers(id,tenant_id,customer_number,person_type,legal_name) values(${id},${beta},${counter!.last_number},'individual','Cliente Beta')`;
  });
  return id;
}
async function insertBetaSale() {
  const id = randomUUID();
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${beta},true)`;
    const [counter] = await tx<{ last_number: number }[]>`insert into sale_number_counters(tenant_id,last_number) values(${beta},1) on conflict(tenant_id) do update set last_number=sale_number_counters.last_number+1 returning last_number`;
    await tx`insert into sales(id,tenant_id,company_id,branch_id,sale_number) values(${id},${beta},${betaCompany},${betaBranch},${counter!.last_number})`;
  });
  return id;
}
async function insertBetaPart() {
  const id = randomUUID();
  await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${beta},true)`; await tx`insert into inventory_parts(id,tenant_id,sku,description,unit) values(${id},${beta},${`SKU-${randomUUID()}`},'Peça Beta','un')`; });
  return id;
}
async function createRestrictedIdentity() {
  const identityId = randomUUID(), membershipId = randomUUID(), profileId = randomUUID(), roleId = randomUUID(), grantId = randomUUID();
  const email = `restricted-ven01-${randomUUID()}@vetoros.local`;
  const [existing] = await admin<{ password_hash: string }[]>`select password_hash from identities where email_normalized='single@vetoros.local'`;
  await admin`insert into identities(id,email_normalized,password_hash,display_name,status) values(${identityId},${email},${existing!.password_hash},'Restrito VEN-01','active')`;
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenantAlpha},true)`;
    await tx`insert into tenant_memberships(id,tenant_id,identity_id,status) values(${membershipId},${tenantAlpha},${identityId},'active')`;
    await tx`insert into tenant_user_profiles(id,tenant_id,membership_id,name) values(${profileId},${tenantAlpha},${membershipId},'Restrito VEN-01')`;
    await tx`insert into tenant_roles(id,tenant_id,code,name,scope_type) values(${roleId},${tenantAlpha},${`ven01_restricted_${roleId}`},'VEN-01 restricted','tenant')`;
    await tx`insert into tenant_role_permissions(tenant_id,role_id,permission_id) values(${tenantAlpha},${roleId},${operationalContextSelectPermissionId})`;
    await tx`insert into access_grants(id,tenant_id,user_profile_id,role_id,scope_type) values(${grantId},${tenantAlpha},${profileId},${roleId},'tenant')`;
  });
  return { email, roleId };
}
async function grantRestrictedPermission(roleId: string, code: string) {
  const [permission] = await admin<{ id: string }[]>`select id from permissions where code=${code}`;
  await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${tenantAlpha},true)`; await tx`insert into tenant_role_permissions(tenant_id,role_id,permission_id) values(${tenantAlpha},${roleId},${permission!.id}) on conflict do nothing`; });
}

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId: companyAlpha, branchId: branchAlpha } });
});
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

const create = (overrides: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/sales', headers: { cookie }, payload: { ...overrides } });
const addItem = (saleId: string, overrides: Record<string, unknown>) => app.inject({ method: 'POST', url: `/sales/${saleId}/items`, headers: { cookie }, payload: overrides });
const confirm = (saleId: string) => app.inject({ method: 'POST', url: `/sales/${saleId}/confirm`, headers: { cookie } });
const cancel = (saleId: string) => app.inject({ method: 'POST', url: `/sales/${saleId}/cancel`, headers: { cookie } });

describe('VEN-01 sales API', () => {
  it('requires authentication and operational context', async () => {
    expect((await app.inject({ method: 'GET', url: '/sales' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'shared@vetoros.local', password } });
    expect((await app.inject({ method: 'GET', url: '/sales', headers: { cookie: String(login.headers['set-cookie']).split(';')[0]! } })).statusCode).toBe(409);
  });

  it('creates a sale with no customer (anonymous) and with a valid same-tenant customer, rejecting a nonexistent or cross-tenant one', async () => {
    const anonymous = await create();
    expect(anonymous.statusCode).toBe(201);
    expect(anonymous.json().customer_id).toBeNull();
    const withCustomer = await create({ customerId: customer });
    expect(withCustomer.statusCode).toBe(201);
    expect((await create({ customerId: randomUUID() })).statusCode).toBe(404);
    const betaCustomerId = await insertBetaCustomer();
    expect((await create({ customerId: betaCustomerId })).statusCode).toBe(404);
  });

  it('rejects immutable/invalid payload fields', async () => {
    expect((await app.inject({ method: 'POST', url: '/sales', headers: { cookie }, payload: { tenantId: randomUUID(), saleNumber: 1 } })).statusCode).toBe(400);
  });

  it('generates unique sequential numbers under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => create()));
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const numbers = results.map((r) => Number(r.json().sale_number));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('validates items: type/part correspondence, part existence and ownership, and monetary rules, computing deterministic totals', async () => {
    const saleId = (await create()).json().id;
    const partId = await makePart();
    expect((await addItem(saleId, { type: 'service', inventoryPartId: partId, description: 'x', quantity: 1, unitPrice: 1 })).statusCode).toBe(400);
    expect((await addItem(saleId, { type: 'part', inventoryPartId: randomUUID(), description: 'x', quantity: 1, unitPrice: 1 })).statusCode).toBe(404);
    const betaPartId = await insertBetaPart();
    expect((await addItem(saleId, { type: 'part', inventoryPartId: betaPartId, description: 'x', quantity: 1, unitPrice: 1 })).statusCode).toBe(404);
    expect((await addItem(saleId, { type: 'part', description: 'x', quantity: 0, unitPrice: 1 })).statusCode).toBe(400);
    expect((await addItem(saleId, { type: 'part', description: 'x', quantity: -1, unitPrice: 1 })).statusCode).toBe(400);
    expect((await addItem(saleId, { type: 'part', description: 'x', quantity: 1, unitPrice: 1, discountAmount: -1 })).statusCode).toBe(400);
    expect((await addItem(saleId, { type: 'part', description: 'x', quantity: 1, unitPrice: 10, discountAmount: 11 })).statusCode).toBe(400);
    const first = await addItem(saleId, { type: 'part', inventoryPartId: partId, description: 'Peça vendida', quantity: 2, unitPrice: 10, discountAmount: 1 });
    expect(first.statusCode).toBe(201);
    expect(Number(first.json().total)).toBe(19);
    await addItem(saleId, { type: 'service', description: 'Mão de obra', quantity: 1, unitPrice: 50 });
    const detail = (await app.inject({ method: 'GET', url: `/sales/${saleId}`, headers: { cookie } })).json();
    expect(detail.items).toHaveLength(2);
    expect(detail.subtotal).toBe(70); // 2*10 + 1*50, gross
    expect(detail.discount_total).toBe(1);
    expect(detail.total).toBe(69);
  });

  it('edits header and items while draft, blocks structural changes once confirmed, is idempotent on reconfirmation, and blocks confirming an empty or cancelled sale', async () => {
    const saleId = (await create({ notes: 'inicial' })).json().id;
    expect((await app.inject({ method: 'PATCH', url: `/sales/${saleId}`, headers: { cookie }, payload: { notes: 'editada' } })).statusCode).toBe(200);
    const empty = (await create()).json().id;
    expect((await confirm(empty)).statusCode).toBe(400);
    const item = (await addItem(saleId, { type: 'service', description: 'x', quantity: 1, unitPrice: 10 })).json();
    expect((await confirm(saleId)).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/sales/${saleId}`, headers: { cookie }, payload: { notes: 'y' } })).statusCode).toBe(409);
    expect((await addItem(saleId, { type: 'service', description: 'x', quantity: 1, unitPrice: 1 })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PATCH', url: `/sales/${saleId}/items/${item.id}`, headers: { cookie }, payload: { quantity: 2 } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/sales/${saleId}/items/${item.id}`, headers: { cookie } })).statusCode).toBe(409);
    expect((await confirm(saleId)).statusCode).toBe(200); // VEN-02: reconfirming an already-confirmed sale is idempotent, not an error
    expect((await app.inject({ method: 'POST', url: `/sales/${saleId}/cancel`, headers: { cookie } })).statusCode).toBe(200); // VEN-03: cancelling a confirmed sale is now a valid transition
    expect((await confirm(saleId)).statusCode).toBe(409); // cancelled is terminal: confirming it back is not a valid transition
    const cancelled = (await create()).json().id;
    await addItem(cancelled, { type: 'service', description: 'x', quantity: 1, unitPrice: 1 });
    expect((await app.inject({ method: 'POST', url: `/sales/${cancelled}/cancel`, headers: { cookie } })).statusCode).toBe(200);
    expect((await confirm(cancelled)).statusCode).toBe(409);
  });

  it('lists, searches, paginates, filters by status and customer, and returns detail with 404 for unknown ids', async () => {
    const made = await create({ customerId: customer });
    const list = await app.inject({ method: 'GET', url: `/sales?customerId=${customer}&status=draft&page=1&pageSize=5`, headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: `/sales/${made.json().id}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/sales/${randomUUID()}`, headers: { cookie } })).statusCode).toBe(404);
  });

  it('isolates sales between tenants', async () => {
    const betaSaleId = await insertBetaSale();
    expect((await app.inject({ method: 'GET', url: `/sales/${betaSaleId}`, headers: { cookie } })).statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/sales?pageSize=100', headers: { cookie } });
    expect((list.json().items as Array<{ id: string }>).some((sale) => sale.id === betaSaleId)).toBe(false);
  });
});

describe('VEN-02 sale stock integration', () => {
  it('confirming a sale with only a service item never touches stock', async () => {
    const partId = await makePartWithBalance(10);
    const before = await balanceOf(partId);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'service', description: 'Mão de obra', quantity: 1, unitPrice: 50 });
    expect((await confirm(saleId)).statusCode).toBe(200);
    expect(await balanceOf(partId)).toBe(before);
  });

  it('confirming a sale with a part item that has no inventory_part_id never touches stock', async () => {
    const partId = await makePartWithBalance(10);
    const before = await balanceOf(partId);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'part', description: 'Peça avulsa sem vínculo', quantity: 2, unitPrice: 5 });
    expect((await confirm(saleId)).statusCode).toBe(200);
    expect(await balanceOf(partId)).toBe(before);
  });

  it('confirming a sale with a linked part generates exactly one exit with traceable origin, and stays idempotent on reconfirmation', async () => {
    const partId = await makePartWithBalance(10);
    const before = await balanceOf(partId);
    const saleId = (await create()).json().id;
    const item = (await addItem(saleId, { type: 'part', inventoryPartId: partId, description: 'Peça vendida', quantity: 3.5, unitPrice: 20 })).json();
    expect((await confirm(saleId)).statusCode).toBe(200);
    expect(await balanceOf(partId)).toBe(before - 3.5);
    const movements = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partId}&type=exit`, headers: { cookie } })).json().items;
    const movement = movements.find((m: { sale_id: string }) => m.sale_id === saleId);
    expect(movement).toBeDefined();
    expect(movement.sale_item_id).toBe(item.id);
    expect((await confirm(saleId)).statusCode).toBe(200); // idempotent
    expect(await balanceOf(partId)).toBe(before - 3.5); // no duplicate exit
  });

  it('handles multiple linked parts in one sale, including the boundary where balance equals the sold quantity exactly', async () => {
    const partA = await makePartWithBalance(10), partB = await makePartWithBalance(4);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'part', inventoryPartId: partA, description: 'A', quantity: 2, unitPrice: 10 });
    await addItem(saleId, { type: 'part', inventoryPartId: partB, description: 'B', quantity: 4, unitPrice: 10 }); // exactly the available balance
    expect((await confirm(saleId)).statusCode).toBe(200);
    expect(await balanceOf(partA)).toBe(8);
    expect(await balanceOf(partB)).toBe(0);
  });

  it('rejects confirmation when a linked part has insufficient balance, leaving the sale in draft and stock untouched', async () => {
    const partId = await makePartWithBalance(2);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'part', inventoryPartId: partId, description: 'Peça', quantity: 3, unitPrice: 10 });
    const result = await confirm(saleId);
    expect(result.statusCode).toBe(409);
    expect(result.json().error).toBe('insufficient_stock');
    expect(await balanceOf(partId)).toBe(2);
    expect((await app.inject({ method: 'GET', url: `/sales/${saleId}`, headers: { cookie } })).json().status).toBe('draft');
  });

  it('atomicity gate: one insufficient item among several rolls back the whole confirmation, leaving every balance and the sale untouched', async () => {
    const partA = await makePartWithBalance(10), partB = await makePartWithBalance(1);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'part', inventoryPartId: partA, description: 'A com saldo suficiente', quantity: 5, unitPrice: 10 });
    await addItem(saleId, { type: 'part', inventoryPartId: partB, description: 'B sem saldo suficiente', quantity: 5, unitPrice: 10 });
    const result = await confirm(saleId);
    expect(result.statusCode).toBe(409);
    expect(await balanceOf(partA)).toBe(10); // unchanged, even though A alone had enough
    expect(await balanceOf(partB)).toBe(1);
    const detail = (await app.inject({ method: 'GET', url: `/sales/${saleId}`, headers: { cookie } })).json();
    expect(detail.status).toBe('draft');
    const movements = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partA}&type=exit`, headers: { cookie } })).json().items;
    expect(movements.some((m: { sale_id: string }) => m.sale_id === saleId)).toBe(false);
  });

  it('concurrency gate: two confirmations of the same sale never duplicate the exit', async () => {
    const partId = await makePartWithBalance(10);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'part', inventoryPartId: partId, description: 'Peça', quantity: 4, unitPrice: 10 });
    const results = await Promise.allSettled([confirm(saleId), confirm(saleId)]);
    const codes = results.map((r) => (r.status === 'fulfilled' ? r.value.statusCode : -1));
    expect(codes.every((c) => c === 200)).toBe(true);
    expect(await balanceOf(partId)).toBe(6);
  });

  it('concurrency gate: two independent sales competing for the same balance never allow overselling (5 available, 4+4 requested)', async () => {
    const partId = await makePartWithBalance(5);
    const saleA = (await create()).json().id, saleB = (await create()).json().id;
    await addItem(saleA, { type: 'part', inventoryPartId: partId, description: 'Peça', quantity: 4, unitPrice: 10 });
    await addItem(saleB, { type: 'part', inventoryPartId: partId, description: 'Peça', quantity: 4, unitPrice: 10 });
    const [resultA, resultB] = await Promise.allSettled([confirm(saleA), confirm(saleB)]);
    const codeOf = (r: PromiseSettledResult<{ statusCode: number }>) => (r.status === 'fulfilled' ? r.value.statusCode : -1);
    const codes = [codeOf(resultA), codeOf(resultB)];
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(1);
    expect(await balanceOf(partId)).toBe(1);
    const statuses = await Promise.all([saleA, saleB].map(async (id) => (await app.inject({ method: 'GET', url: `/sales/${id}`, headers: { cookie } })).json().status));
    expect(statuses.filter((st) => st === 'confirmed')).toHaveLength(1);
    expect(statuses.filter((st) => st === 'draft')).toHaveLength(1);
    const movements = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partId}&type=exit`, headers: { cookie } })).json().items;
    expect(movements.filter((m: { sale_id: string | null }) => m.sale_id === saleA || m.sale_id === saleB)).toHaveLength(1);
  });

  it('regression: EST-02 manual stock movements keep working unaffected by the record_stock_movement signature extension', async () => {
    const partId = await makePart();
    const entry = await app.inject({ method: 'POST', url: '/inventory/movements', headers: { cookie }, payload: { partId, type: 'entry', quantity: 5, reason: 'Regressão VEN-02' } });
    expect(entry.statusCode).toBe(201);
    expect(await balanceOf(partId)).toBe(5);
  });
});

describe('VEN-03 sale cancellation with stock reversal', () => {
  it('cancelling a draft sale is a pure status change: zero movements, balance intact', async () => {
    const partId = await makePartWithBalance(10);
    const before = await balanceOf(partId);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'part', inventoryPartId: partId, description: 'Peça', quantity: 2, unitPrice: 10 });
    const result = await cancel(saleId);
    expect(result.statusCode).toBe(200);
    expect(result.json().status).toBe('cancelled');
    expect(await balanceOf(partId)).toBe(before);
    const movements = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partId}`, headers: { cookie } })).json().items;
    expect(movements.some((m: { sale_id: string | null }) => m.sale_id === saleId)).toBe(false);
  });

  it('cancelling a confirmed sale reverses exactly the exit quantity, with traceable exit/reversal pair in the ledger', async () => {
    const partId = await makePartWithBalance(10);
    const saleId = (await create()).json().id;
    const item = (await addItem(saleId, { type: 'part', inventoryPartId: partId, description: 'Peça', quantity: 4, unitPrice: 10 })).json();
    expect((await confirm(saleId)).statusCode).toBe(200);
    expect(await balanceOf(partId)).toBe(6);
    const result = await cancel(saleId);
    expect(result.statusCode).toBe(200);
    expect(result.json().status).toBe('cancelled');
    expect(await balanceOf(partId)).toBe(10);
    const movements = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partId}`, headers: { cookie } })).json().items as Array<{ sale_id: string; sale_item_id: string; type: string; quantity: string }>;
    const forSale = movements.filter((m) => m.sale_id === saleId);
    expect(forSale).toHaveLength(2);
    const exit = forSale.find((m) => m.type === 'exit')!, reversal = forSale.find((m) => m.type === 'entry')!;
    expect(exit).toBeDefined(); expect(reversal).toBeDefined();
    expect(exit.sale_item_id).toBe(item.id); expect(reversal.sale_item_id).toBe(item.id);
    expect(Number(exit.quantity)).toBe(4); expect(Number(reversal.quantity)).toBe(4);
  });

  it('handles multiple linked parts, reversing each individually back to its original balance', async () => {
    const partA = await makePartWithBalance(10), partB = await makePartWithBalance(20);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'part', inventoryPartId: partA, description: 'A', quantity: 3, unitPrice: 10 });
    await addItem(saleId, { type: 'part', inventoryPartId: partB, description: 'B', quantity: 7, unitPrice: 10 });
    expect((await confirm(saleId)).statusCode).toBe(200);
    expect(await balanceOf(partA)).toBe(7);
    expect(await balanceOf(partB)).toBe(13);
    expect((await cancel(saleId)).statusCode).toBe(200);
    expect(await balanceOf(partA)).toBe(10);
    expect(await balanceOf(partB)).toBe(20);
    const movementsA = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partA}`, headers: { cookie } })).json().items;
    const movementsB = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partB}`, headers: { cookie } })).json().items;
    expect(movementsA.filter((m: { sale_id: string }) => m.sale_id === saleId)).toHaveLength(2);
    expect(movementsB.filter((m: { sale_id: string }) => m.sale_id === saleId)).toHaveLength(2);
  });

  it('only the linked part participates in cancellation reversal — service and unlinked-part items never move stock', async () => {
    const partId = await makePartWithBalance(10);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'service', description: 'Serviço', quantity: 1, unitPrice: 50 });
    await addItem(saleId, { type: 'part', description: 'Peça avulsa sem vínculo', quantity: 2, unitPrice: 5 });
    await addItem(saleId, { type: 'part', inventoryPartId: partId, description: 'Peça vinculada', quantity: 4, unitPrice: 10 });
    expect((await confirm(saleId)).statusCode).toBe(200);
    expect(await balanceOf(partId)).toBe(6);
    expect((await cancel(saleId)).statusCode).toBe(200);
    expect(await balanceOf(partId)).toBe(10);
    const movements = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partId}`, headers: { cookie } })).json().items.filter((m: { sale_id: string }) => m.sale_id === saleId);
    expect(movements).toHaveLength(2); // exactly the linked part's exit + reversal, nothing for the other two items
  });

  it('is idempotent sequentially: cancelling an already-cancelled sale never reverses stock twice', async () => {
    const partId = await makePartWithBalance(10);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'part', inventoryPartId: partId, description: 'Peça', quantity: 4, unitPrice: 10 });
    await confirm(saleId);
    expect((await cancel(saleId)).statusCode).toBe(200);
    expect(await balanceOf(partId)).toBe(10);
    const second = await cancel(saleId);
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotent).toBe(true);
    expect(await balanceOf(partId)).toBe(10); // still 10, never 14
    const movements = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partId}`, headers: { cookie } })).json().items.filter((m: { sale_id: string }) => m.sale_id === saleId);
    expect(movements).toHaveLength(2); // one exit, one reversal — never a second reversal
  });

  it('concurrency gate: two concurrent cancellations of the same confirmed sale never reverse stock twice', async () => {
    const partId = await makePartWithBalance(10);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'part', inventoryPartId: partId, description: 'Peça', quantity: 4, unitPrice: 10 });
    await confirm(saleId);
    const results = await Promise.allSettled([cancel(saleId), cancel(saleId)]);
    const codes = results.map((r) => (r.status === 'fulfilled' ? r.value.statusCode : -1));
    expect(codes.every((c) => c === 200)).toBe(true);
    expect(await balanceOf(partId)).toBe(10);
    const movements = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partId}`, headers: { cookie } })).json().items.filter((m: { sale_id: string }) => m.sale_id === saleId);
    expect(movements).toHaveLength(2);
  });

  // Duas ordens de lock são possíveis (ambas via o mesmo `select ... for update` na venda):
  // (a) cancel adquire o lock primeiro: vê `draft`, apenas muda o status (sem tocar estoque);
  //     confirm, ao ser liberado, vê `cancelled` e falha com 409 (transição inválida) — nunca
  //     confirma uma venda já cancelada;
  // (b) confirm adquire o lock primeiro: baixa o estoque e confirma; cancel, ao ser liberado,
  //     vê `confirmed` e aplica o estorno normalmente, terminando `cancelled`.
  // Em AMBAS as ordens o estado final é sempre `cancelled` com saldo restaurado — nunca
  // `confirmed` com estoque baixado permanentemente sem chance de estorno, nunca saldo
  // inconsistente, nunca uma saída sem seu estorno correspondente.
  it('concurrency gate: confirm and cancel racing on the same draft sale always converge to cancelled with the balance restored', async () => {
    const partId = await makePartWithBalance(10);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'part', inventoryPartId: partId, description: 'Peça', quantity: 4, unitPrice: 10 });
    await Promise.allSettled([confirm(saleId), cancel(saleId)]);
    const detail = (await app.inject({ method: 'GET', url: `/sales/${saleId}`, headers: { cookie } })).json();
    const balance = await balanceOf(partId);
    const movements = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partId}`, headers: { cookie } })).json().items.filter((m: { sale_id: string }) => m.sale_id === saleId);
    expect(detail.status).toBe('cancelled');
    expect(balance).toBe(10);
    expect([0, 2]).toContain(movements.length); // 0 if cancel raced from draft, 2 (exit+reversal) if confirm completed first — never 1 (stuck exit with no reversal)
  });

  it('rollback gate: a legitimate failure mid-reversal (part deactivated between confirm and cancel) leaves the sale confirmed and every balance untouched', async () => {
    const partA = await makePartWithBalance(10), partB = await makePartWithBalance(10);
    const saleId = (await create()).json().id;
    await addItem(saleId, { type: 'part', inventoryPartId: partA, description: 'A', quantity: 3, unitPrice: 10 });
    await addItem(saleId, { type: 'part', inventoryPartId: partB, description: 'B', quantity: 3, unitPrice: 10 });
    expect((await confirm(saleId)).statusCode).toBe(200);
    expect(await balanceOf(partA)).toBe(7);
    expect(await balanceOf(partB)).toBe(7);
    const deactivate = await app.inject({ method: 'PATCH', url: `/inventory/parts/${partB}`, headers: { cookie }, payload: { status: 'inactive' } });
    expect(deactivate.statusCode).toBe(200);
    const result = await cancel(saleId);
    expect(result.statusCode).toBe(404); // record_stock_movement rejects the inactive part (23503), the whole reversal rolls back
    expect(await balanceOf(partA)).toBe(7); // unchanged, even though A alone had an active part and would have succeeded
    expect(await balanceOf(partB)).toBe(7);
    const detail = (await app.inject({ method: 'GET', url: `/sales/${saleId}`, headers: { cookie } })).json();
    expect(detail.status).toBe('confirmed'); // never flipped to cancelled
    const movementsA = (await app.inject({ method: 'GET', url: `/inventory/movements?partId=${partA}`, headers: { cookie } })).json().items.filter((m: { sale_id: string }) => m.sale_id === saleId);
    expect(movementsA).toHaveLength(1); // only the original exit — no reversal was persisted for A either
  });
});

describe('VEN-01 sales API — autorização negativa RBAC', () => {
  let restrictedCookie = '', restrictedRoleId = '';

  beforeAll(async () => {
    const restricted = await createRestrictedIdentity();
    restrictedRoleId = restricted.roleId;
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: restricted.email, password } });
    restrictedCookie = String(login.headers['set-cookie']).split(';')[0]!;
    const context = await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie: restrictedCookie }, payload: { companyId: companyAlpha, branchId: branchAlpha } });
    if (context.statusCode !== 200) throw new Error(`fixture setup failed to select operational context: ${context.statusCode} ${context.body}`);
  });

  it('keeps the existing session/context contract: no session -> 401, no operational context selected yet -> 409', async () => {
    expect((await app.inject({ method: 'GET', url: '/sales' })).statusCode).toBe(401);
    const fresh = await createRestrictedIdentity();
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: fresh.email, password } });
    const freshCookie = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/sales', headers: { cookie: freshCookie } })).statusCode).toBe(409);
  });

  it('rejects every sales operation while the identity has a valid session/tenant/Company/Branch but no sales permission', async () => {
    expect((await app.inject({ method: 'GET', url: '/sales', headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/sales/${randomUUID()}`, headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/sales', headers: { cookie: restrictedCookie }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/sales/${randomUUID()}`, headers: { cookie: restrictedCookie }, payload: { notes: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/sales/${randomUUID()}/confirm`, headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
  });

  it('granting only sales.read lifts the 403 for reading, but not for the other three', async () => {
    await grantRestrictedPermission(restrictedRoleId, 'sales.read');
    expect((await app.inject({ method: 'GET', url: '/sales', headers: { cookie: restrictedCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/sales/${randomUUID()}`, headers: { cookie: restrictedCookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/sales', headers: { cookie: restrictedCookie }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/sales/${randomUUID()}`, headers: { cookie: restrictedCookie }, payload: { notes: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/sales/${randomUUID()}/confirm`, headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
  });

  it('granting sales.create additionally lifts the 403 for creation specifically', async () => {
    await grantRestrictedPermission(restrictedRoleId, 'sales.create');
    const created = await app.inject({ method: 'POST', url: '/sales', headers: { cookie: restrictedCookie }, payload: {} });
    expect(created.statusCode).toBe(201);
    expect((await app.inject({ method: 'PATCH', url: `/sales/${created.json().id}`, headers: { cookie: restrictedCookie }, payload: { notes: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/sales/${created.json().id}/confirm`, headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
  });

  it('granting sales.update additionally lifts the 403 for header/item edits specifically, while confirm stays blocked', async () => {
    await grantRestrictedPermission(restrictedRoleId, 'sales.update');
    const created = await app.inject({ method: 'POST', url: '/sales', headers: { cookie: restrictedCookie }, payload: {} });
    expect((await app.inject({ method: 'PATCH', url: `/sales/${created.json().id}`, headers: { cookie: restrictedCookie }, payload: { notes: 'x' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/sales/${created.json().id}/items`, headers: { cookie: restrictedCookie }, payload: { type: 'service', description: 'x', quantity: 1, unitPrice: 1 } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `/sales/${created.json().id}/confirm`, headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
  });

  it('granting sales.confirm completes full authorization, which then behaves like the fully authorized identity, without leaking cross-tenant data', async () => {
    await grantRestrictedPermission(restrictedRoleId, 'sales.confirm');
    const created = await app.inject({ method: 'POST', url: '/sales', headers: { cookie: restrictedCookie }, payload: {} });
    await app.inject({ method: 'POST', url: `/sales/${created.json().id}/items`, headers: { cookie: restrictedCookie }, payload: { type: 'service', description: 'x', quantity: 1, unitPrice: 1 } });
    expect((await app.inject({ method: 'POST', url: `/sales/${created.json().id}/confirm`, headers: { cookie: restrictedCookie } })).statusCode).toBe(200);
    const betaSaleId = await insertBetaSale();
    expect((await app.inject({ method: 'GET', url: `/sales/${betaSaleId}`, headers: { cookie: restrictedCookie } })).statusCode).toBe(404);
  });

  it('the originally fully authorized identity keeps operating normally after the restricted identity and its role exist', async () => {
    expect((await create()).statusCode).toBe(201);
  });
});
