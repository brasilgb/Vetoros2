import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

// FIN-04 — suíte de integração da API. Ver executed.md "Testes" para a lista completa. Segue o
// mesmo padrão de payables.integration.test.ts/receivables.integration.test.ts: `app.inject()`
// contra um Postgres real, login como `single@vetoros.local` (todas as permissions via a
// reconciliação do SAN-01), `admin` (conexão vetoros_migration) para fixtures cross-tenant.

const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const tenantAlpha = '01992ea1-1250-7000-8000-000000000010', companyAlpha = '01992ea1-1250-7000-8000-000000000012', branchAlpha = '01992ea1-1250-7000-8000-000000000013';
const companyAlphaServices = '01992ea1-1250-7000-8000-000000000017';
const beta = '01992ea1-1250-7000-8000-000000000020', betaCompany = '01992ea1-1250-7000-8000-000000000022';
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
const create = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/financial-accounts', headers: { cookie }, payload });
const patch = (accId: string, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/financial-accounts/${accId}`, headers: { cookie }, payload });
const getAccount = (accId: string) => app.inject({ method: 'GET', url: `/financial-accounts/${accId}`, headers: { cookie } });
const listAccounts = (query = '') => app.inject({ method: 'GET', url: `/financial-accounts?${query}`, headers: { cookie } });
const openingBalance = (accId: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/financial-accounts/${accId}/opening-balance`, headers: { cookie }, payload });
const transact = (accId: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/financial-accounts/${accId}/transactions`, headers: { cookie }, payload });
const listTransactions = (accId: string, query = '') => app.inject({ method: 'GET', url: `/financial-accounts/${accId}/transactions?${query}`, headers: { cookie } });
const reverseTx = (accId: string, txId: string, payload: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `/financial-accounts/${accId}/transactions/${txId}/reverse`, headers: { cookie }, payload });
const transfer = (accId: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/financial-accounts/${accId}/transfer`, headers: { cookie }, payload });
const reverseTransfer = (transferId: string, payload: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `/financial-transfers/${transferId}/reverse`, headers: { cookie }, payload });

async function makeAccount(name = `Conta FIN-04 ${randomUUID()}`) {
  const response = await create({ name });
  return response.json() as { id: string };
}
async function createRestrictedIdentity() {
  const identityId = randomUUID(), membershipId = randomUUID(), profileId = randomUUID(), roleId = randomUUID(), grantId = randomUUID();
  const email = `restricted-fin04-${randomUUID()}@vetoros.local`;
  const [existing] = await admin<{ password_hash: string }[]>`select password_hash from identities where email_normalized='single@vetoros.local'`;
  await admin`insert into identities(id,email_normalized,password_hash,display_name,status) values(${identityId},${email},${existing!.password_hash},'Restrito FIN-04','active')`;
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenantAlpha},true)`;
    await tx`insert into tenant_memberships(id,tenant_id,identity_id,status) values(${membershipId},${tenantAlpha},${identityId},'active')`;
    await tx`insert into tenant_user_profiles(id,tenant_id,membership_id,name) values(${profileId},${tenantAlpha},${membershipId},'Restrito FIN-04')`;
    await tx`insert into tenant_roles(id,tenant_id,code,name,scope_type) values(${roleId},${tenantAlpha},${`fin04_restricted_${roleId}`},'FIN-04 restricted','tenant')`;
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
async function insertBetaAccount() {
  const accId = randomUUID();
  await admin.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${beta},true)`;
    await tx`insert into financial_accounts(id,tenant_id,company_id,name) values(${accId},${beta},${betaCompany},${`Conta Beta ${accId}`})`;
  });
  return { accId };
}

