import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

// FIN-03 — suíte de integração da API. Ver executed.md "Testes" para a lista completa. Segue o
// mesmo padrão de receivables.integration.test.ts/purchase-orders.integration.test.ts: `app.inject()`
// contra um Postgres real, login como `single@vetoros.local` (todas as permissions via a
// reconciliação do SAN-01), `admin` (conexão vetoros_migration) para fixtures cross-tenant.

const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const tenantAlpha = '01992ea1-1250-7000-8000-000000000010', companyAlpha = '01992ea1-1250-7000-8000-000000000012', branchAlpha = '01992ea1-1250-7000-8000-000000000013';
const beta = '01992ea1-1250-7000-8000-000000000020', betaCompany = '01992ea1-1250-7000-8000-000000000022', betaBranch = '01992ea1-1250-7000-8000-000000000023';
const operationalContextSelectPermissionId = '01992ea1-1250-7000-8000-000000000033';
const service = new AuthService(authUrl, runtimeUrl, 3600), app = buildApp({ authService: service, loginRateLimitMax: 1000 }), admin = postgres(migrationUrl);
let cookie = '';

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId: companyAlpha, branchId: branchAlpha } });
});
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

// ---- Helpers ----
const create = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/payables', headers: { cookie }, payload });
const patch = (id: string, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/payables/${id}`, headers: { cookie }, payload });
const pay = (payableId: string, installmentId: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/payables/${payableId}/installments/${installmentId}/payments`, headers: { cookie }, payload });
const reverse = (payableId: string, installmentId: string, paymentId: string, payload: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `/payables/${payableId}/installments/${installmentId}/payments/${paymentId}/reverse`, headers: { cookie }, payload });
const cancel = (payableId: string, payload: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `/payables/${payableId}/cancel`, headers: { cookie }, payload });
const getPayable = (payableId: string) => app.inject({ method: 'GET', url: `/payables/${payableId}`, headers: { cookie } });
const listPayables = (query = '') => app.inject({ method: 'GET', url: `/payables?${query}`, headers: { cookie } });

async function makeSupplier() {
  const response = await app.inject({ method: 'POST', url: '/suppliers', headers: { cookie }, payload: { personType: 'company', legalName: `Fornecedor FIN-03 ${randomUUID()}` } });
  return response.json().id as string;
}
async function makePart() {
  const response = await app.inject({ method: 'POST', url: '/inventory/parts', headers: { cookie }, payload: { sku: `SKU-FIN03-${randomUUID()}`, description: 'Peça FIN-03', unit: 'un' } });
  return response.json().id as string;
}
/** Pedido de compra APROVADO com total exato (quantity*unitCost). */
async function makeApprovedPurchaseOrder(supplierId: string, partId: string, total: number) {
  const order = (await app.inject({ method: 'POST', url: '/purchase-orders', headers: { cookie }, payload: { supplierId } })).json();
  await app.inject({ method: 'POST', url: `/purchase-orders/${order.id}/items`, headers: { cookie }, payload: { inventoryPartId: partId, quantity: 1, unitCost: total } });
  await app.inject({ method: 'POST', url: `/purchase-orders/${order.id}/approve`, headers: { cookie } });
  return order.id as string;
}
async function createRestrictedIdentity() {
  const identityId = randomUUID(), membershipId = randomUUID(), profileId = randomUUID(), roleId = randomUUID(), grantId = randomUUID();
  const email = `restricted-fin03-${randomUUID()}@vetoros.local`;
  const [existing] = await admin<{ password_hash: string }[]>`select password_hash from identities where email_normalized='single@vetoros.local'`;
  await admin`insert into identities(id,email_normalized,password_hash,display_name,status) values(${identityId},${email},${existing!.password_hash},'Restrito FIN-03','active')`;
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenantAlpha},true)`;
    await tx`insert into tenant_memberships(id,tenant_id,identity_id,status) values(${membershipId},${tenantAlpha},${identityId},'active')`;
    await tx`insert into tenant_user_profiles(id,tenant_id,membership_id,name) values(${profileId},${tenantAlpha},${membershipId},'Restrito FIN-03')`;
    await tx`insert into tenant_roles(id,tenant_id,code,name,scope_type) values(${roleId},${tenantAlpha},${`fin03_restricted_${roleId}`},'FIN-03 restricted','tenant')`;
    await tx`insert into tenant_role_permissions(tenant_id,role_id,permission_id) values(${tenantAlpha},${roleId},${operationalContextSelectPermissionId})`;
    await tx`insert into access_grants(id,tenant_id,user_profile_id,role_id,scope_type) values(${grantId},${tenantAlpha},${profileId},${roleId},'tenant')`;
  });
  return { email };
}
async function loginAs(email: string) {
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  const restrictedCookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie: restrictedCookie }, payload: { companyId: companyAlpha, branchId: branchAlpha } });
  return restrictedCookie;
}
async function insertBetaPayable() {
  const payableId = randomUUID(), installmentId = randomUUID();
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${beta},true)`;
    await tx`insert into payables(id,tenant_id,company_id,branch_id,description,original_amount) values(${payableId},${beta},${betaCompany},${betaBranch},'Título Beta',50)`;
    await tx`insert into payable_installments(id,tenant_id,company_id,branch_id,payable_id,installment_number,installment_count,original_amount,due_date) values(${installmentId},${beta},${betaCompany},${betaBranch},${payableId},1,1,50,current_date)`;
  });
  return { payableId, installmentId };
}

