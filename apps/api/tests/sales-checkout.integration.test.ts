import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HTTPMethods } from 'fastify';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

// PDV-ADV-01, seção 21/44: suíte dedicada do orquestrador transacional `POST
// /sales/:id/checkout`. Cobre só o que é NOVO (a coordenação atômica confirmar+pagar); as
// regras físicas de confirmação/estoque/cancelamento já têm cobertura própria e exaustiva em
// sales.integration.test.ts — não duplicadas aqui.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TestResponse = { statusCode: number; json: () => any };

const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const customer = '01992ea1-1250-7000-8000-000000000050';
const tenantAlpha = '01992ea1-1250-7000-8000-000000000010', companyAlpha = '01992ea1-1250-7000-8000-000000000012', branchAlpha = '01992ea1-1250-7000-8000-000000000013';
const singleRole = '01992ea1-1250-7000-8000-000000000031';
const service = new AuthService(authUrl, runtimeUrl, 3600), app = buildApp({ authService: service, loginRateLimitMax: 1000 }), admin = postgres(migrationUrl);
let cookie = '';
let cashMethodId = '', pixMethodId = '';

const inject = (method: HTTPMethods, url: string, payload?: Record<string, unknown>) => {
  const options = { method, url, ...(cookie ? { headers: { cookie } } : {}), ...(payload ? { payload } : {}) };
  return app.inject(options as never) as unknown as Promise<TestResponse>;
};

async function registerAndOpen(openingAmount = 0) {
  const register = (await inject('POST', '/cash-registers', { name: `Caixa PDV ${randomUUID()}` })).json();
  const session = (await inject('POST', '/cash-sessions/open', { cashRegisterId: register.id, openingAmount })).json();
  return session.session_id as string;
}
async function makePart(quantity = 10) {
  const part = (await inject('POST', '/inventory/parts', { sku: `PDV-${randomUUID()}`, description: 'Peça PDV', unit: 'un' })).json();
  await inject('POST', '/inventory/movements', { partId: part.id, type: 'entry', quantity, reason: 'Carga PDV' });
  return part.id as string;
}
async function makeDraftSale(partId: string, quantity: number, unitPrice: number) {
  const sale = (await inject('POST', '/sales', { customerId: customer })).json();
  await inject('POST', `/sales/${sale.id}/items`, { type: 'part', inventoryPartId: partId, description: 'Item PDV', quantity, unitPrice });
  return sale.id as string;
}
const checkout = (saleId: string, payload: Record<string, unknown>) => inject('POST', `/sales/${saleId}/checkout`, payload);

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'POST', url: '/auth/operational-context', headers: { cookie }, payload: { companyId: companyAlpha, branchId: branchAlpha } });
  const [cash] = await admin<{ id: string }[]>`select id from payment_methods where code='cash'`;
  const [pix] = await admin<{ id: string }[]>`select id from payment_methods where code='pix'`;
  cashMethodId = cash!.id; pixMethodId = pix!.id;
});
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