describe('FIN-04 creation (conta financeira)', () => {
  it('requires authentication and full operational context', async () => {
    expect((await app.inject({ method: 'GET', url: '/financial-accounts' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'shared@vetoros.local', password } });
    expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: { cookie: String(login.headers['set-cookie']).split(';')[0]! } })).statusCode).toBe(409);
  });

  it('creates a financial account with only a name (bank data all optional)', async () => {
    const created = await create({ name: `Conta simples ${randomUUID()}` });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ type: 'bank_account', status: 'active', balance: '0' });
  });

  it('creates a financial account with full bank data', async () => {
    const created = await create({ name: `Conta completa ${randomUUID()}`, bankCode: '001', bankName: 'Banco do Brasil', branchNumber: '1234', accountNumber: '56789', accountDigit: '0', pixKey: 'chave@pix.com' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ bank_code: '001', bank_name: 'Banco do Brasil', pix_key: 'chave@pix.com' });
  });

  it('rejects an empty name (payload validation)', async () => {
    expect((await create({ name: '' })).statusCode).toBe(400);
    expect((await create({})).statusCode).toBe(400);
  });

  it('rejects a duplicate name for the same company (409)', async () => {
    const name = `Conta duplicada ${randomUUID()}`;
    expect((await create({ name })).statusCode).toBe(201);
    expect((await create({ name })).statusCode).toBe(409);
  });

  it('never accepts a credential-shaped field (payload is strict — unknown fields rejected)', async () => {
    expect((await create({ name: `Conta segura ${randomUUID()}`, password: 'x', token: 'y' })).statusCode).toBe(400);
  });
});

describe('FIN-04 listing, detail and update', () => {
  it('lists accounts scoped to the active company and finds one by detail', async () => {
    const acc = await makeAccount();
    const list = await listAccounts();
    expect(list.statusCode).toBe(200);
    expect(list.json().map((a: { id: string }) => a.id)).toContain(acc.id);
    const detail = await getAccount(acc.id);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ balance: '0', has_opening_balance: false });
  });

  it('returns 404 for a nonexistent account', async () => {
    expect((await getAccount(randomUUID())).statusCode).toBe(404);
  });

  it('updates allowed administrative fields (name, bank data, status)', async () => {
    const acc = await makeAccount();
    const updated = await patch(acc.id, { bankName: 'Novo Banco', status: 'inactive' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ bank_name: 'Novo Banco', status: 'inactive' });
  });

  it('prefers deactivation to deletion — there is no DELETE endpoint for a financial account', async () => {
    const acc = await makeAccount();
    expect((await app.inject({ method: 'DELETE', url: `/financial-accounts/${acc.id}`, headers: { cookie } })).statusCode).toBe(404);
  });
});

describe('FIN-04 opening balance (seção 12 — sempre uma movimentação, nunca coluna solta)', () => {
  it('sets a positive opening balance as a credit movement', async () => {
    const acc = await makeAccount();
    const result = await openingBalance(acc.id, { amount: 1000, idempotencyKey: `open-${randomUUID()}` });
    expect(result.statusCode).toBe(201);
    expect(result.json().resulting_balance).toBe('1000.00');
    expect((await getAccount(acc.id)).json()).toMatchObject({ balance: '1000.00', has_opening_balance: true });
  });

  it('sets a negative opening balance as a debit movement (account starts already overdrawn)', async () => {
    const acc = await makeAccount();
    const result = await openingBalance(acc.id, { amount: -250, idempotencyKey: `open-neg-${randomUUID()}` });
    expect(result.statusCode).toBe(201);
    expect((await getAccount(acc.id)).json().balance).toBe('-250.00');
  });

  it('rejects a second opening balance for the same account (at most one, structurally enforced)', async () => {
    const acc = await makeAccount();
    await openingBalance(acc.id, { amount: 500, idempotencyKey: `open-a-${randomUUID()}` });
    const second = await openingBalance(acc.id, { amount: 100, idempotencyKey: `open-b-${randomUUID()}` });
    expect(second.statusCode).toBe(409);
  });

  it('is idempotent for a retry with the same idempotencyKey', async () => {
    const acc = await makeAccount();
    const key = `open-idem-${randomUUID()}`;
    const first = await openingBalance(acc.id, { amount: 300, idempotencyKey: key });
    const second = await openingBalance(acc.id, { amount: 300, idempotencyKey: key });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().transaction_id).toBe(first.json().transaction_id);
  });

  it('rejects a zero opening balance amount (validation)', async () => {
    const acc = await makeAccount();
    expect((await openingBalance(acc.id, { amount: 0, idempotencyKey: `open-zero-${randomUUID()}` })).statusCode).toBe(400);
  });
});

