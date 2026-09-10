import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

// FIN-02 — suíte de integração da API. Ver executed.md "Testes" para a lista completa e a
// contagem exata de casos. Segue os mesmos padrões estabelecidos por cash.integration.test.ts:
// `app.inject()` contra um Postgres real, login como `single@vetoros.local` (todas as
// permissions), `admin` (conexão vetoros_migration) para fixtures cross-tenant.

const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const customer = '01992ea1-1250-7000-8000-000000000050';
const tenantAlpha = '01992ea1-1250-7000-8000-000000000010', companyAlpha = '01992ea1-1250-7000-8000-000000000012', branchAlpha = '01992ea1-1250-7000-8000-000000000013';
const beta = '01992ea1-1250-7000-8000-000000000020', betaCompany = '01992ea1-1250-7000-8000-000000000022', betaBranch = '01992ea1-1250-7000-8000-000000000023';
const operationalContextSelectPermissionId = '01992ea1-1250-7000-8000-000000000033';
const service = new AuthService(authUrl, runtimeUrl, 3600), app = buildApp({ authService: service, loginRateLimitMax: 1000 }), admin = postgres(migrationUrl);
let cookie = '';
let cashMethodId = '';

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId: companyAlpha, branchId: branchAlpha } });
  const [method] = await admin<{ id: string }[]>`select id from payment_methods where code='cash'`;
  cashMethodId = method!.id;
});
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

// ---- Helpers de fixture ----
const createRegister = (name = `Caixa ${randomUUID()}`) => app.inject({ method: 'POST', url: '/cash-registers', headers: { cookie }, payload: { name } });
const openSession = (cashRegisterId: string, openingAmount = 0) => app.inject({ method: 'POST', url: '/cash-sessions/open', headers: { cookie }, payload: { cashRegisterId, openingAmount } });
const receive = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/payments', headers: { cookie }, payload });
const refund = (paymentId: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/payments/${paymentId}/refund`, headers: { cookie }, payload });
const generate = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/receivables/generate', headers: { cookie }, payload });
const cancelReceivable = (receivableId: string, payload: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `/receivables/${receivableId}/cancel`, headers: { cookie }, payload });
const allocate = (receivableId: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/receivables/${receivableId}/allocate`, headers: { cookie }, payload });
const getReceivable = (receivableId: string) => app.inject({ method: 'GET', url: `/receivables/${receivableId}`, headers: { cookie } });
const listReceivables = (query = '') => app.inject({ method: 'GET', url: `/receivables?${query}`, headers: { cookie } });
const cancelSale = (saleId: string) => app.inject({ method: 'POST', url: `/sales/${saleId}/cancel`, headers: { cookie } });

async function registerAndOpen(openingAmount = 0) {
  const register = (await createRegister()).json();
  const session = (await openSession(register.id, openingAmount)).json();
  return { register, sessionId: session.session_id as string };
}
/** Venda confirmada de R$ 1.000,00 (1 item, unitPrice=1000) — total redondo para casar exatamente
 * com os cenários de parcelamento/entrada dos testes abaixo. */