describe('FIN-03 creation (título/parcela)', () => {
  it('requires authentication and full operational context', async () => {
    expect((await app.inject({ method: 'GET', url: '/payables' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'shared@vetoros.local', password } });
    expect((await app.inject({ method: 'GET', url: '/payables', headers: { cookie: String(login.headers['set-cookie']).split(';')[0]! } })).statusCode).toBe(409);
  });

  it('creates a manual payable with a single installment', async () => {
    const created = await create({ description: 'Despesa administrativa', installments: [{ amount: 150, dueDate: '2026-12-01' }] });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ original_amount: '150.00', status: 'active' });
  });

  it('creates a manual payable split into multiple installments summing exactly to the total', async () => {
    const created = await create({ description: 'Despesa parcelada', installments: [{ amount: 100, dueDate: '2026-10-01' }, { amount: 100, dueDate: '2026-11-01' }, { amount: 100, dueDate: '2026-12-01' }] });
    expect(created.statusCode).toBe(201);
    expect(created.json().original_amount).toBe('300.00');
  });

  it('rejects installments whose sum does not match the purchase order total (origem inequívoca)', async () => {
    const supplierId = await makeSupplier(), partId = await makePart();
    const poId = await makeApprovedPurchaseOrder(supplierId, partId, 500);
    const created = await create({ purchaseOrderId: poId, description: 'Compra com soma errada', installments: [{ amount: 400, dueDate: '2026-12-01' }] });
    expect(created.statusCode).toBe(400);
  });

  it('generates a payable from an approved purchase order origin, snapshotting the supplier', async () => {
    const supplierId = await makeSupplier(), partId = await makePart();
    const poId = await makeApprovedPurchaseOrder(supplierId, partId, 200);
    const created = await create({ purchaseOrderId: poId, description: 'Compra #origem', installments: [{ amount: 200, dueDate: '2026-12-01' }] });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ purchase_order_id: poId, supplier_id: supplierId, original_amount: '200.00' });
    expect(created.json().supplier_name_snapshot).toBeTruthy();
  });

  it('is idempotent for the same purchase order origin (item 18: origem duplicada não gera duas contas)', async () => {
    const supplierId = await makeSupplier(), partId = await makePart();
    const poId = await makeApprovedPurchaseOrder(supplierId, partId, 90);
    const first = await create({ purchaseOrderId: poId, description: 'Compra dup', installments: [{ amount: 90, dueDate: '2026-12-01' }] });
    const second = await create({ purchaseOrderId: poId, description: 'Compra dup', installments: [{ amount: 90, dueDate: '2026-12-01' }] });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
  });

  it('rejects an origin that is not an approved purchase order, and an explicit supplier combined with a purchase order origin', async () => {
    const supplierId = await makeSupplier(), partId = await makePart();
    const draftOrder = (await app.inject({ method: 'POST', url: '/purchase-orders', headers: { cookie }, payload: { supplierId } })).json();
    await app.inject({ method: 'POST', url: `/purchase-orders/${draftOrder.id}/items`, headers: { cookie }, payload: { inventoryPartId: partId, quantity: 1, unitCost: 10 } });
    expect((await create({ purchaseOrderId: draftOrder.id, description: 'Ainda em rascunho', installments: [{ amount: 10, dueDate: '2026-12-01' }] })).statusCode).toBe(404);
    const poId = await makeApprovedPurchaseOrder(supplierId, partId, 30);
    expect((await create({ supplierId, purchaseOrderId: poId, description: 'Fornecedor + origem juntos', installments: [{ amount: 30, dueDate: '2026-12-01' }] })).statusCode).toBe(400);
  });
});

