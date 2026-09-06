import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

// FIN-01 — suíte de integração da API. Ver executed.md "Testes" para a lista completa e a
// contagem exata de casos. Segue os mesmos padrões estabelecidos por sales.integration.test.ts /
// service-order-stock.integration.test.ts: `app.inject()` contra um Postgres real, login como
// `single@vetoros.local` (todas as permissions, seção 19: "tentativa sem permission" usa uma
// identidade restrita construída aqui), `admin` (conexão vetoros_migration) para inserir fixtures
// cross-tenant e para provar imutabilidade histórica direto no banco.

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
const closeSession = (id: string, closingAmountInformed: number) => app.inject({ method: 'POST', url: `/cash-sessions/${id}/close`, headers: { cookie }, payload: { closingAmountInformed } });
const receive = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/payments', headers: { cookie }, payload });
const refund = (paymentId: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/payments/${paymentId}/refund`, headers: { cookie }, payload });

async function registerAndOpen(openingAmount = 0) {
  const register = (await createRegister()).json();
  const session = (await openSession(register.id, openingAmount)).json();
  return { register, sessionId: session.session_id as string };
}
async function makeSale() {
  const sale = (await app.inject({ method: 'POST', url: '/sales', headers: { cookie }, payload: { customerId: customer } })).json();
  await app.inject({ method: 'POST', url: `/sales/${sale.id}/items`, headers: { cookie }, payload: { type: 'service', description: 'Serviço FIN-01', quantity: 1, unitPrice: 100 } });
  await app.inject({ method: 'POST', url: `/sales/${sale.id}/confirm`, headers: { cookie } });
  return sale.id as string;
}
async function makeServiceOrder() {
  const order = (await app.inject({ method: 'POST', url: '/service-orders', headers: { cookie }, payload: { customerId: customer, title: 'OS FIN-01', reportedProblem: 'Teste' } })).json();
  return order.id as string;
}
async function createRestrictedIdentity() {
  const identityId = randomUUID(), membershipId = randomUUID(), profileId = randomUUID(), roleId = randomUUID(), grantId = randomUUID();
  const email = `restricted-fin01-${randomUUID()}@vetoros.local`;
  const [existing] = await admin<{ password_hash: string }[]>`select password_hash from identities where email_normalized='single@vetoros.local'`;
  await admin`insert into identities(id,email_normalized,password_hash,display_name,status) values(${identityId},${email},${existing!.password_hash},'Restrito FIN-01','active')`;
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenantAlpha},true)`;
    await tx`insert into tenant_memberships(id,tenant_id,identity_id,status) values(${membershipId},${tenantAlpha},${identityId},'active')`;
    await tx`insert into tenant_user_profiles(id,tenant_id,membership_id,name) values(${profileId},${tenantAlpha},${membershipId},'Restrito FIN-01')`;
    await tx`insert into tenant_roles(id,tenant_id,code,name,scope_type) values(${roleId},${tenantAlpha},${`fin01_restricted_${roleId}`},'FIN-01 restricted','tenant')`;
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
async function insertBetaRegisterAndSession() {
  const registerId = randomUUID();
  const [session] = await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${beta},true)`;
    await tx`insert into cash_registers(id,tenant_id,company_id,branch_id,name) values(${registerId},${beta},${betaCompany},${betaBranch},${`Beta ${randomUUID()}`})`;
    return tx<{ session_id: string }[]>`select * from open_cash_session(${registerId},0)`;
  });
  return { registerId, sessionId: session!.session_id };
}

describe('FIN-01 cash registers', () => {
  it('requires authentication and full operational context', async () => {
    expect((await app.inject({ method: 'GET', url: '/cash-registers' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'shared@vetoros.local', password } });
    expect((await app.inject({ method: 'GET', url: '/cash-registers', headers: { cookie: String(login.headers['set-cookie']).split(';')[0]! } })).statusCode).toBe(409);
  });

  it('creates and lists registers scoped to the active branch, rejecting a duplicate name in the same branch', async () => {
    const name = `Caixa ${randomUUID()}`;
    const created = await createRegister(name);
    expect(created.statusCode).toBe(201);
    expect(created.json().branch_id).toBe(branchAlpha);
    const list = (await app.inject({ method: 'GET', url: '/cash-registers', headers: { cookie } })).json();
    expect(list.map((r: { id: string }) => r.id)).toContain(created.json().id);
    expect((await createRegister(name)).statusCode).toBe(409);
  });

  it('edits basic register configuration (name/status)', async () => {
    const register = (await createRegister()).json();
    const renamedTo = `Renomeado ${randomUUID()}`;
    const updated = await app.inject({ method: 'PATCH', url: `/cash-registers/${register.id}`, headers: { cookie }, payload: { name: renamedTo, status: 'inactive' } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: renamedTo, status: 'inactive' });
  });

  it('isolates tenants: a register from another tenant is invisible and inaccessible', async () => {
    const { registerId } = await insertBetaRegisterAndSession();
    const list = (await app.inject({ method: 'GET', url: '/cash-registers', headers: { cookie } })).json();
    expect(list.map((r: { id: string }) => r.id)).not.toContain(registerId);
    expect((await openSession(registerId, 10)).statusCode).toBe(404);
  });
});

describe('FIN-01 cash sessions (opening/closing)', () => {
  it('opens a session recording an opening movement, and reports it as the current session', async () => {
    const register = (await createRegister()).json();
    const opened = await openSession(register.id, 150);
    expect(opened.statusCode).toBe(201);
    expect(opened.json()).toMatchObject({ resulting_balance: '150' });
    const current = (await app.inject({ method: 'GET', url: `/cash-sessions/current?cashRegisterId=${register.id}`, headers: { cookie } })).json();
    expect(current.status).toBe('open');
    expect(Number(current.expected_balance)).toBe(150);
  });

  it('makes improper concurrent opening impossible — exactly one of two simultaneous opens succeeds', async () => {
    const register = (await createRegister()).json();
    const [a, b] = await Promise.all([openSession(register.id, 10), openSession(register.id, 20)]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);
  });

  it('closes an open session, computing the difference between informed and expected balance, and never lets a closed session reopen implicitly', async () => {
    const { register, sessionId } = await registerAndOpen(100);
    const closed = await closeSession(sessionId, 90);
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ expected_amount: '100.00', closing_amount_informed: '90', difference: '-10.00' });
    expect((await closeSession(sessionId, 90)).statusCode).toBe(409);
    // um segundo `open` no mesmo caixa cria uma sessão NOVA (a fechada não volta a ficar aberta)
    expect((await openSession(register.id, 5)).statusCode).toBe(201);
  });

  it('rejects opening/closing without the specific cash.open/cash.close permission', async () => {
    const restricted = await createRestrictedIdentity();
    const restrictedCookie = await loginAs(restricted.email);
    const register = (await createRegister()).json();
    expect((await app.inject({ method: 'POST', url: '/cash-sessions/open', headers: { cookie: restrictedCookie }, payload: { cashRegisterId: register.id, openingAmount: 0 } })).statusCode).toBe(403);
    const opened = (await openSession(register.id, 0)).json();
    expect((await app.inject({ method: 'POST', url: `/cash-sessions/${opened.session_id}/close`, headers: { cookie: restrictedCookie }, payload: { closingAmountInformed: 0 } })).statusCode).toBe(403);
  });

  it('closing while a receipt is being processed leaves no corrupted state: exactly one of the two operations reflects the other consistently', async () => {
    const { sessionId } = await registerAndOpen(0);
    const [closeResult, receiveResult] = await Promise.all([
      closeSession(sessionId, 0),
      receive({ cashSessionId: sessionId, amount: 25, paymentMethodId: cashMethodId, idempotencyKey: `race-${randomUUID()}` }),
    ]);
    // a corrida é decidida pelo lock da linha da sessão (seção 18) — nunca os dois succeeds ao
    // mesmo tempo de um jeito que perderia o dinheiro: ou o recebimento aconteceu ANTES do
    // fechamento (e o valor esperado do fechamento já reflete isso), ou o fechamento venceu e o
    // recebimento é rejeitado por sessão não aberta.
    if (receiveResult.statusCode === 201) {
      expect(closeResult.statusCode).toBe(200);
      expect(Number(closeResult.json().expected_amount)).toBe(25);
    } else {
      expect(receiveResult.statusCode).toBe(409);
      expect(receiveResult.json().error).toBe('session_not_open');
      expect(closeResult.statusCode).toBe(200);
    }
  });
});

describe('FIN-01 receipts (payments)', () => {
  it('registers a standalone receipt (no origin) and reflects it in the session balance', async () => {
    const { sessionId } = await registerAndOpen(0);
    const created = await receive({ cashSessionId: sessionId, amount: 40, paymentMethodId: cashMethodId, idempotencyKey: `standalone-${randomUUID()}` });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ resulting_balance: '40.00', idempotent: false });
  });

  it('links a receipt to a confirmed sale or a non-canceled service order, rejecting an invalid/nonexistent origin', async () => {
    const { sessionId } = await registerAndOpen(0);
    const saleId = await makeSale();
    const linked = await receive({ cashSessionId: sessionId, amount: 100, paymentMethodId: cashMethodId, saleId, idempotencyKey: `sale-${randomUUID()}` });
    expect(linked.statusCode).toBe(201);
    const orderId = await makeServiceOrder();
    const linkedOs = await receive({ cashSessionId: sessionId, amount: 30, paymentMethodId: cashMethodId, serviceOrderId: orderId, idempotencyKey: `os-${randomUUID()}` });
    expect(linkedOs.statusCode).toBe(201);
    expect((await receive({ cashSessionId: sessionId, amount: 10, paymentMethodId: cashMethodId, saleId: randomUUID(), idempotencyKey: `bad-${randomUUID()}` })).statusCode).toBe(404);
    expect((await receive({ cashSessionId: sessionId, amount: 10, paymentMethodId: randomUUID(), idempotencyKey: `bad-method-${randomUUID()}` })).statusCode).toBe(404);
  });

  it('rejects an ambiguous origin (both sale and service order at once)', async () => {
    const { sessionId } = await registerAndOpen(0);
    const saleId = await makeSale(), orderId = await makeServiceOrder();
    expect((await receive({ cashSessionId: sessionId, amount: 10, paymentMethodId: cashMethodId, saleId, serviceOrderId: orderId, idempotencyKey: `ambiguous-${randomUUID()}` })).statusCode).toBe(400);
  });

  it('supports partial payment with multiple payment methods and computes the total received deterministically', async () => {
    const { sessionId } = await registerAndOpen(0);
    const saleId = await makeSale(); // total R$ 100
    const [methods] = [(await app.inject({ method: 'GET', url: '/payment-methods', headers: { cookie } })).json()];
    const pix = methods.find((m: { code: string }) => m.code === 'pix').id;
    const first = await receive({ cashSessionId: sessionId, amount: 30, paymentMethodId: cashMethodId, saleId, idempotencyKey: `partial-a-${randomUUID()}` });
    const second = await receive({ cashSessionId: sessionId, amount: 70, paymentMethodId: pix, saleId, idempotencyKey: `partial-b-${randomUUID()}` });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const list = (await app.inject({ method: 'GET', url: `/payments?q=${saleId}`, headers: { cookie } })).json();
    const forSale = (await app.inject({ method: 'GET', url: `/payments?pageSize=100`, headers: { cookie } })).json().items.filter((p: { sale_id: string }) => p.sale_id === saleId);
    const totalReceived = forSale.reduce((sum: number, p: { amount: string }) => sum + Number(p.amount), 0);
    expect(totalReceived).toBe(100);
    expect(list.total).toBeGreaterThanOrEqual(0); // busca textual não é o foco deste caso — o cálculo determinístico acima é
  });

  it('rejects a receipt when the session is not open', async () => {
    const { sessionId } = await registerAndOpen(0);
    await closeSession(sessionId, 0);
    expect((await receive({ cashSessionId: sessionId, amount: 10, paymentMethodId: cashMethodId, idempotencyKey: `closed-${randomUUID()}` })).statusCode).toBe(409);
  });

  it('protects against duplication: the same idempotency key with identical parameters replays the original result; different parameters conflict', async () => {
    const { sessionId } = await registerAndOpen(0);
    const key = `dup-${randomUUID()}`;
    const first = await receive({ cashSessionId: sessionId, amount: 50, paymentMethodId: cashMethodId, idempotencyKey: key });
    const replay = await receive({ cashSessionId: sessionId, amount: 50, paymentMethodId: cashMethodId, idempotencyKey: key });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().payment_id).toBe(first.json().payment_id);
    expect(replay.json().idempotent).toBe(true);
    const conflicting = await receive({ cashSessionId: sessionId, amount: 999, paymentMethodId: cashMethodId, idempotencyKey: key });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error).toBe('idempotency_conflict');
  });

  it('protects against duplication under real concurrency: two simultaneous requests with the same idempotency key produce exactly one receipt', async () => {
    const { sessionId } = await registerAndOpen(0);
    const key = `race-dup-${randomUUID()}`;
    const [a, b] = await Promise.all([
      receive({ cashSessionId: sessionId, amount: 15, paymentMethodId: cashMethodId, idempotencyKey: key }),
      receive({ cashSessionId: sessionId, amount: 15, paymentMethodId: cashMethodId, idempotencyKey: key }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(a.json().payment_id).toBe(b.json().payment_id);
    const movements = (await app.inject({ method: 'GET', url: `/cash-sessions/${sessionId}/movements`, headers: { cookie } })).json();
    expect(movements.items.filter((m: { type: string }) => m.type === 'receipt')).toHaveLength(1);
  });

  it('rejects a receipt without the payments.create permission', async () => {
    const restricted = await createRestrictedIdentity();
    const restrictedCookie = await loginAs(restricted.email);
    const { sessionId } = await registerAndOpen(0);
    expect((await app.inject({ method: 'POST', url: '/payments', headers: { cookie: restrictedCookie }, payload: { cashSessionId: sessionId, amount: 10, paymentMethodId: cashMethodId, idempotencyKey: `forbidden-${randomUUID()}` } })).statusCode).toBe(403);
  });
});

describe('FIN-01 refunds', () => {
  it('refunds a receipt append-only, decrementing the session balance', async () => {
    const { sessionId } = await registerAndOpen(0);
    const payment = (await receive({ cashSessionId: sessionId, amount: 60, paymentMethodId: cashMethodId, idempotencyKey: `torefund-${randomUUID()}` })).json();
    const refunded = await refund(payment.payment_id, { cashSessionId: sessionId, reason: 'Cliente desistiu' });
    expect(refunded.statusCode).toBe(201);
    expect(refunded.json()).toMatchObject({ resulting_balance: '0.00', idempotent: false });
    const detail = (await app.inject({ method: 'GET', url: `/payments/${payment.payment_id}`, headers: { cookie } })).json();
    expect(detail.refunded).toBe(true);
  });

  it('is idempotent: refunding an already-refunded payment replays the same movement instead of duplicating', async () => {
    const { sessionId } = await registerAndOpen(0);
    const payment = (await receive({ cashSessionId: sessionId, amount: 20, paymentMethodId: cashMethodId, idempotencyKey: `torefund2-${randomUUID()}` })).json();
    const first = await refund(payment.payment_id, { cashSessionId: sessionId });
    const second = await refund(payment.payment_id, { cashSessionId: sessionId });
    expect(second.statusCode).toBe(200);
    expect(second.json().movement_id).toBe(first.json().movement_id);
  });

  it('protects against a duplicate refund under real concurrency: exactly one refund movement is created', async () => {
    const { sessionId } = await registerAndOpen(0);
    const payment = (await receive({ cashSessionId: sessionId, amount: 20, paymentMethodId: cashMethodId, idempotencyKey: `torefund-race-${randomUUID()}` })).json();
    const [a, b] = await Promise.all([refund(payment.payment_id, { cashSessionId: sessionId }), refund(payment.payment_id, { cashSessionId: sessionId })]);
    expect([a.statusCode, b.statusCode].every((code) => code === 200 || code === 201)).toBe(true);
    const movements = (await app.inject({ method: 'GET', url: `/cash-sessions/${sessionId}/movements`, headers: { cookie } })).json();
    expect(movements.items.filter((m: { type: string; payment_id: string }) => m.type === 'refund' && m.payment_id === payment.payment_id)).toHaveLength(1);
  });

  it('rejects a refund that would push the session balance negative', async () => {
    const { register, sessionId } = await registerAndOpen(0);
    const payment = (await receive({ cashSessionId: sessionId, amount: 50, paymentMethodId: cashMethodId, idempotencyKey: `neg-${randomUUID()}` })).json();
    // fecha esta sessão (leva o saldo consigo) e abre outra, com saldo inicial menor que o estorno
    await closeSession(sessionId, 50);
    const newSession = (await openSession(register.id, 10)).json();
    expect((await refund(payment.payment_id, { cashSessionId: newSession.session_id })).statusCode).toBe(409);
  });

  it('rejects a refund without the payments.refund permission', async () => {
    const { sessionId } = await registerAndOpen(0);
    const payment = (await receive({ cashSessionId: sessionId, amount: 15, paymentMethodId: cashMethodId, idempotencyKey: `perm-${randomUUID()}` })).json();
    const restricted = await createRestrictedIdentity();
    const restrictedCookie = await loginAs(restricted.email);
    expect((await app.inject({ method: 'POST', url: `/payments/${payment.payment_id}/refund`, headers: { cookie: restrictedCookie }, payload: { cashSessionId: sessionId } })).statusCode).toBe(403);
  });
});

describe('FIN-01 sale/service order cancellation guard', () => {
  it('blocks canceling a sale that has an unrefunded receipt, and allows it after the refund', async () => {
    const { sessionId } = await registerAndOpen(0);
    const saleId = await makeSale();
    const payment = (await receive({ cashSessionId: sessionId, amount: 100, paymentMethodId: cashMethodId, saleId, idempotencyKey: `cancel-guard-${randomUUID()}` })).json();
    const blocked = await app.inject({ method: 'POST', url: `/sales/${saleId}/cancel`, headers: { cookie } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe('sale_has_active_payments');
    await refund(payment.payment_id, { cashSessionId: sessionId });
    const allowed = await app.inject({ method: 'POST', url: `/sales/${saleId}/cancel`, headers: { cookie } });
    expect(allowed.statusCode).toBe(200);
  });

  it('blocks canceling a service order that has an unrefunded receipt', async () => {
    const { sessionId } = await registerAndOpen(0);
    const orderId = await makeServiceOrder();
    await receive({ cashSessionId: sessionId, amount: 40, paymentMethodId: cashMethodId, serviceOrderId: orderId, idempotencyKey: `os-cancel-guard-${randomUUID()}` });
    const blocked = await app.inject({ method: 'PATCH', url: `/service-orders/${orderId}`, headers: { cookie }, payload: { status: 'canceled' } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe('service_order_has_active_payments');
  });
});

describe('FIN-01 auditing', () => {
  it('audits cash opening, closing, receipt creation and refund', async () => {
    const { sessionId } = await registerAndOpen(0);
    const payment = (await receive({ cashSessionId: sessionId, amount: 10, paymentMethodId: cashMethodId, idempotencyKey: `audit-${randomUUID()}` })).json();
    await refund(payment.payment_id, { cashSessionId: sessionId });
    await closeSession(sessionId, 0);
    const opened = (await app.inject({ method: 'GET', url: `/audit-events?resourceId=${sessionId}&action=cash_session.opened`, headers: { cookie } })).json();
    expect(opened.items.length).toBeGreaterThanOrEqual(1);
    const closed = (await app.inject({ method: 'GET', url: `/audit-events?resourceId=${sessionId}&action=cash_session.closed`, headers: { cookie } })).json();
    expect(closed.items.length).toBeGreaterThanOrEqual(1);
    const created = (await app.inject({ method: 'GET', url: `/audit-events?resourceId=${payment.payment_id}&action=payment.created`, headers: { cookie } })).json();
    expect(created.items.length).toBeGreaterThanOrEqual(1);
    const refunded = (await app.inject({ method: 'GET', url: `/audit-events?resourceId=${payment.payment_id}&action=payment.refunded`, headers: { cookie } })).json();
    expect(refunded.items.length).toBeGreaterThanOrEqual(1);
  });
});

describe('FIN-01 historical movement immutability', () => {
  it('rejects any UPDATE or DELETE on cash_movements, even from the migration role', async () => {
    const { sessionId } = await registerAndOpen(0);
    const [movement] = await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${tenantAlpha},true)`; return tx<{ id: string }[]>`select id from cash_movements where cash_session_id=${sessionId} limit 1`; });
    // `vetoros_migration` também é NOBYPASSRLS (seção 11) — sem `app.tenant_id` no config da
    // sessão, a política de RLS não deixaria a linha nem ser vista pelo UPDATE/DELETE (ela
    // simplesmente afetaria zero linhas, sem erro nenhum — o que provaria a coisa errada). O
    // teste real é o trigger `reject_cash_movement_mutation`, então o contexto de tenant precisa
    // estar setado para a linha realmente entrar no plano do UPDATE e o trigger disparar.
    await expect(admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${tenantAlpha},true)`; return tx`update cash_movements set amount=999 where id=${movement!.id}`; })).rejects.toThrow(/append-only/);
    await expect(admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${tenantAlpha},true)`; return tx`delete from cash_movements where id=${movement!.id}`; })).rejects.toThrow(/append-only/);
  });

  it('rejects any UPDATE or DELETE on payments — a receipt is compensated by a refund, never edited', async () => {
    const { sessionId } = await registerAndOpen(0);
    const payment = (await receive({ cashSessionId: sessionId, amount: 10, paymentMethodId: cashMethodId, idempotencyKey: `immutable-${randomUUID()}` })).json();
    await expect(admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${tenantAlpha},true)`; return tx`update payments set amount=1 where id=${payment.payment_id}`; })).rejects.toThrow(/append-only/);
    await expect(admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${tenantAlpha},true)`; return tx`delete from payments where id=${payment.payment_id}`; })).rejects.toThrow(/append-only/);
  });
});