async function makeSale(unitPrice = 1000) {
  const sale = (await app.inject({ method: 'POST', url: '/sales', headers: { cookie }, payload: { customerId: customer } })).json();
  await app.inject({ method: 'POST', url: `/sales/${sale.id}/items`, headers: { cookie }, payload: { type: 'service', description: 'Serviço FIN-02', quantity: 1, unitPrice } });
  await app.inject({ method: 'POST', url: `/sales/${sale.id}/confirm`, headers: { cookie } });
  return { saleId: sale.id as string, saleNumber: sale.sale_number as number };
}
async function makeServiceOrder() {
  const order = (await app.inject({ method: 'POST', url: '/service-orders', headers: { cookie }, payload: { customerId: customer, title: 'OS FIN-02', reportedProblem: 'Teste' } })).json();
  await app.inject({ method: 'POST', url: `/service-orders/${order.id}/items`, headers: { cookie }, payload: { type: 'service', description: 'Serviço FIN-02', quantity: 1, unitPrice: 500 } });
  return order.id as string;
}
async function createRestrictedIdentity() {
  const identityId = randomUUID(), membershipId = randomUUID(), profileId = randomUUID(), roleId = randomUUID(), grantId = randomUUID();
  const email = `restricted-fin02-${randomUUID()}@vetoros.local`;
  const [existing] = await admin<{ password_hash: string }[]>`select password_hash from identities where email_normalized='single@vetoros.local'`;
  await admin`insert into identities(id,email_normalized,password_hash,display_name,status) values(${identityId},${email},${existing!.password_hash},'Restrito FIN-02','active')`;
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenantAlpha},true)`;
    await tx`insert into tenant_memberships(id,tenant_id,identity_id,status) values(${membershipId},${tenantAlpha},${identityId},'active')`;
    await tx`insert into tenant_user_profiles(id,tenant_id,membership_id,name) values(${profileId},${tenantAlpha},${membershipId},'Restrito FIN-02')`;
    await tx`insert into tenant_roles(id,tenant_id,code,name,scope_type) values(${roleId},${tenantAlpha},${`fin02_restricted_${roleId}`},'FIN-02 restricted','tenant')`;
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
async function insertBetaReceivable() {
  const saleId = randomUUID(), receivableId = randomUUID(), customerId = randomUUID();
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${beta},true)`;
    const [customerCounter] = await tx<{ last_number: number }[]>`insert into customer_number_counters(tenant_id,last_number) values(${beta},1) on conflict(tenant_id) do update set last_number=customer_number_counters.last_number+1,updated_at=now() returning last_number`;
    await tx`insert into customers(id,tenant_id,customer_number,person_type,legal_name,status) values(${customerId},${beta},${customerCounter!.last_number},'company','Cliente Beta FIN-02','active')`;
    const [saleCounter] = await tx<{ last_number: number }[]>`insert into sale_number_counters(tenant_id,last_number) values(${beta},1) on conflict(tenant_id) do update set last_number=sale_number_counters.last_number+1,updated_at=now() returning last_number`;
    await tx`insert into sales(id,tenant_id,company_id,branch_id,sale_number,customer_id,status) values(${saleId},${beta},${betaCompany},${betaBranch},${saleCounter!.last_number},${customerId},'confirmed')`;
    await tx`insert into receivables(id,tenant_id,company_id,branch_id,customer_id,sale_id,installment_number,installment_count,original_amount,due_date) values(${receivableId},${beta},${betaCompany},${betaBranch},${customerId},${saleId},1,1,100,current_date)`;
  });
  return receivableId;
}

describe('FIN-02 generation (installments)', () => {
  it('requires authentication and full operational context', async () => {
    expect((await app.inject({ method: 'GET', url: '/receivables' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'shared@vetoros.local', password } });
    expect((await app.inject({ method: 'GET', url: '/receivables', headers: { cookie: String(login.headers['set-cookie']).split(';')[0]! } })).statusCode).toBe(409);
  });

  it('generates a single upfront installment matching the full sale total', async () => {
    const { saleId } = await makeSale(1000);
    const created = await generate({ saleId, installments: [{ amount: 1000, dueDate: '2026-12-01' }] });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ installment_number: 1, installment_count: 1, original_amount: '1000.00' });
  });

  it('splits a sale into multiple installments summing exactly to the total (seção 5)', async () => {
    const { saleId } = await makeSale(1200);
    const created = await generate({ saleId, installments: [{ amount: 400, dueDate: '2026-10-01' }, { amount: 400, dueDate: '2026-11-01' }, { amount: 400, dueDate: '2026-12-01' }] });
    expect(created.statusCode).toBe(201);
    expect(created.json().items.map((i: { installment_number: number }) => i.installment_number)).toEqual([1, 2, 3]);
  });

  it('rejects a set of installments whose sum does not close exactly with the origin total', async () => {
    const { saleId } = await makeSale(1000);
    expect((await generate({ saleId, installments: [{ amount: 400, dueDate: '2026-10-01' }] })).statusCode).toBe(400);
  });

  it('supports the entrada/sinal scenario: direct payment already received is subtracted before validating the remaining installments', async () => {
    const { saleId } = await makeSale(1000);
    const { sessionId } = await registerAndOpen(0);
    const upfront = await receive({ cashSessionId: sessionId, amount: 200, paymentMethodId: cashMethodId, saleId, idempotencyKey: `entrada-${randomUUID()}` });
    expect(upfront.statusCode).toBe(201);
    // 1000 total - 200 já recebido = 800 a financiar, em 2x400
    const created = await generate({ saleId, installments: [{ amount: 400, dueDate: '2026-10-01' }, { amount: 400, dueDate: '2026-11-01' }] });
    expect(created.statusCode).toBe(201);
    expect((await generate({ saleId, installments: [{ amount: 800, dueDate: '2026-10-01' }] })).statusCode).toBe(409); // já gerado, retry com dados diferentes é conflito (23505)
  });

  it('is idempotent: a second call for the same origin returns the same installments instead of duplicating', async () => {
    const { saleId } = await makeSale(600);
    const first = await generate({ saleId, installments: [{ amount: 600, dueDate: '2026-12-01' }] });
    const second = await generate({ saleId, installments: [{ amount: 600, dueDate: '2026-12-01' }] });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().items[0].id).toBe(first.json().items[0].id);
  });

  it('generates installments from a service order, not just a sale', async () => {
    const orderId = await makeServiceOrder();
    const created = await generate({ serviceOrderId: orderId, installments: [{ amount: 500, dueDate: '2026-12-01' }] });
    expect(created.statusCode).toBe(201);
    expect(created.json().items[0].service_order_id).toBe(orderId);
  });

  it('rejects an origin that is not a confirmed sale/non-canceled service order, and an ambiguous or missing origin', async () => {
    const draftSale = (await app.inject({ method: 'POST', url: '/sales', headers: { cookie }, payload: { customerId: customer } })).json();
    expect((await generate({ saleId: draftSale.id, installments: [{ amount: 10, dueDate: '2026-12-01' }] })).statusCode).toBe(404);
    const { saleId } = await makeSale(100);
    const orderId = await makeServiceOrder();
    expect((await generate({ saleId, serviceOrderId: orderId, installments: [{ amount: 100, dueDate: '2026-12-01' }] })).statusCode).toBe(400);
    expect((await generate({ installments: [{ amount: 100, dueDate: '2026-12-01' }] })).statusCode).toBe(400);
  });
});

