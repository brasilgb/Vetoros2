// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// FIN-04 — Contas Financeiras / Bancárias e Tesouraria. Ver executed.md "Descoberta"/"Decisões
// arquiteturais". Domínio PRÓPRIO (nunca reaproveita `cash_movements` — seção 2 do correio.md):
// `financial_accounts` representa onde o dinheiro está (banco), `financial_transactions` é o
// ledger append-only de tesouraria, `financial_transfers` é o cabeçalho de uma transferência
// atômica entre duas contas. Nenhuma integração automática com FIN-01/FIN-02/FIN-03 nesta rodada
// (seções 13/14/15) — só a fundação do domínio.
//
// Toda invariante crítica (append-only, no máximo um saldo de abertura, no máximo um estorno,
// atomicidade de transferência, idempotência, mesma empresa nas duas pontas) é garantida pelas
// funções `security definer` da migration 0025, nunca só por uma checagem antecipada aqui — esta
// camada só traduz os `errcode` dessas funções para respostas HTTP compreensíveis (mesmo padrão de
// cash/routes.ts, receivables/routes.ts, payables/routes.ts).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthService, AuthSession, ResourceScope } from '../auth/service.js';
import { requirePermission } from '../auth/service.js';

const id = z.string().uuid();
const params = z.object({ id });
type DatabaseError = { code?: string; cause?: { code?: string } };
const databaseError = (e: unknown): DatabaseError => (typeof e === 'object' && e !== null ? (e as DatabaseError) : {});
const dbCode = (e: unknown) => databaseError(e).code ?? databaseError(e).cause?.code;
const duplicate = (e: unknown) => dbCode(e) === '23505';

const accountCreate = z.object({
  name: z.string().trim().min(1).max(120),
  bankCode: z.string().trim().max(20).nullable().optional(), bankName: z.string().trim().max(120).nullable().optional(),
  branchNumber: z.string().trim().max(20).nullable().optional(), accountNumber: z.string().trim().max(30).nullable().optional(),
  accountDigit: z.string().trim().max(5).nullable().optional(), pixKey: z.string().trim().max(160).nullable().optional(),
}).strict();
const accountUpdate = accountCreate.partial().extend({ status: z.enum(['active', 'inactive']).optional() }).strict();
const accountList = z.object({ status: z.enum(['active', 'inactive']).optional(), q: z.string().trim().min(1).max(200).optional() }).strict();