describe('FIN-03 listing and detail', () => {
  it('lists payables scoped to the active branch and finds one by detail', async () => {
    const created = (await create({ description: 'Listagem FIN-03', installments: [{ amount: 77, dueDate: '2026-12-01' }] })).json();
    const list = await listPayables('pageSize=100');
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((i: { id: string }) => i.id)).toContain(created.id);
    const detail = await getPayable(created.id);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().installments).toHaveLength(1);
    expect(detail.json().payments).toHaveLength(0);
    expect(detail.json()).toMatchObject({ derived_status: 'open', paid_amount: '0', balance: '77.00' });
  });

  it('derives overdue when a due date is in the past and the balance is still open', async () => {
    const created = (await create({ description: 'Vencida FIN-03', installments: [{ amount: 33, dueDate: '2020-01-01' }] })).json();
    expect((await getPayable(created.id)).json().derived_status).toBe('overdue');
  });
});

describe('FIN-03 update (PATCH)', () => {
  it('updates an allowed field (description)', async () => {
    const created = (await create({ description: 'Original', installments: [{ amount: 20, dueDate: '2026-12-01' }] })).json();
    const updated = await patch(created.id, { description: 'Atualizada' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().description).toBe('Atualizada');
  });

  it('rejects changing an immutable field (origin/value), unknown to the update contract', async () => {
    const created = (await create({ description: 'Imutável', installments: [{ amount: 20, dueDate: '2026-12-01' }] })).json();
    expect((await patch(created.id, { purchaseOrderId: randomUUID() })).statusCode).toBe(400);
    expect((await patch(created.id, { originalAmount: 999 })).statusCode).toBe(400);
  });
});

describe('FIN-03 payment and reversal', () => {
  it('supports a full payment for a single installment', async () => {
    const created = (await create({ description: 'Pagamento total', installments: [{ amount: 500, dueDate: '2026-12-01' }] })).json();
    const installmentId = created.installments?.[0]?.id ?? (await getPayable(created.id)).json().installments[0].id;
    const paid = await pay(created.id, installmentId, { amount: 500, idempotencyKey: `pay-total-${randomUUID()}` });
    expect(paid.statusCode).toBe(201);
    const detail = (await getPayable(created.id)).json();
    expect(detail).toMatchObject({ derived_status: 'paid', paid_amount: '500.00', balance: '0.00' });
  });

  it('supports a partial payment, keeping the installment open with a positive balance', async () => {
    const created = (await create({ description: 'Pagamento parcial', installments: [{ amount: 300, dueDate: '2026-12-01' }] })).json();
    const installmentId = (await getPayable(created.id)).json().installments[0].id;
    const paid = await pay(created.id, installmentId, { amount: 100, idempotencyKey: `pay-partial-${randomUUID()}` });
    expect(paid.statusCode).toBe(201);
    const detail = (await getPayable(created.id)).json();
    expect(detail).toMatchObject({ derived_status: 'partial', paid_amount: '100.00', balance: '200.00' });
  });

  it('completes an installment with a second payment', async () => {
    const created = (await create({ description: 'Dois pagamentos', installments: [{ amount: 300, dueDate: '2026-12-01' }] })).json();
    const installmentId = (await getPayable(created.id)).json().installments[0].id;
    await pay(created.id, installmentId, { amount: 100, idempotencyKey: `pay-a-${randomUUID()}` });
    const second = await pay(created.id, installmentId, { amount: 200, idempotencyKey: `pay-b-${randomUUID()}` });
    expect(second.statusCode).toBe(201);
    expect((await getPayable(created.id)).json().derived_status).toBe('paid');
  });

  it('rejects a payment above the remaining balance', async () => {
    const created = (await create({ description: 'Excede saldo', installments: [{ amount: 100, dueDate: '2026-12-01' }] })).json();
    const installmentId = (await getPayable(created.id)).json().installments[0].id;
    expect((await pay(created.id, installmentId, { amount: 150, idempotencyKey: `pay-over-${randomUUID()}` })).statusCode).toBe(409);
  });

  // FIN-ADV-01, seções 9/15/25: cenário canônico de concorrência (conta de R$1.000, duas baixas
  // simultâneas de R$700 — nunca R$1.400 pago). A função `pay_payable` já trava a parcela com
  // `for update` (migration 0024) antes de validar o saldo; faltava a prova sob concorrência real
  // (só existia o equivalente para alocação em `receivables`).
  it('concurrency: two simultaneous payments that together exceed the balance never both succeed (700+700 on 1000)', async () => {
    const created = (await create({ description: 'Concorrência', installments: [{ amount: 1000, dueDate: '2026-12-01' }] })).json();
    const installmentId = (await getPayable(created.id)).json().installments[0].id;
    const results = await Promise.all([
      pay(created.id, installmentId, { amount: 700, idempotencyKey: `pay-race-a-${randomUUID()}` }),
      pay(created.id, installmentId, { amount: 700, idempotencyKey: `pay-race-b-${randomUUID()}` }),
    ]);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(1);
    const detail = (await getPayable(created.id)).json();
    expect(detail).toMatchObject({ derived_status: 'partial', paid_amount: '700.00', balance: '300.00' });
  });

  it('is idempotent: a second call with the same idempotencyKey returns the same payment instead of duplicating', async () => {
    const created = (await create({ description: 'Idempotente', installments: [{ amount: 80, dueDate: '2026-12-01' }] })).json();
    const installmentId = (await getPayable(created.id)).json().installments[0].id;
    const key = `pay-idem-${randomUUID()}`;
    const first = await pay(created.id, installmentId, { amount: 80, idempotencyKey: key });
    const second = await pay(created.id, installmentId, { amount: 80, idempotencyKey: key });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().payment_id).toBe(first.json().payment_id);
  });

  it('reverses a payment, reopening the installment balance', async () => {
    const created = (await create({ description: 'Estorno', installments: [{ amount: 250, dueDate: '2026-12-01' }] })).json();
    const installmentId = (await getPayable(created.id)).json().installments[0].id;
    const paid = await pay(created.id, installmentId, { amount: 250, idempotencyKey: `pay-rev-${randomUUID()}` });
    expect((await getPayable(created.id)).json().derived_status).toBe('paid');
    const reversed = await reverse(created.id, installmentId, paid.json().payment_id, { reason: 'Pagamento em duplicidade' });
    expect(reversed.statusCode).toBe(201);
    const detail = (await getPayable(created.id)).json();
    // `paid_amount` aqui é "0.00" (não "0" cru) porque já existe soma real de linhas
    // (pagamento - estorno = 0), diferente do caso "nenhum pagamento ainda" (linha 150), onde o
    // `coalesce` cai no literal inteiro de fallback antes de qualquer linha existir.
    expect(detail).toMatchObject({ derived_status: 'open', paid_amount: '0.00', balance: '250.00' });
  });

  it('rejects a double reversal of the same payment (idempotent, not an error, on retry)', async () => {
    const created = (await create({ description: 'Duplo estorno', installments: [{ amount: 60, dueDate: '2026-12-01' }] })).json();
    const installmentId = (await getPayable(created.id)).json().installments[0].id;
    const paid = await pay(created.id, installmentId, { amount: 60, idempotencyKey: `pay-dbl-${randomUUID()}` });
    const first = await reverse(created.id, installmentId, paid.json().payment_id);
    const second = await reverse(created.id, installmentId, paid.json().payment_id);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotent).toBe(true);
    expect(second.json().reversal_id).toBe(first.json().reversal_id);
  });
});