describe('FIN-04 manual credit/debit and reversal', () => {
  it('records a manual credit and a manual debit, deriving the balance from the ledger', async () => {
    const acc = await makeAccount();
    const credit = await transact(acc.id, { type: 'credit', amount: 500, description: 'Depósito', idempotencyKey: `tx-c-${randomUUID()}` });
    expect(credit.statusCode).toBe(201);
    expect(credit.json().resulting_balance).toBe('500.00');
    const debit = await transact(acc.id, { type: 'debit', amount: 120, description: 'Tarifa', idempotencyKey: `tx-d-${randomUUID()}` });
    expect(debit.statusCode).toBe(201);
    expect(debit.json().resulting_balance).toBe('380.00');
    expect((await getAccount(acc.id)).json().balance).toBe('380.00');
  });

  it('does NOT block a debit that would produce a negative balance (seção 11 — decisão explícita, sem bloqueio universal)', async () => {
    const acc = await makeAccount();
    const debit = await transact(acc.id, { type: 'debit', amount: 999, description: 'Saque sem saldo', idempotencyKey: `tx-neg-${randomUUID()}` });
    expect(debit.statusCode).toBe(201);
    expect(debit.json().resulting_balance).toBe('-999.00');
  });

  it('rejects a manual entry on an inactive account', async () => {
    const acc = await makeAccount();
    await patch(acc.id, { status: 'inactive' });
    expect((await transact(acc.id, { type: 'credit', amount: 10, description: 'x', idempotencyKey: `tx-inactive-${randomUUID()}` })).statusCode).toBe(404);
  });

  it('validates the payload (amount must be positive, description required, type restricted to credit/debit)', async () => {
    const acc = await makeAccount();
    expect((await transact(acc.id, { type: 'credit', amount: -1, description: 'x', idempotencyKey: `tx-bad-1-${randomUUID()}` })).statusCode).toBe(400);
    expect((await transact(acc.id, { type: 'credit', amount: 10, description: '', idempotencyKey: `tx-bad-2-${randomUUID()}` })).statusCode).toBe(400);
    expect((await transact(acc.id, { type: 'transfer', amount: 10, description: 'x', idempotencyKey: `tx-bad-3-${randomUUID()}` })).statusCode).toBe(400);
  });

  it('is idempotent: a second call with the same idempotencyKey returns the same transaction instead of duplicating', async () => {
    const acc = await makeAccount();
    const key = `tx-idem-${randomUUID()}`;
    const first = await transact(acc.id, { type: 'credit', amount: 80, description: 'Idempotente', idempotencyKey: key });
    const second = await transact(acc.id, { type: 'credit', amount: 80, description: 'Idempotente', idempotencyKey: key });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().transaction_id).toBe(first.json().transaction_id);
    expect((await getAccount(acc.id)).json().balance).toBe('80.00'); // não duplicou
  });

  it('rejects reusing an idempotencyKey with different parameters (23505 idempotency conflict)', async () => {
    const acc = await makeAccount();
    const key = `tx-conflict-${randomUUID()}`;
    await transact(acc.id, { type: 'credit', amount: 80, description: 'Original', idempotencyKey: key });
    const conflicting = await transact(acc.id, { type: 'debit', amount: 999, description: 'Diferente', idempotencyKey: key });
    expect(conflicting.statusCode).toBe(409);
  });

  it('does not duplicate two concurrent retries with the same idempotencyKey (concorrência real)', async () => {
    const acc = await makeAccount();
    const key = `tx-concurrent-${randomUUID()}`;
    const [a, b] = await Promise.all([
      transact(acc.id, { type: 'credit', amount: 200, description: 'Concorrente', idempotencyKey: key }),
      transact(acc.id, { type: 'credit', amount: 200, description: 'Concorrente', idempotencyKey: key }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 201]);
    expect(a.json().transaction_id).toBe(b.json().transaction_id);
    expect((await getAccount(acc.id)).json().balance).toBe('200.00'); // só um lançamento, não dois
  });

  it('reverses a manual entry, applying the inverse movement without editing the original', async () => {
    const acc = await makeAccount();
    const credit = await transact(acc.id, { type: 'credit', amount: 250, description: 'Reversível', idempotencyKey: `tx-rev-${randomUUID()}` });
    const reversed = await reverseTx(acc.id, credit.json().transaction_id, { reason: 'Lançamento em duplicidade' });
    expect(reversed.statusCode).toBe(201);
    expect((await getAccount(acc.id)).json().balance).toBe('0.00');
    const list = await listTransactions(acc.id);
    expect(list.json().items.map((i: { origin: string }) => i.origin)).toEqual(expect.arrayContaining(['manual', 'reversal']));
  });

  it('rejects a double reversal of the same transaction (idempotent, not an error, on retry)', async () => {
    const acc = await makeAccount();
    const credit = await transact(acc.id, { type: 'credit', amount: 60, description: 'Duplo estorno', idempotencyKey: `tx-dbl-${randomUUID()}` });
    const first = await reverseTx(acc.id, credit.json().transaction_id);
    const second = await reverseTx(acc.id, credit.json().transaction_id);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotent).toBe(true);
    expect(second.json().reversal_id).toBe(first.json().reversal_id);
  });

  it('rejects reversing an already-reversed transaction id directly again with a different call shape (cross-check via list)', async () => {
    const acc = await makeAccount();
    const credit = await transact(acc.id, { type: 'credit', amount: 40, description: 'x', idempotencyKey: `tx-list-${randomUUID()}` });
    await reverseTx(acc.id, credit.json().transaction_id);
    const list = await listTransactions(acc.id);
    const reversalRow = list.json().items.find((i: { origin: string }) => i.origin === 'reversal');
    expect(reversalRow).toBeTruthy();
    // o estorno em si não pode ser estornado (origin='reversal' é bloqueado na função)
    const reverseTheReversal = await reverseTx(acc.id, reversalRow.id);
    expect(reverseTheReversal.statusCode).toBe(400);
  });

  it('returns 404 reversing a transaction that does not belong to the given account', async () => {
    const accA = await makeAccount(), accB = await makeAccount();
    const credit = await transact(accA.id, { type: 'credit', amount: 10, description: 'x', idempotencyKey: `tx-cross-acc-${randomUUID()}` });
    expect((await reverseTx(accB.id, credit.json().transaction_id)).statusCode).toBe(404);
  });
});