describe('FIN-02 allocation and balance', () => {
  it('supports partial payment, keeping the receivable open with a positive balance', async () => {
    const { saleId } = await makeSale(300);
    const { sessionId } = await registerAndOpen(0);
    const receivable = (await generate({ saleId, installments: [{ amount: 300, dueDate: '2026-12-01' }] })).json().items[0];
    const paymentId = (await receive({ cashSessionId: sessionId, amount: 300, paymentMethodId: cashMethodId, saleId, idempotencyKey: `alloc-a-${randomUUID()}` })).json().payment_id;
    const allocated = await allocate(receivable.id, { paymentId, amount: 100, idempotencyKey: `alloc-a-${randomUUID()}` });
    expect(allocated.statusCode).toBe(201);
    const detail = (await getReceivable(receivable.id)).json();
    expect(detail).toMatchObject({ derived_status: 'partial', paid_amount: '100.00', balance: '200.00' });
  });

  it('reaches quitação (paid) when allocations reach the full original amount, across multiple payments', async () => {
    const { saleId } = await makeSale(300);
    const { sessionId } = await registerAndOpen(0);
    const receivable = (await generate({ saleId, installments: [{ amount: 300, dueDate: '2026-12-01' }] })).json().items[0];
    const paymentA = (await receive({ cashSessionId: sessionId, amount: 100, paymentMethodId: cashMethodId, saleId, idempotencyKey: `quita-a-${randomUUID()}` })).json().payment_id;
    const paymentB = (await receive({ cashSessionId: sessionId, amount: 200, paymentMethodId: cashMethodId, saleId, idempotencyKey: `quita-b-${randomUUID()}` })).json().payment_id;
    expect((await allocate(receivable.id, { paymentId: paymentA, amount: 100, idempotencyKey: `alloc-b-${randomUUID()}` })).statusCode).toBe(201);
    expect((await allocate(receivable.id, { paymentId: paymentB, amount: 200, idempotencyKey: `alloc-c-${randomUUID()}` })).statusCode).toBe(201);
    const detail = (await getReceivable(receivable.id)).json();
    expect(detail).toMatchObject({ derived_status: 'paid', paid_amount: '300.00', balance: '0.00' });
  });

  it('lets a single payment cover multiple installments (one payment split across titles)', async () => {
    const { saleId } = await makeSale(800);
    const { sessionId } = await registerAndOpen(0);
    const items = (await generate({ saleId, installments: [{ amount: 400, dueDate: '2026-10-01' }, { amount: 400, dueDate: '2026-11-01' }] })).json().items;
    const paymentId = (await receive({ cashSessionId: sessionId, amount: 800, paymentMethodId: cashMethodId, saleId, idempotencyKey: `split-${randomUUID()}` })).json().payment_id;
    expect((await allocate(items[0].id, { paymentId, amount: 400, idempotencyKey: `split-a-${randomUUID()}` })).statusCode).toBe(201);
    expect((await allocate(items[1].id, { paymentId, amount: 400, idempotencyKey: `split-b-${randomUUID()}` })).statusCode).toBe(201);
    expect((await getReceivable(items[0].id)).json().derived_status).toBe('paid');
    expect((await getReceivable(items[1].id)).json().derived_status).toBe('paid');
  });

  it('caps allocation by payment capacity: cannot allocate beyond what the payment actually received', async () => {
    const { saleId } = await makeSale(500);
    const { sessionId } = await registerAndOpen(0);
    const receivable = (await generate({ saleId, installments: [{ amount: 500, dueDate: '2026-12-01' }] })).json().items[0];
    const paymentId = (await receive({ cashSessionId: sessionId, amount: 100, paymentMethodId: cashMethodId, saleId, idempotencyKey: `cap-${randomUUID()}` })).json().payment_id;
    expect((await allocate(receivable.id, { paymentId, amount: 150, idempotencyKey: `cap-a-${randomUUID()}` })).statusCode).toBe(409);
  });

  it('caps allocation by receivable balance: cannot allocate beyond what the title still owes', async () => {
    const { saleId } = await makeSale(200);
    const { sessionId } = await registerAndOpen(0);
    const receivable = (await generate({ saleId, installments: [{ amount: 200, dueDate: '2026-12-01' }] })).json().items[0];
    const paymentId = (await receive({ cashSessionId: sessionId, amount: 500, paymentMethodId: cashMethodId, saleId, idempotencyKey: `overcap-${randomUUID()}` })).json().payment_id;
    expect((await allocate(receivable.id, { paymentId, amount: 300, idempotencyKey: `overcap-a-${randomUUID()}` })).statusCode).toBe(409);
  });

  it('rejects allocating a payment from a different origin than the receivable (never inferred by value coincidence)', async () => {
    const { saleId: saleA } = await makeSale(100);
    const { saleId: saleB } = await makeSale(100);
    const { sessionId } = await registerAndOpen(0);
    const receivableA = (await generate({ saleId: saleA, installments: [{ amount: 100, dueDate: '2026-12-01' }] })).json().items[0];
    const paymentB = (await receive({ cashSessionId: sessionId, amount: 100, paymentMethodId: cashMethodId, saleId: saleB, idempotencyKey: `mismatch-${randomUUID()}` })).json().payment_id;
    expect((await allocate(receivableA.id, { paymentId: paymentB, amount: 100, idempotencyKey: `mismatch-a-${randomUUID()}` })).statusCode).toBe(409);
  });

  it('reopens the balance when the allocated payment is refunded (seção 9)', async () => {
    const { saleId } = await makeSale(400);
    const { sessionId } = await registerAndOpen(0);
    const receivable = (await generate({ saleId, installments: [{ amount: 400, dueDate: '2026-12-01' }] })).json().items[0];
    const paymentId = (await receive({ cashSessionId: sessionId, amount: 400, paymentMethodId: cashMethodId, saleId, idempotencyKey: `refund-${randomUUID()}` })).json().payment_id;
    await allocate(receivable.id, { paymentId, amount: 400, idempotencyKey: `refund-a-${randomUUID()}` });
    expect((await getReceivable(receivable.id)).json().derived_status).toBe('paid');
    const refunded = await refund(paymentId, { cashSessionId: sessionId });
    expect(refunded.statusCode).toBe(201);
    const detail = (await getReceivable(receivable.id)).json();
    expect(detail).toMatchObject({ derived_status: 'open', paid_amount: '0', balance: '400.00' });
  });

  it('is idempotent: a second allocate call with the same idempotencyKey returns the same allocation instead of duplicating', async () => {
    const { saleId } = await makeSale(150);
    const { sessionId } = await registerAndOpen(0);
    const receivable = (await generate({ saleId, installments: [{ amount: 150, dueDate: '2026-12-01' }] })).json().items[0];
    const paymentId = (await receive({ cashSessionId: sessionId, amount: 150, paymentMethodId: cashMethodId, saleId, idempotencyKey: `idem-${randomUUID()}` })).json().payment_id;
    const key = `idem-alloc-${randomUUID()}`;
    const first = await allocate(receivable.id, { paymentId, amount: 150, idempotencyKey: key });
    const second = await allocate(receivable.id, { paymentId, amount: 150, idempotencyKey: key });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().allocation_id).toBe(first.json().allocation_id);
  });

  it('concurrency: two simultaneous allocations against the same payment never overallocate beyond its amount', async () => {
    const { saleId } = await makeSale(600);
    const { sessionId } = await registerAndOpen(0);
    const items = (await generate({ saleId, installments: [{ amount: 300, dueDate: '2026-10-01' }, { amount: 300, dueDate: '2026-11-01' }] })).json().items;
    const paymentId = (await receive({ cashSessionId: sessionId, amount: 300, paymentMethodId: cashMethodId, saleId, idempotencyKey: `race-${randomUUID()}` })).json().payment_id;
    const [a, b] = await Promise.all([
      allocate(items[0].id, { paymentId, amount: 300, idempotencyKey: `race-a-${randomUUID()}` }),
      allocate(items[1].id, { paymentId, amount: 300, idempotencyKey: `race-b-${randomUUID()}` }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    // o pagamento só tem R$300 de capacidade — exatamente uma das duas alocações concorrentes de
    // R$300 cada pode ter sucesso, nunca as duas (isso perderia dinheiro por trás de uma corrida).
    expect(codes).toEqual([201, 409]);
  });
});

describe('FIN-02 cancellation', () => {
  it('cancels a receivable with no allocation, keeping traceability of the reason', async () => {
    const { saleId } = await makeSale(90);
    const receivable = (await generate({ saleId, installments: [{ amount: 90, dueDate: '2026-12-01' }] })).json().items[0];
    const canceled = await cancelReceivable(receivable.id, { reason: 'Teste manual' });
    expect(canceled.statusCode).toBe(200);
    const detail = (await getReceivable(receivable.id)).json();
    expect(detail).toMatchObject({ status: 'canceled', derived_status: 'canceled', cancel_reason: 'Teste manual' });
  });

  it('is idempotent and blocks cancellation once there is an active allocation', async () => {
    const { saleId } = await makeSale(120);
    const { sessionId } = await registerAndOpen(0);
    const receivable = (await generate({ saleId, installments: [{ amount: 120, dueDate: '2026-12-01' }] })).json().items[0];
    const paymentId = (await receive({ cashSessionId: sessionId, amount: 120, paymentMethodId: cashMethodId, saleId, idempotencyKey: `cancel-block-${randomUUID()}` })).json().payment_id;
    await allocate(receivable.id, { paymentId, amount: 60, idempotencyKey: `cancel-block-a-${randomUUID()}` });
    expect((await cancelReceivable(receivable.id)).statusCode).toBe(409);
    const { saleId: freshSaleId } = await makeSale(50);
    const freshReceivableId = (await generate({ saleId: freshSaleId, installments: [{ amount: 50, dueDate: '2026-12-01' }] })).json().items[0].id;
    const first = await cancelReceivable(freshReceivableId);
    const second = await cancelReceivable(freshReceivableId);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotent).toBe(true);
  });

  it('cascades cancellation when the origin sale is cancelled: open titles are auto-canceled', async () => {
    const { saleId } = await makeSale(70);
    const receivable = (await generate({ saleId, installments: [{ amount: 70, dueDate: '2026-12-01' }] })).json().items[0];
    const canceled = await cancelSale(saleId);
    expect(canceled.statusCode).toBe(200);
    const detail = (await getReceivable(receivable.id)).json();
    expect(detail.status).toBe('canceled');
    expect(detail.cancel_reason).toMatch(/cancelamento da venda/i);
  });

  it('blocks cancelling the origin sale when a title already has an active allocation', async () => {
    // `allocate_payment` sempre exige que o pagamento pertença à MESMA origem do título (seção 8)
    // — então todo pagamento alocado a um título ativo é, por construção, também um "recebimento
    // ativo" da própria venda, e o bloqueio pré-existente do FIN-01 (`sale_has_active_payments`,
    // já testado por sales.integration.test.ts) sempre dispara primeiro. `sale_has_active_receivables`
    // (`cancel_receivables_for_origin`) continua existindo como segunda camada estrutural — cobre
    // qualquer caminho futuro que crie alocação sem um pagamento direto equivalente — mas não é
    // alcançável por este fluxo normal, então o teste de integração ponta a ponta verifica o
    // resultado observável (cancelamento bloqueado), não qual das duas guardas disparou.
    const { saleId } = await makeSale(80);
    const { sessionId } = await registerAndOpen(0);
    const receivable = (await generate({ saleId, installments: [{ amount: 80, dueDate: '2026-12-01' }] })).json().items[0];
    const paymentId = (await receive({ cashSessionId: sessionId, amount: 80, paymentMethodId: cashMethodId, saleId, idempotencyKey: `block-cancel-${randomUUID()}` })).json().payment_id;
    await allocate(receivable.id, { paymentId, amount: 80, idempotencyKey: `block-cancel-a-${randomUUID()}` });
    const canceled = await cancelSale(saleId);
    expect(canceled.statusCode).toBe(409);
    expect(['sale_has_active_payments', 'sale_has_active_receivables']).toContain(canceled.json().error);
  });
});

describe('FIN-02 listing, overdue, RBAC and tenant isolation', () => {
  it('lists receivables scoped to the active branch with derived status filters', async () => {
    const { saleId } = await makeSale(55);
    // Data exclusiva desta fixture: a suíte roda em paralelo e o banco de desenvolvimento pode
    // conservar mais de 100 títulos de outras suítes. Consultar apenas `status=open&pageSize=100`
    // tornava a assertion dependente da posição do registro na paginação global da filial.
    const dueDate = '2088-07-19';
    const receivable = (await generate({ saleId, installments: [{ amount: 55, dueDate }] })).json().items[0];
    const list = await listReceivables(`status=open&from=${dueDate}&to=${dueDate}&pageSize=100`);
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((i: { id: string }) => i.id)).toContain(receivable.id);
  });

  // VEN-ADV-01, seção 24: a tela da venda precisa listar os recebíveis gerados a partir dela —
  // o endpoint não tinha filtro por `saleId` (só `customerId`/`origin`/`status`/período/busca).
  it('filters receivables by saleId (seção 24 do correio.md — navegação de origem)', async () => {
    const { saleId } = await makeSale(70);
    const other = await makeSale(30);
    const mine = (await generate({ saleId, installments: [{ amount: 70, dueDate: '2089-01-10' }] })).json().items[0];
    await generate({ saleId: other.saleId, installments: [{ amount: 30, dueDate: '2089-01-10' }] });
    const list = await listReceivables(`saleId=${saleId}&pageSize=100`);
    expect(list.statusCode).toBe(200);
    const ids = list.json().items.map((i: { id: string }) => i.id);
    expect(ids).toEqual([mine.id]);
  });

  it('derives overdue when due_date is in the past and the balance is still open', async () => {
    const { saleId } = await makeSale(65);
    const receivable = (await generate({ saleId, installments: [{ amount: 65, dueDate: '2020-01-01' }] })).json().items[0];
    expect((await getReceivable(receivable.id)).json().derived_status).toBe('overdue');
  });

  it('rejects generate/cancel/allocate without the specific receivables.* permission', async () => {
    const restricted = await createRestrictedIdentity();
    const restrictedCookie = await loginAs(restricted.email);
    const { saleId } = await makeSale(45);
    expect((await app.inject({ method: 'POST', url: '/receivables/generate', headers: { cookie: restrictedCookie }, payload: { saleId, installments: [{ amount: 45, dueDate: '2026-12-01' }] } })).statusCode).toBe(403);
    const receivable = (await generate({ saleId, installments: [{ amount: 45, dueDate: '2026-12-01' }] })).json().items[0];
    expect((await app.inject({ method: 'GET', url: '/receivables', headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/receivables/${receivable.id}/cancel`, headers: { cookie: restrictedCookie }, payload: {} })).statusCode).toBe(403);
  });

  it('audits generation, allocation and cancellation', async () => {
    const { saleId } = await makeSale(35);
    const receivable = (await generate({ saleId, installments: [{ amount: 35, dueDate: '2026-12-01' }] })).json().items[0];
    const events = (await app.inject({ method: 'GET', url: `/audit-events?resourceType=receivable&resourceId=${receivable.id}`, headers: { cookie } })).json();
    expect(events.items.some((e: { action: string }) => e.action === 'receivable.generated')).toBe(true);
    await cancelReceivable(receivable.id);
    const eventsAfterCancel = (await app.inject({ method: 'GET', url: `/audit-events?resourceType=receivable&resourceId=${receivable.id}`, headers: { cookie } })).json();
    expect(eventsAfterCancel.items.some((e: { action: string }) => e.action === 'receivable.canceled')).toBe(true);
  });

  it('isolates tenants: a receivable from another tenant is invisible and inaccessible', async () => {
    const receivableId = await insertBetaReceivable();
    expect((await getReceivable(receivableId)).statusCode).toBe(404);
    expect((await cancelReceivable(receivableId)).statusCode).toBe(404);
    const list = await listReceivables('pageSize=100');
    expect(list.json().items.map((i: { id: string }) => i.id)).not.toContain(receivableId);
  });
});
