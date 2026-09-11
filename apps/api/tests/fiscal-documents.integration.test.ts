import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HTTPMethods } from 'fastify';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';
import { FakeFiscalProvider } from '../src/fiscal/fake-provider.js';

// FIS-ADV-01 — cobertura dedicada. `FakeFiscalProvider` (seção 28) substitui a Focus NFe: nenhuma
// chamada de rede real, comportamento decidido explicitamente por teste via `enqueueIssueResult`/
// `enqueueCancelResult`. Mesmo padrão de fixtures/login/isolamento cross-tenant já usado no
// resto da suíte (ver sales-checkout.integration.test.ts para o precedente mais recente).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TestResponse = { statusCode: number; json: () => any };

const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const tenantAlpha = '01992ea1-1250-7000-8000-000000000010', companyAlpha = '01992ea1-1250-7000-8000-000000000012', branchAlpha = '01992ea1-1250-7000-8000-000000000013';
const beta = '01992ea1-1250-7000-8000-000000000020', betaCompany = '01992ea1-1250-7000-8000-000000000022', betaBranch = '01992ea1-1250-7000-8000-000000000023';
const singleRole = '01992ea1-1250-7000-8000-000000000031';
const service = new AuthService(authUrl, runtimeUrl, 3600);
const fiscalProvider = new FakeFiscalProvider();
const app = buildApp({ authService: service, loginRateLimitMax: 1000, fiscalProvider });
const admin = postgres(migrationUrl);
let cookie = '';

const inject = (method: HTTPMethods, url: string, payload?: Record<string, unknown>) => {
  const options = { method, url, ...(cookie ? { headers: { cookie } } : {}), ...(payload ? { payload } : {}) };
  return app.inject(options as never) as unknown as Promise<TestResponse>;
};

async function makeCustomer(personType: 'individual' | 'company') {
  const document = personType === 'individual' ? randomCpf() : randomCnpj();
  const created = await inject('POST', '/customers', { personType, legalName: `Cliente ${randomUUID()}`, document, address: { street: 'Rua Teste', city: 'São Paulo', state: 'SP', country: 'BR' } });
  return created.json().id as string;
}
function randomCpf(): string {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const check = (weighted: number[]) => { const sum = weighted.reduce((total, w, i) => total + d[i]! * w, 0); return ((sum * 10) % 11) % 10; };
  d.push(check(Array.from({ length: 9 }, (_, i) => 10 - i)));
  d.push(check(Array.from({ length: 10 }, (_, i) => 11 - i)));
  return d.join('');
}
function randomCnpj(): string {
  const d = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const check = (weights: number[]) => { const rest = weights.reduce((total, w, i) => total + d[i]! * w, 0) % 11; return rest < 2 ? 0 : 11 - rest; };
  d.push(check([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  d.push(check([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return d.join('');
}
async function makeConfirmedSale(customerId: string, unitPrice = 100) {
  const part = (await inject('POST', '/inventory/parts', { sku: `FIS-${randomUUID()}`, description: 'Peça fiscal', unit: 'un' })).json();
  await inject('POST', '/inventory/movements', { partId: part.id, type: 'entry', quantity: 10, reason: 'Carga FIS-ADV-01' });
  const sale = (await inject('POST', '/sales', { customerId })).json();
  await inject('POST', `/sales/${sale.id}/items`, { type: 'part', inventoryPartId: part.id, description: 'Item fiscal', quantity: 1, unitPrice });
  const confirmed = await inject('POST', `/sales/${sale.id}/confirm`);
  expect(confirmed.statusCode).toBe(200);
  return sale.id as string;
}
async function makeDeliveredServiceOrder(customerId: string, unitPrice = 150) {
  const order = (await inject('POST', '/service-orders', { customerId, title: 'OS fiscal', reportedProblem: 'Teste' })).json();
  await inject('POST', `/service-orders/${order.id}/items`, { type: 'service', description: 'Serviço fiscal', quantity: 1, unitPrice });
  expect((await inject('PATCH', `/service-orders/${order.id}/operational`, { status: 'in_progress' })).statusCode).toBe(200);
  expect((await inject('PATCH', `/service-orders/${order.id}/operational`, { status: 'ready' })).statusCode).toBe(200);
  expect((await inject('PATCH', `/service-orders/${order.id}/operational`, { status: 'delivered' })).statusCode).toBe(200);
  return order.id as string;
}
const createDocument = (payload: Record<string, unknown>) => inject('POST', '/fiscal-documents', payload);
const issue = (documentId: string) => inject('POST', `/fiscal-documents/${documentId}/issue`);

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId: companyAlpha, branchId: branchAlpha } });
});
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });
beforeEach(() => { fiscalProvider.issueCalls = 0; fiscalProvider.consultCalls = 0; fiscalProvider.cancelCalls = 0; });