const openingBalanceSchema = z.object({ amount: z.coerce.number().refine((n) => n !== 0, 'amount must not be zero'), idempotencyKey: z.string().trim().min(8).max(120) }).strict();
const transactionCreate = z.object({
  type: z.enum(['credit', 'debit']), amount: z.coerce.number().positive(),
  description: z.string().trim().min(1).max(300), reference: z.string().trim().max(200).nullable().optional(),
  occurredAt: z.string().trim().min(1).nullable().optional(), idempotencyKey: z.string().trim().min(8).max(120),
}).strict();
const transactionList = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(['credit', 'debit']).optional(), origin: z.enum(['opening_balance', 'manual', 'transfer', 'reversal']).optional(),
  from: z.string().trim().min(1).optional(), to: z.string().trim().min(1).optional(),
}).strict();
const reverseSchema = z.object({ reason: z.string().trim().max(1000).nullable().optional() }).strict();
const transferSchema = z.object({
  toFinancialAccountId: id, amount: z.coerce.number().positive(),
  description: z.string().trim().min(1).max(300), idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

// FIN-04 pertence à Company, não à Branch (seção 4/9 do correio.md — ver executed.md, decisão
// Tenant/Company/Branch): o escopo de permissão usa só `companyId`, nunca `branchId` — um grant
// `branch`-scoped de QUALQUER filial da empresa ativa também deve poder operar sobre uma conta que
// é, por definição, compartilhada entre filiais (omitir `branchId` do `ResourceScope` faz
// `hasPermission`, em auth/service.ts, aceitar qualquer grant `tenant`/`company`/`branch` cujo
// `company_id` bata — ver comentário lá). Diferente de cash/receivables/payables (verdadeiramente
// branch-scoped), que sempre passam os dois.
const scope = (s: AuthSession): ResourceScope => (s.activeCompanyId ? { companyId: s.activeCompanyId } : { requireTenant: true });

const balanceExpr = sql`coalesce((select sum(case when ft.type='credit' then ft.amount else -ft.amount end) from financial_transactions ft where ft.financial_account_id=fa.id),0)`;
const hasOpeningBalanceExpr = sql`exists (select 1 from financial_transactions ft where ft.financial_account_id=fa.id and ft.origin='opening_balance')`;

export function registerFinancialAccountRoutes(app: FastifyInstance, service: AuthService) {
  // Mesmo padrão de auth() das demais rotas financeiras (cash/receivables/payables): exige tenant+
  // company+branch completos, mesmo que o domínio em si não use `branch_id` — consistência de UX
  // (seção 25: "manter a UX consistente com o padrão já definido") e do próprio front, que já exige
  // os dois seletores preenchidos (`RequireOperationalContext`/`hasFullContext`) antes de mostrar
  // qualquer página do grupo Financeiro. Documentado como decisão deliberada no executed.md.
  async function auth(req: FastifyRequest, reply: FastifyReply) {
    const s = await service.session(req.cookies.vetoros_session);
    if (!s) { reply.code(401).send({ error: 'unauthorized' }); return; }
    if (!s.activeTenantId || !s.activeCompanyId || !s.activeBranchId) { reply.code(409).send({ error: 'operational_context_required' }); return; }
    return s;
  }
  async function allow(reply: FastifyReply, s: AuthSession, p: string) { try { await requirePermission(service, s, p, scope(s)); return true; } catch { reply.code(403).send({ error: 'forbidden' }); return false; } }

  // ---- Contas financeiras ----
  app.get('/financial-accounts', async (req, reply) => {
    const q = accountList.safeParse(req.query); if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'financial_accounts.read')) return;
    const term = q.data.q ? `%${q.data.q}%` : null;
    return service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      select fa.*, ${balanceExpr} as balance
      from financial_accounts fa
      where fa.company_id=${s.activeCompanyId!}
        and (${q.data.status ?? null}::text is null or fa.status=${q.data.status ?? null})
        and (${term}::text is null or fa.name ilike ${term} or fa.bank_name ilike ${term} or fa.account_number ilike ${term})
      order by fa.name`));
  });

  app.post('/financial-accounts', async (req, reply) => {
    const b = accountCreate.safeParse(req.body); if (!b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'financial_accounts.create')) return;
    try {
      const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
        insert into financial_accounts (tenant_id,company_id,name,bank_code,bank_name,branch_number,account_number,account_digit,pix_key,created_by_identity_id,updated_by_identity_id)
        values (${s.activeTenantId!},${s.activeCompanyId!},${b.data.name},${b.data.bankCode ?? null},${b.data.bankName ?? null},${b.data.branchNumber ?? null},${b.data.accountNumber ?? null},${b.data.accountDigit ?? null},${b.data.pixKey ?? null},${s.identityId},${s.identityId})
        returning *`));
      await service.auditResource(s, 'financial_account.created', 'financial_account', row!.id, { name: b.data.name, bankName: b.data.bankName ?? null });
      return reply.code(201).send({ ...row, balance: '0' });
    } catch (e) { if (duplicate(e)) return reply.code(409).send({ error: 'account_name_already_exists' }); throw e; }
  });

  app.get('/financial-accounts/:id', async (req, reply) => {
    const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'financial_accounts.read')) return;
    const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select fa.*, ${balanceExpr} as balance, ${hasOpeningBalanceExpr} as has_opening_balance from financial_accounts fa where fa.id=${p.data.id} and fa.company_id=${s.activeCompanyId!}`));
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.patch('/financial-accounts/:id', async (req, reply) => {
    const p = params.safeParse(req.params), b = accountUpdate.safeParse(req.body); if (!p.success || !b.success || !Object.keys(b.data).length) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'financial_accounts.update')) return;
    try {
      const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
        update financial_accounts set
          name=coalesce(${b.data.name ?? null},name),
          bank_code=case when ${'bankCode' in b.data} then ${b.data.bankCode ?? null} else bank_code end,
          bank_name=case when ${'bankName' in b.data} then ${b.data.bankName ?? null} else bank_name end,
          branch_number=case when ${'branchNumber' in b.data} then ${b.data.branchNumber ?? null} else branch_number end,
          account_number=case when ${'accountNumber' in b.data} then ${b.data.accountNumber ?? null} else account_number end,
          account_digit=case when ${'accountDigit' in b.data} then ${b.data.accountDigit ?? null} else account_digit end,
          pix_key=case when ${'pixKey' in b.data} then ${b.data.pixKey ?? null} else pix_key end,
          status=coalesce(${b.data.status ?? null},status),
          updated_by_identity_id=${s.identityId}, updated_at=now()
        where id=${p.data.id} and company_id=${s.activeCompanyId!} returning *`));
      if (!row) return reply.code(404).send({ error: 'not_found' });
      await service.auditResource(s, 'financial_account.updated', 'financial_account', p.data.id, { changedFields: Object.keys(b.data) });
      return { ...row, balance: String(await service.withAuthenticatedTenant(s, async (tx) => { const [r] = await tx.execute(sql`select ${balanceExpr} as balance from financial_accounts fa where fa.id=${p.data.id}`); return r!.balance; })) };
    } catch (e) { if (duplicate(e)) return reply.code(409).send({ error: 'account_name_already_exists' }); throw e; }
  });

  // ---- Saldo inicial (seção 12: movimentação, nunca coluna solta) ----
  app.post('/financial-accounts/:id/opening-balance', async (req, reply) => {
    const p = params.safeParse(req.params), b = openingBalanceSchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'financial_accounts.transact')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const account = await tx.execute(sql`select id from financial_accounts where id=${p.data.id} and company_id=${s.activeCompanyId!}`);
        if (!account.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from set_financial_account_opening_balance(${p.data.id},${b.data.amount},${b.data.idempotencyKey})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (!result.idempotent) await service.auditResource(s, 'financial_transaction.created', 'financial_account', p.data.id, { origin: 'opening_balance', amount: b.data.amount });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (e) {
      const code = dbCode(e);
      if (code === '23505') return reply.code(409).send({ error: 'idempotency_conflict_or_opening_balance_already_set' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_request' });
      if (code === 'P0002') return reply.code(404).send({ error: 'account_not_found_or_inactive' });
      throw e;
    }
  });

  // ---- Movimentações (ledger) ----
  app.get('/financial-accounts/:id/transactions', async (req, reply) => {
    const p = params.safeParse(req.params), q = transactionList.safeParse(req.query); if (!p.success || !q.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'financial_accounts.read')) return;
    const account = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select id from financial_accounts where id=${p.data.id} and company_id=${s.activeCompanyId!}`));
    if (!account.length) return reply.code(404).send({ error: 'not_found' });
    const offset = (q.data.page - 1) * q.data.pageSize;
    const rows = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      select ft.*, exists (select 1 from financial_transactions r where r.reverses_transaction_id=ft.id) as reversed,
        oa.name as counterparty_account_name,
        count(*) over()::int as total
      from financial_transactions ft
      left join financial_transfers tr on tr.id=ft.financial_transfer_id
      left join financial_accounts oa on oa.id=(case when ft.financial_account_id=tr.from_financial_account_id then tr.to_financial_account_id else tr.from_financial_account_id end)
      where ft.financial_account_id=${p.data.id}
        and (${q.data.type ?? null}::text is null or ft.type=${q.data.type ?? null})
        and (${q.data.origin ?? null}::text is null or ft.origin=${q.data.origin ?? null})
        and (${q.data.from ?? null}::timestamptz is null or ft.occurred_at>=${q.data.from ?? null})
        and (${q.data.to ?? null}::timestamptz is null or ft.occurred_at<(${q.data.to ?? null}::date + 1))
      order by ft.occurred_at desc, ft.id desc limit ${q.data.pageSize} offset ${offset}`));
    return { items: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'total'))), page: q.data.page, pageSize: q.data.pageSize, total: Number(rows[0]?.total ?? 0) };
  });

  app.post('/financial-accounts/:id/transactions', async (req, reply) => {
    const p = params.safeParse(req.params), b = transactionCreate.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'financial_accounts.transact')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const account = await tx.execute(sql`select id from financial_accounts where id=${p.data.id} and company_id=${s.activeCompanyId!}`);
        if (!account.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from record_financial_transaction(${p.data.id},${b.data.type},${b.data.amount},${b.data.description},${b.data.reference ?? null},${b.data.occurredAt ?? null},${b.data.idempotencyKey})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (!result.idempotent) await service.auditResource(s, 'financial_transaction.created', 'financial_account', p.data.id, { type: b.data.type, amount: b.data.amount, description: b.data.description });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (e) {
      const code = dbCode(e);
      if (code === '23505') return reply.code(409).send({ error: 'idempotency_conflict' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_request' });
      if (code === 'P0002') return reply.code(404).send({ error: 'account_not_found_or_inactive' });
      throw e;
    }
  });

  app.post('/financial-accounts/:id/transactions/:transactionId/reverse', async (req, reply) => {
    const p = z.object({ id, transactionId: id }).safeParse(req.params), b = reverseSchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'financial_accounts.reverse')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const transaction = await tx.execute(sql`select ft.id from financial_transactions ft join financial_accounts fa on fa.id=ft.financial_account_id where ft.id=${p.data.transactionId} and ft.financial_account_id=${p.data.id} and fa.company_id=${s.activeCompanyId!}`);
        if (!transaction.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from reverse_financial_transaction(${p.data.transactionId},${b.data.reason ?? null})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (!result.idempotent) await service.auditResource(s, 'financial_transaction.reversed', 'financial_account', p.data.id, { transactionId: p.data.transactionId, reason: b.data.reason ?? null });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (e) {
      const code = dbCode(e);
      if (code === '23505') return reply.code(409).send({ error: 'already_reversed' });
      if (code === '22023') return reply.code(400).send({ error: 'not_reversible_directly' });
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      throw e;
    }
  });

  // ---- Transferências ----
  app.post('/financial-accounts/:id/transfer', async (req, reply) => {
    const p = params.safeParse(req.params), b = transferSchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'financial_accounts.transfer')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const from = await tx.execute(sql`select id from financial_accounts where id=${p.data.id} and company_id=${s.activeCompanyId!}`);
        if (!from.length) return 'not_found';
        const to = await tx.execute(sql`select id from financial_accounts where id=${b.data.toFinancialAccountId} and company_id=${s.activeCompanyId!}`);
        if (!to.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from transfer_between_financial_accounts(${p.data.id},${b.data.toFinancialAccountId},${b.data.amount},${b.data.description},${b.data.idempotencyKey})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (!result.idempotent) await service.auditResource(s, 'financial_transfer.created', 'financial_transfer', result.transfer_id, { fromFinancialAccountId: p.data.id, toFinancialAccountId: b.data.toFinancialAccountId, amount: b.data.amount });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (e) {
      const code = dbCode(e);
      if (code === '23505') return reply.code(409).send({ error: 'idempotency_conflict' });
      if (code === '23514') return reply.code(409).send({ error: 'accounts_belong_to_different_companies' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_request' });
      if (code === 'P0002') return reply.code(404).send({ error: 'account_not_found_or_inactive' });
      throw e;
    }
  });

  app.post('/financial-transfers/:id/reverse', async (req, reply) => {
    const p = params.safeParse(req.params), b = reverseSchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'financial_accounts.reverse')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const transfer = await tx.execute(sql`
          select tr.id from financial_transfers tr
          join financial_accounts fa on fa.id=tr.from_financial_account_id
          where tr.id=${p.data.id} and fa.company_id=${s.activeCompanyId!}`);
        if (!transfer.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from reverse_financial_transfer(${p.data.id},${b.data.reason ?? null})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (!result.idempotent) await service.auditResource(s, 'financial_transfer.reversed', 'financial_transfer', p.data.id, { reason: b.data.reason ?? null });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (e) {
      const code = dbCode(e);
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      throw e;
    }
  });
}