describe('FIN-04 transfers (atômica, idempotente, mesma empresa)', () => {
  it('transfers between two accounts atomically: debits origin and credits destination', async () => {
    const from = await makeAccount(), to = await makeAccount();
    await transact(from.id, { type: 'credit', amount: 1000, description: 'Saldo', idempotencyKey: `pre-${randomUUID()}` });
    const result = await transfer(from.id, { toFinancialAccountId: to.id, amount: 300, description: 'Transferência', idempotencyKey: `tr-${randomUUID()}` });
    expect(result.statusCode).toBe(201);
    expect((await getAccount(from.id)).json().balance).toBe('700.00');
    expect((await getAccount(to.id)).json().balance).toBe('300.00');
  });

  it('rejects a transfer to itself', async () => {
    const acc = await makeAccount();
    expect((await transfer(acc.id, { toFinancialAccountId: acc.id, amount: 10, description: 'x', idempotencyKey: `tr-self-${randomUUID()}` })).statusCode).toBe(400);
  });

  it('rejects a transfer between accounts of different companies (documented architectural decision)', async () => {
    const from = await makeAccount();
    const otherCompanyAccountId = randomUUID();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id',${tenantAlpha},true)`;
      await tx`insert into financial_accounts(id,tenant_id,company_id,name) values(${otherCompanyAccountId},${tenantAlpha},${companyAlphaServices},${`Conta outra empresa ${randomUUID()}`})`;
    });
    const result = await transfer(from.id, { toFinancialAccountId: otherCompanyAccountId, amount: 10, description: 'x', idempotencyKey: `tr-cross-company-${randomUUID()}` });
    // a conta de outra empresa não é visível pelo escopo ativo (company scope) -> 404, nunca 500
    expect(result.statusCode).toBe(404);
  });

  it('rejects a nonpositive transfer amount (validation)', async () => {
    const from = await makeAccount(), to = await makeAccount();
    expect((await transfer(from.id, { toFinancialAccountId: to.id, amount: 0, description: 'x', idempotencyKey: `tr-zero-${randomUUID()}` })).statusCode).toBe(400);
  });

  it('is idempotent for a retry with the same idempotencyKey (no duplicate transfer)', async () => {
    const from = await makeAccount(), to = await makeAccount();
    const key = `tr-idem-${randomUUID()}`;
    const first = await transfer(from.id, { toFinancialAccountId: to.id, amount: 150, description: 'x', idempotencyKey: key });
    const second = await transfer(from.id, { toFinancialAccountId: to.id, amount: 150, description: 'x', idempotencyKey: key });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().transfer_id).toBe(first.json().transfer_id);
    expect((await getAccount(to.id)).json().balance).toBe('150.00'); // só uma transferência aplicada
  });

  it('does not duplicate two concurrent retries with the same idempotencyKey (concorrência real)', async () => {
    const from = await makeAccount(), to = await makeAccount();
    const key = `tr-concurrent-${randomUUID()}`;
    const [a, b] = await Promise.all([
      transfer(from.id, { toFinancialAccountId: to.id, amount: 90, description: 'x', idempotencyKey: key }),
      transfer(from.id, { toFinancialAccountId: to.id, amount: 90, description: 'x', idempotencyKey: key }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 201]);
    expect(a.json().transfer_id).toBe(b.json().transfer_id);
    expect((await getAccount(to.id)).json().balance).toBe('90.00'); // não duplicou a transferência
  });

  it('reverses a transfer atomically (both legs), reopening both balances', async () => {
    const from = await makeAccount(), to = await makeAccount();
    await transact(from.id, { type: 'credit', amount: 500, description: 'Saldo', idempotencyKey: `pre-rev-${randomUUID()}` });
    const created = await transfer(from.id, { toFinancialAccountId: to.id, amount: 200, description: 'x', idempotencyKey: `tr-rev-${randomUUID()}` });
    const reversed = await reverseTransfer(created.json().transfer_id, { reason: 'Transferência errada' });
    expect(reversed.statusCode).toBe(201);
    expect((await getAccount(from.id)).json().balance).toBe('500.00');
    expect((await getAccount(to.id)).json().balance).toBe('0.00');
  });

  it('rejects a double reversal of the same transfer (idempotent, not an error, on retry)', async () => {
    const from = await makeAccount(), to = await makeAccount();
    const created = await transfer(from.id, { toFinancialAccountId: to.id, amount: 40, description: 'x', idempotencyKey: `tr-dbl-${randomUUID()}` });
    const first = await reverseTransfer(created.json().transfer_id);
    const second = await reverseTransfer(created.json().transfer_id);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotent).toBe(true);
  });

  it('rejects transferring from/to an inactive account', async () => {
    const from = await makeAccount(), to = await makeAccount();
    await patch(to.id, { status: 'inactive' });
    expect((await transfer(from.id, { toFinancialAccountId: to.id, amount: 10, description: 'x', idempotencyKey: `tr-inactive-${randomUUID()}` })).statusCode).toBe(404);
  });
});