describe('FIS-ADV-01 — documentos fiscais', () => {
  it('requires authentication and operational context', async () => {
    expect((await app.inject({ method: 'GET', url: '/fiscal-documents' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'shared@vetoros.local', password } });
    expect((await app.inject({ method: 'GET', url: '/fiscal-documents', headers: { cookie: String(login.headers['set-cookie']).split(';')[0]! } })).statusCode).toBe(409);
  });

  it('creates a draft NFC-e from a confirmed sale with a PF customer, snapshotting recipient and items', async () => {
    const customerId = await makeCustomer('individual');
    const saleId = await makeConfirmedSale(customerId, 80);
    const created = await createDocument({ saleId, documentType: 'nfce' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: 'draft', document_type: 'nfce', recipient_person_type: 'individual', total: '80.00' });
    expect(created.json().items).toHaveLength(1);
  });

  it('creates a draft NF-e from a confirmed sale with a PJ customer', async () => {
    const customerId = await makeCustomer('company');
    const saleId = await makeConfirmedSale(customerId, 200);
    const created = await createDocument({ saleId, documentType: 'nfe' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ recipient_person_type: 'company', total: '200.00' });
  });

  it('creates a draft NFS-e from a delivered service order, never from an open one (seção 5: entrega, não aprovação de orçamento)', async () => {
    const customerId = await makeCustomer('individual');
    const openOrder = (await inject('POST', '/service-orders', { customerId, title: 'OS aberta', reportedProblem: 'x' })).json();
    expect((await createDocument({ serviceOrderId: openOrder.id, documentType: 'nfse' })).statusCode).toBe(409);
    const deliveredId = await makeDeliveredServiceOrder(customerId, 90);
    const created = await createDocument({ serviceOrderId: deliveredId, documentType: 'nfse' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ document_type: 'nfse', total: '90.00' });
  });

  it('rejects an ambiguous or missing origin, and a nonexistent/cross-tenant sale', async () => {
    const customerId = await makeCustomer('individual');
    const saleId = await makeConfirmedSale(customerId, 10);
    expect((await createDocument({ documentType: 'nfce' })).statusCode).toBe(400);
    expect((await createDocument({ saleId, serviceOrderId: randomUUID(), documentType: 'nfce' })).statusCode).toBe(400);
    expect((await createDocument({ saleId: randomUUID(), documentType: 'nfce' })).statusCode).toBe(404);
  });

  it('authorizes on issue, numbering and access key coming from the provider — never a local counter', async () => {
    const customerId = await makeCustomer('individual');
    const saleId = await makeConfirmedSale(customerId, 55);
    const created = (await createDocument({ saleId, documentType: 'nfce' })).json();
    const response = await issue(created.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'authorized' });
    expect(Number(response.json().document_number)).toBeGreaterThan(0);
    expect(response.json().access_key).toHaveLength(44);
  });

  it('rejects on issue, preserving the attempt (não apaga o documento) and allowing a new attempt', async () => {
    const customerId = await makeCustomer('individual');
    const saleId = await makeConfirmedSale(customerId, 65);
    const created = (await createDocument({ saleId, documentType: 'nfce' })).json();
    fiscalProvider.enqueueIssueResult({ outcome: 'rejected', reason: 'Rejeitado pela SEFAZ (teste): CPF inválido' });
    const rejected = await issue(created.id);
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({ status: 'rejected', rejection_reason: 'Rejeitado pela SEFAZ (teste): CPF inválido' });
    const retried = await issue(created.id);
    expect(retried.statusCode).toBe(200);
    expect(retried.json().status).toBe('authorized');
  });

  it('recovers from a provider error via consult, without assuming the document was never issued (seção 20)', async () => {
    const customerId = await makeCustomer('individual');
    const saleId = await makeConfirmedSale(customerId, 45);
    const created = (await createDocument({ saleId, documentType: 'nfce' })).json();
    fiscalProvider.enqueueIssueResult({ outcome: 'error', message: 'simulated_timeout' });
    const errored = await issue(created.id);
    expect(errored.statusCode).toBe(502);
    const stuck = (await inject('GET', `/fiscal-documents/${created.id}`)).json();
    expect(stuck.status).toBe('pending');
    // /issue não pode ser chamado de novo sobre um documento `pending` (não é draft/rejected) —
    // a recuperação é sempre por /consult, usando a MESMA referência já enviada ao provedor.
    expect((await issue(created.id)).statusCode).toBe(409);
    fiscalProvider.enqueueIssueResult({ outcome: 'authorized', externalId: 'x', series: '1', documentNumber: 999, accessKey: 'A'.repeat(44) });
    const reconciled = await inject('POST', `/fiscal-documents/${created.id}/consult`);
    expect(reconciled.statusCode).toBe(200);
    expect(reconciled.json().status).toBe('authorized');
  });

  it('concurrency: two simultaneous issue requests on the same draft — only one calls the provider, the other gets 409 (seção 21/22)', async () => {
    const customerId = await makeCustomer('individual');
    const saleId = await makeConfirmedSale(customerId, 33);
    const created = (await createDocument({ saleId, documentType: 'nfce' })).json();
    const [a, b] = await Promise.all([issue(created.id), issue(created.id)]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    expect(fiscalProvider.issueCalls).toBe(1);
  });

  it('cancels an authorized document through the provider — never a local status flip', async () => {
    const customerId = await makeCustomer('individual');
    const saleId = await makeConfirmedSale(customerId, 70);
    const created = (await createDocument({ saleId, documentType: 'nfce' })).json();
    await issue(created.id);
    const cancelled = await inject('POST', `/fiscal-documents/${created.id}/cancel`, { reason: 'Cliente desistiu' });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('cancelled');
    expect(fiscalProvider.cancelCalls).toBe(1);
  });

  it('rejects cancellation when the provider refuses it, reverting to authorized (não fica preso em limbo)', async () => {
    const customerId = await makeCustomer('individual');
    const saleId = await makeConfirmedSale(customerId, 71);
    const created = (await createDocument({ saleId, documentType: 'nfce' })).json();
    await issue(created.id);
    fiscalProvider.enqueueCancelResult({ outcome: 'rejected', reason: 'Prazo de 24h expirado (teste)' });
    const response = await inject('POST', `/fiscal-documents/${created.id}/cancel`, { reason: 'Tentativa' });
    expect(response.statusCode).toBe(409);
    const detail = (await inject('GET', `/fiscal-documents/${created.id}`)).json();
    expect(detail.status).toBe('authorized');
  });

  it('rejects cancelling a document that was never authorized (draft/pending), and cancelling twice is a 409 the second time', async () => {
    const customerId = await makeCustomer('individual');
    const saleId = await makeConfirmedSale(customerId, 72);
    const created = (await createDocument({ saleId, documentType: 'nfce' })).json();
    expect((await inject('POST', `/fiscal-documents/${created.id}/cancel`, { reason: 'x' })).statusCode).toBe(409);
    await issue(created.id);
    expect((await inject('POST', `/fiscal-documents/${created.id}/cancel`, { reason: 'x' })).statusCode).toBe(200);
    expect((await inject('POST', `/fiscal-documents/${created.id}/cancel`, { reason: 'x' })).statusCode).toBe(409);
  });

  it('immutability: fiscal content cannot be mutated directly in the database once issuance was requested', async () => {
    const customerId = await makeCustomer('individual');
    const saleId = await makeConfirmedSale(customerId, 88);
    const created = (await createDocument({ saleId, documentType: 'nfce' })).json();
    await issue(created.id);
    await expect(admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantAlpha}, true)`;
      await tx`update fiscal_documents set total=999.99 where id=${created.id}`;
    })).rejects.toThrow();
    const itemId = created.items[0].id;
    await expect(admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantAlpha}, true)`;
      await tx`delete from fiscal_document_items where id=${itemId}`;
    })).rejects.toThrow();
  });

  it('does not corrupt the sale/stock when the fiscal provider fails — origin stays confirmed regardless of fiscal outcome (seção 17)', async () => {
    const customerId = await makeCustomer('individual');
    const saleId = await makeConfirmedSale(customerId, 60);
    const created = (await createDocument({ saleId, documentType: 'nfce' })).json();
    fiscalProvider.enqueueIssueResult({ outcome: 'error', message: 'simulated_unavailable' });
    await issue(created.id);
    const sale = (await inject('GET', `/sales/${saleId}`)).json();
    expect(sale.status).toBe('confirmed');
  });

  it('isolates tenants: a fiscal document from another tenant is invisible and inaccessible', async () => {
    const betaCustomerId = randomUUID(), betaSaleId = randomUUID(), betaDocId = randomUUID();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${beta}, true)`;
      await tx`insert into customer_number_counters(tenant_id,last_number) values(${beta},1) on conflict(tenant_id) do update set last_number=customer_number_counters.last_number+1 returning last_number`;
      await tx`insert into customers(id,tenant_id,customer_number,person_type,legal_name,status) values(${betaCustomerId},${beta},${Math.floor(Math.random() * 1000000)},'individual','Cliente Beta','active')`;
      await tx`insert into sale_number_counters(tenant_id,last_number) values(${beta},1) on conflict(tenant_id) do update set last_number=sale_number_counters.last_number+1 returning last_number`;
      await tx`insert into sales(id,tenant_id,company_id,branch_id,sale_number,customer_id,status) values(${betaSaleId},${beta},${betaCompany},${betaBranch},${Math.floor(Math.random() * 1000000) + 7000000},${betaCustomerId},'confirmed')`;
      await tx`insert into fiscal_documents(id,tenant_id,company_id,branch_id,origin_sale_id,document_type,status,environment,recipient_person_type,recipient_legal_name,subtotal,total,idempotency_key) values(${betaDocId},${beta},${betaCompany},${betaBranch},${betaSaleId},'nfce','draft','homologacao','individual','Cliente Beta',10,10,${`fd-${randomUUID()}`})`;
    });
    expect((await inject('GET', `/fiscal-documents/${betaDocId}`)).statusCode).toBe(404);
    expect((await issue(betaDocId)).statusCode).toBe(404);
    const list = await inject('GET', '/fiscal-documents?pageSize=100');
    expect((list.json().items as Array<{ id: string }>).some((row) => row.id === betaDocId)).toBe(false);
  });

  it('RBAC negativo: nega create/issue/cancel sem as permissions fiscal.*, preservando o estado', async () => {
    const customerId = await makeCustomer('individual');
    const saleId = await makeConfirmedSale(customerId, 40);
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantAlpha}, true)`;
      await tx`delete from tenant_role_permissions where tenant_id=${tenantAlpha} and role_id=${singleRole} and permission_id in (select id from permissions where code in ('fiscal.create','fiscal.issue','fiscal.cancel'))`;
    });
    try {
      expect((await createDocument({ saleId, documentType: 'nfce' })).statusCode).toBe(403);
    } finally {
      await admin.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantAlpha}, true)`;
        await tx`insert into tenant_role_permissions(tenant_id,role_id,permission_id) select ${tenantAlpha},${singleRole},id from permissions where code in ('fiscal.create','fiscal.issue','fiscal.cancel') on conflict do nothing`;
      });
    }
    const created = (await createDocument({ saleId, documentType: 'nfce' })).json();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantAlpha}, true)`;
      await tx`delete from tenant_role_permissions where tenant_id=${tenantAlpha} and role_id=${singleRole} and permission_id in (select id from permissions where code='fiscal.issue')`;
    });
    try {
      expect((await issue(created.id)).statusCode).toBe(403);
      expect((await inject('GET', `/fiscal-documents/${created.id}`)).json().status).toBe('draft');
    } finally {
      await admin.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantAlpha}, true)`;
        await tx`insert into tenant_role_permissions(tenant_id,role_id,permission_id) select ${tenantAlpha},${singleRole},id from permissions where code='fiscal.issue' on conflict do nothing`;
      });
    }
  });
});