describe('PDV-ADV-01 — POST /sales/:id/checkout', () => {
  it('venda simples à vista: confirma e paga em uma única chamada atômica, sem sobra', async () => {
    const partId = await makePart();
    const saleId = await makeDraftSale(partId, 2, 50);
    const sessionId = await registerAndOpen();
    const response = await checkout(saleId, { cashSessionId: sessionId, payments: [{ paymentMethodId: cashMethodId, amount: 100, idempotencyKey: `pdv-${randomUUID()}` }] });
    expect(response.statusCode).toBe(201);
    expect(response.json().sale).toMatchObject({ status: 'confirmed', total: '100.00' });
    expect(response.json().payments).toHaveLength(1);
    const detail = (await inject('GET', `/sales/${saleId}`)).json();
    expect(detail.status).toBe('confirmed');
  });

  it('múltiplas formas de pagamento cobrindo o total exatamente (dinheiro + PIX)', async () => {
    const partId = await makePart();
    const saleId = await makeDraftSale(partId, 1, 150);
    const sessionId = await registerAndOpen();
    const response = await checkout(saleId, {
      cashSessionId: sessionId,
      payments: [
        { paymentMethodId: cashMethodId, amount: 50, idempotencyKey: `pdv-${randomUUID()}` },
        { paymentMethodId: pixMethodId, amount: 100, idempotencyKey: `pdv-${randomUUID()}` },
      ],
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().payments).toHaveLength(2);
  });

  it('dinheiro com troco: o cliente envia só o valor que quita a venda (troco é calculado fora do lançamento), nunca inflando a receita', async () => {
    const partId = await makePart();
    const saleId = await makeDraftSale(partId, 1, '72.30' as unknown as number);
    const sessionId = await registerAndOpen();
    // Valor entregue pelo cliente: R$100 — troco de R$27,70 calculado no cliente, nunca enviado.
    const response = await checkout(saleId, { cashSessionId: sessionId, payments: [{ paymentMethodId: cashMethodId, amount: 72.3, idempotencyKey: `pdv-${randomUUID()}` }] });
    expect(response.statusCode).toBe(201);
    expect(response.json().payments[0].resulting_balance).toBe('72.30');
  });

  it('rejeita pagamento acima do total (não confunde troco com receita extra) — 409, nada é criado', async () => {
    const partId = await makePart();
    const saleId = await makeDraftSale(partId, 1, 50);
    const sessionId = await registerAndOpen();
    const response = await checkout(saleId, { cashSessionId: sessionId, payments: [{ paymentMethodId: cashMethodId, amount: 100, idempotencyKey: `pdv-${randomUUID()}` }] });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('payment_exceeds_total');
    expect((await inject('GET', `/sales/${saleId}`)).json().status).toBe('draft');
  });

  it('pagamento parcial: quita parte à vista, mantém saldo para recebível gerado depois (seção 26/27 — reaproveita FIN-ADV-01, não reimplementa)', async () => {
    const partId = await makePart();
    const saleId = await makeDraftSale(partId, 1, 1000);
    const sessionId = await registerAndOpen();
    const response = await checkout(saleId, { cashSessionId: sessionId, payments: [{ paymentMethodId: pixMethodId, amount: 300, idempotencyKey: `pdv-${randomUUID()}` }] });
    expect(response.statusCode).toBe(201);
    const generated = await inject('POST', '/receivables/generate', { saleId, installments: [{ amount: 700, dueDate: '2089-05-10' }] });
    expect(generated.statusCode).toBe(201);
    expect(generated.json().items[0].original_amount).toBe('700.00');
  });

  it('estoque insuficiente: nenhum pagamento é criado, a venda permanece draft (rollback integral)', async () => {
    const partId = await makePart(1);
    const saleId = await makeDraftSale(partId, 5, 10);
    const sessionId = await registerAndOpen();
    const response = await checkout(saleId, { cashSessionId: sessionId, payments: [{ paymentMethodId: cashMethodId, amount: 50, idempotencyKey: `pdv-${randomUUID()}` }] });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('insufficient_stock');
    const detail = (await inject('GET', `/sales/${saleId}`)).json();
    expect(detail.status).toBe('draft');
    const payments = (await inject('GET', `/payments?saleId=${saleId}`)).json();
    expect(payments.items).toHaveLength(0);
  });

  it('caixa fechado: sessão inexistente/de outra filial é rejeitada antes de confirmar (venda permanece draft)', async () => {
    const partId = await makePart();
    const saleId = await makeDraftSale(partId, 1, 50);
    const response = await checkout(saleId, { cashSessionId: randomUUID(), payments: [{ paymentMethodId: cashMethodId, amount: 50, idempotencyKey: `pdv-${randomUUID()}` }] });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('cash_session_not_found');
    expect((await inject('GET', `/sales/${saleId}`)).json().status).toBe('draft');
  });

  it('duplo clique/retry: repetir o checkout inteiro com as mesmas idempotencyKeys nunca duplica a baixa de estoque nem o pagamento', async () => {
    const partId = await makePart();
    const saleId = await makeDraftSale(partId, 1, 80);
    const sessionId = await registerAndOpen();
    const key = `pdv-${randomUUID()}`;
    const first = await checkout(saleId, { cashSessionId: sessionId, payments: [{ paymentMethodId: cashMethodId, amount: 80, idempotencyKey: key }] });
    const second = await checkout(saleId, { cashSessionId: sessionId, payments: [{ paymentMethodId: cashMethodId, amount: 80, idempotencyKey: key }] });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().sale.idempotent).toBe(true);
    expect(second.json().payments[0].idempotent).toBe(true);
    expect(second.json().payments[0].payment_id).toBe(first.json().payments[0].payment_id);
    const payments = (await inject('GET', `/payments?saleId=${saleId}`)).json();
    expect(payments.items).toHaveLength(1);
  });

  it('concorrência: duas finalizações disputando o mesmo saldo (1 disponível) — só uma confirma com baixa, a outra falha controladamente', async () => {
    const partId = await makePart(1);
    const saleA = await makeDraftSale(partId, 1, 20);
    const saleB = await makeDraftSale(partId, 1, 20);
    const sessionId = await registerAndOpen();
    const [resultA, resultB] = await Promise.all([
      checkout(saleA, { cashSessionId: sessionId, payments: [{ paymentMethodId: cashMethodId, amount: 20, idempotencyKey: `pdv-${randomUUID()}` }] }),
      checkout(saleB, { cashSessionId: sessionId, payments: [{ paymentMethodId: cashMethodId, amount: 20, idempotencyKey: `pdv-${randomUUID()}` }] }),
    ]);
    const statuses = [resultA.statusCode, resultB.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('venda já cancelada rejeita o checkout — 409, transição inválida', async () => {
    const partId = await makePart();
    const saleId = await makeDraftSale(partId, 1, 30);
    await inject('POST', `/sales/${saleId}/cancel`);
    const sessionId = await registerAndOpen();
    const response = await checkout(saleId, { cashSessionId: sessionId, payments: [{ paymentMethodId: cashMethodId, amount: 30, idempotencyKey: `pdv-${randomUUID()}` }] });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('invalid_status_transition');
  });

  it('venda de outro tenant -> 404 (isolamento), sem vazar existência', async () => {
    const betaSaleId = randomUUID();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', '01992ea1-1250-7000-8000-000000000020', true)`;
      await tx`insert into sales(id,tenant_id,company_id,branch_id,sale_number,customer_id) values(${betaSaleId},'01992ea1-1250-7000-8000-000000000020','01992ea1-1250-7000-8000-000000000022','01992ea1-1250-7000-8000-000000000023',${Math.floor(Math.random() * 1000000) + 5000000},'01992ea1-1250-7000-8000-000000000052')`;
    });
    const sessionId = await registerAndOpen();
    expect((await checkout(betaSaleId, { cashSessionId: sessionId, payments: [] })).statusCode).toBe(404);
  });

  // Mesmo padrão do resto da API (ex.: POST /sales): a forma do corpo é validada antes da
  // sessão — por isso o corpo aqui precisa ter o formato válido (cashSessionId é obrigatório
  // pelo schema), senão o 400 de payload chegaria antes do 401 e o teste provaria a coisa errada.
  it('sem sessão -> 401', async () => {
    expect((await app.inject({ method: 'POST', url: `/sales/${randomUUID()}/checkout`, payload: { cashSessionId: randomUUID(), payments: [] } })).statusCode).toBe(401);
  });

  it('RBAC negativo: nega checkout sem sales.confirm ou sem payments.create, preservando a venda draft', async () => {
    const partId = await makePart();
    const saleId = await makeDraftSale(partId, 1, 40);
    const sessionId = await registerAndOpen();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantAlpha}, true)`;
      await tx`delete from tenant_role_permissions where tenant_id=${tenantAlpha} and role_id=${singleRole} and permission_id in (select id from permissions where code in ('sales.confirm','payments.create'))`;
    });
    try {
      const response = await checkout(saleId, { cashSessionId: sessionId, payments: [{ paymentMethodId: cashMethodId, amount: 40, idempotencyKey: `pdv-${randomUUID()}` }] });
      expect(response.statusCode).toBe(403);
      expect((await inject('GET', `/sales/${saleId}`)).json().status).toBe('draft');
    } finally {
      await admin.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantAlpha}, true)`;
        await tx`insert into tenant_role_permissions(tenant_id,role_id,permission_id) select ${tenantAlpha},${singleRole},id from permissions where code in ('sales.confirm','payments.create') on conflict do nothing`;
      });
    }
  });

  it('rastreabilidade: o pagamento criado pelo checkout é encontrável por saleId e traz origem/caixa corretos', async () => {
    const partId = await makePart();
    const saleId = await makeDraftSale(partId, 1, 60);
    const sessionId = await registerAndOpen();
    await checkout(saleId, { cashSessionId: sessionId, payments: [{ paymentMethodId: cashMethodId, amount: 60, idempotencyKey: `pdv-${randomUUID()}` }] });
    const payments = (await inject('GET', `/payments?saleId=${saleId}`)).json().items;
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ sale_id: saleId, cash_session_id: sessionId, origin: 'sale', amount: '60.00' });
  });
});