describe('FIN-04 RBAC, auditoria e isolamento de tenant', () => {
  it('rejects create/read/transact/transfer without the specific financial_accounts.* permission (403)', async () => {
    const restricted = await createRestrictedIdentity();
    const restrictedCookie = await loginAs(restricted.email);
    expect((await app.inject({ method: 'POST', url: '/financial-accounts', headers: { cookie: restrictedCookie }, payload: { name: 'x' } })).statusCode).toBe(403);
    const acc = await makeAccount();
    expect((await app.inject({ method: 'GET', url: '/financial-accounts', headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/financial-accounts/${acc.id}`, headers: { cookie: restrictedCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/financial-accounts/${acc.id}/transactions`, headers: { cookie: restrictedCookie }, payload: { type: 'credit', amount: 10, description: 'x', idempotencyKey: `rbac-${randomUUID()}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/financial-accounts/${acc.id}/transfer`, headers: { cookie: restrictedCookie }, payload: { toFinancialAccountId: acc.id, amount: 10, description: 'x', idempotencyKey: `rbac-tr-${randomUUID()}` } })).statusCode).toBe(403);
  });

  it('rejects update without financial_accounts.update and leaves the account unchanged (403)', async () => {
    const restricted = await createRestrictedIdentity();
    const restrictedCookie = await loginAs(restricted.email);
    const originalName = `Conta protegida ${randomUUID()}`;
    const acc = await makeAccount(originalName);

    const response = await app.inject({
      method: 'PATCH',
      url: `/financial-accounts/${acc.id}`,
      headers: { cookie: restrictedCookie },
      payload: { name: `Alteração negada ${randomUUID()}`, status: 'inactive' },
    });

    expect(response.statusCode).toBe(403);
    expect((await getAccount(acc.id)).json()).toMatchObject({ name: originalName, status: 'active' });
  });

  it('rejects transaction and transfer reversal without financial_accounts.reverse and preserves ledger and balances (403)', async () => {
    const restricted = await createRestrictedIdentity();
    const restrictedCookie = await loginAs(restricted.email);
    const from = await makeAccount(), to = await makeAccount();
    const credit = await transact(from.id, { type: 'credit', amount: 200, description: 'Crédito protegido', idempotencyKey: `rbac-rev-tx-${randomUUID()}` });
    const createdTransfer = await transfer(from.id, { toFinancialAccountId: to.id, amount: 50, description: 'Transferência protegida', idempotencyKey: `rbac-rev-tr-${randomUUID()}` });

    const transactionReversal = await app.inject({
      method: 'POST',
      url: `/financial-accounts/${from.id}/transactions/${credit.json().transaction_id}/reverse`,
      headers: { cookie: restrictedCookie },
      payload: { reason: 'Tentativa sem permissão' },
    });
    const transferReversal = await app.inject({
      method: 'POST',
      url: `/financial-transfers/${createdTransfer.json().transfer_id}/reverse`,
      headers: { cookie: restrictedCookie },
      payload: { reason: 'Tentativa sem permissão' },
    });

    expect(transactionReversal.statusCode).toBe(403);
    expect(transferReversal.statusCode).toBe(403);
    expect((await getAccount(from.id)).json().balance).toBe('150.00');
    expect((await getAccount(to.id)).json().balance).toBe('50.00');
    const fromTransactions = (await listTransactions(from.id)).json().items as { origin: string }[];
    const toTransactions = (await listTransactions(to.id)).json().items as { origin: string }[];
    expect([...fromTransactions, ...toTransactions].filter((item) => item.origin === 'reversal')).toHaveLength(0);
  });

  it('audits account creation, manual entry, reversal and transfer', async () => {
    const acc = await makeAccount('Auditoria FIN-04 ' + randomUUID());
    const events1 = (await app.inject({ method: 'GET', url: `/audit-events?resourceType=financial_account&resourceId=${acc.id}`, headers: { cookie } })).json();
    expect(events1.items.some((e: { action: string }) => e.action === 'financial_account.created')).toBe(true);
    const credit = await transact(acc.id, { type: 'credit', amount: 55, description: 'x', idempotencyKey: `audit-tx-${randomUUID()}` });
    await reverseTx(acc.id, credit.json().transaction_id);
    const events2 = (await app.inject({ method: 'GET', url: `/audit-events?resourceType=financial_account&resourceId=${acc.id}`, headers: { cookie } })).json();
    const actions = events2.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['financial_account.created', 'financial_transaction.created', 'financial_transaction.reversed']));
  });

  it('audits a transfer as financial_transfer.created/reversed', async () => {
    const from = await makeAccount(), to = await makeAccount();
    const created = await transfer(from.id, { toFinancialAccountId: to.id, amount: 25, description: 'Auditoria transferência', idempotencyKey: `audit-tr-${randomUUID()}` });
    await reverseTransfer(created.json().transfer_id);
    const events = (await app.inject({ method: 'GET', url: `/audit-events?resourceType=financial_transfer&resourceId=${created.json().transfer_id}`, headers: { cookie } })).json();
    const actions = events.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['financial_transfer.created', 'financial_transfer.reversed']));
  });

  it('isolates tenants: a financial account from another tenant is invisible and inaccessible', async () => {
    const { accId } = await insertBetaAccount();
    expect((await getAccount(accId)).statusCode).toBe(404);
    expect((await transact(accId, { type: 'credit', amount: 10, description: 'x', idempotencyKey: `iso-${randomUUID()}` })).statusCode).toBe(404);
    const list = await listAccounts();
    expect(list.json().map((a: { id: string }) => a.id)).not.toContain(accId);
  });
});