describe('FIN-03 cancellation', () => {
  it('cancels a payable with no payments', async () => {
    const created = (await create({ description: 'Cancelar sem pagamento', installments: [{ amount: 40, dueDate: '2026-12-01' }] })).json();
    const canceled = await cancel(created.id, { reason: 'Teste' });
    expect(canceled.statusCode).toBe(200);
    expect((await getPayable(created.id)).json()).toMatchObject({ status: 'canceled', derived_status: 'canceled' });
  });

  it('rejects cancellation while there is an active (non-reversed) payment', async () => {
    const created = (await create({ description: 'Cancelar com pagamento ativo', installments: [{ amount: 70, dueDate: '2026-12-01' }] })).json();
    const installmentId = (await getPayable(created.id)).json().installments[0].id;
    await pay(created.id, installmentId, { amount: 30, idempotencyKey: `pay-block-cancel-${randomUUID()}` });
    expect((await cancel(created.id)).statusCode).toBe(409);
  });
});

describe('FIN-03 RBAC, auditoria e isolamento de tenant', () => {
  it('rejects create/pay/cancel without the specific payables.* permission (403)', async () => {
    const restricted = await createRestrictedIdentity();
    const restrictedCookie = await loginAs(restricted.email);
    expect((await app.inject({ method: 'POST', url: '/payables', headers: { cookie: restrictedCookie }, payload: { description: 'x', installments: [{ amount: 10, dueDate: '2026-12-01' }] } })).statusCode).toBe(403);
    const created = (await create({ description: 'RBAC negativo', installments: [{ amount: 10, dueDate: '2026-12-01' }] })).json();
    expect((await app.inject({ method: 'GET', url: '/payables', headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/payables/${created.id}/cancel`, headers: { cookie: restrictedCookie }, payload: {} })).statusCode).toBe(403);
  });

  it('audits creation, payment, reversal and cancellation', async () => {
    const created = (await create({ description: 'Auditoria FIN-03', installments: [{ amount: 55, dueDate: '2026-12-01' }] })).json();
    const installmentId = (await getPayable(created.id)).json().installments[0].id;
    const events1 = (await app.inject({ method: 'GET', url: `/audit-events?resourceType=payable&resourceId=${created.id}`, headers: { cookie } })).json();
    expect(events1.items.some((e: { action: string }) => e.action === 'payable.created')).toBe(true);
    const paid = await pay(created.id, installmentId, { amount: 55, idempotencyKey: `pay-audit-${randomUUID()}` });
    await reverse(created.id, installmentId, paid.json().payment_id);
    await cancel(created.id);
    const events2 = (await app.inject({ method: 'GET', url: `/audit-events?resourceType=payable&resourceId=${created.id}`, headers: { cookie } })).json();
    const actions = events2.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['payable.created', 'payable.paid', 'payable.payment_reversed', 'payable.canceled']));
  });

  it('isolates tenants: a payable from another tenant is invisible and inaccessible', async () => {
    const { payableId } = await insertBetaPayable();
    expect((await getPayable(payableId)).statusCode).toBe(404);
    expect((await cancel(payableId)).statusCode).toBe(404);
    const list = await listPayables('pageSize=100');
    expect(list.json().items.map((i: { id: string }) => i.id)).not.toContain(payableId);
  });
});
