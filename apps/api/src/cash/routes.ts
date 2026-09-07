// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// FIN-01 — Caixa e Recebimentos. Ver executed.md "Descoberta"/"Decisões arquiteturais".
//
// Toda regra crítica de concorrência (abertura duplicada, recebimento duplicado por
// retry/duplo-clique, estorno duplicado) é garantida pelas funções `security definer` da
// migration 0022 (constraint/lock de banco), nunca só por uma checagem antecipada aqui — esta
// camada só traduz os `errcode` dessas funções para respostas HTTP compreensíveis (mesmo padrão
// de sales.ts/service-orders.ts). O escopo de filial (registrador pertence à filial ativa,
// sessão pertence à filial ativa) é reforçado aqui como uma camada extra de precisão — mesma
// técnica de `inventory/movements` (`branch !== s.activeBranchId` -> 404) — o RLS por tenant já é
// a fronteira de segurança real.
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

const registerCreate = z.object({ name: z.string().trim().min(1).max(120) }).strict();
const registerUpdate = z.object({ name: z.string().trim().min(1).max(120).optional(), status: z.enum(['active', 'inactive']).optional() }).strict();
const registerList = z.object({ status: z.enum(['active', 'inactive']).optional() }).strict();

const openSchema = z.object({ cashRegisterId: id, openingAmount: z.coerce.number().min(0) }).strict();
const closeSchema = z.object({ closingAmountInformed: z.coerce.number().min(0), justification: z.string().trim().max(2000).nullable().optional() }).strict();
const sessionList = z.object({
  cashRegisterId: id.optional(), sessionReference: id.optional(), status: z.enum(['open', 'closed']).optional(), operatorId: id.optional(),
  openedFrom: z.string().trim().min(1).optional(), openedTo: z.string().trim().min(1).optional(),
  closedFrom: z.string().trim().min(1).optional(), closedTo: z.string().trim().min(1).optional(),
  divergence: z.enum(['with', 'without']).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const movementList = z.object({
  operatorId: id.optional(), type: z.enum(['opening', 'receipt', 'refund', 'supply', 'withdrawal']).optional(),
  from: z.string().trim().min(1).optional(), to: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const adjustmentSchema = z.object({ type: z.enum(['supply', 'withdrawal']), amount: z.coerce.number().positive(), reason: z.string().trim().min(1).max(1000) }).strict();

const paymentCreate = z.object({
  cashSessionId: id,
  amount: z.coerce.number().positive(),
  paymentMethodId: id,
  saleId: id.nullable().optional(),
  serviceOrderId: id.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();
const refundSchema = z.object({ cashSessionId: id, reason: z.string().trim().max(1000).nullable().optional() }).strict();
const paymentList = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  from: z.string().trim().min(1).optional(), to: z.string().trim().min(1).optional(),
  paymentMethodId: id.optional(), origin: z.enum(['sale', 'service_order', 'none']).optional(), status: z.enum(['active', 'refunded']).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  // FIN-02: filtro adicional (aditivo, não muda o comportamento existente quando ausente) — a
  // tela de alocação de Contas a Receber precisa listar só os recebimentos da MESMA origem do
  // título, não "toda venda" via `origin=sale`.
  saleId: id.optional(), serviceOrderId: id.optional(),
}).strict();

const scope = (s: AuthSession): ResourceScope => (s.activeBranchId ? { companyId: s.activeCompanyId!, branchId: s.activeBranchId } : s.activeCompanyId ? { companyId: s.activeCompanyId } : { requireTenant: true });

// Resolve nome de exibição de um `identities.id` (responsável pela abertura/fechamento/
// movimentação, operador do recebimento — seções 16/17 do correio.md pedem essas colunas).
// `identities` vive na conexão vetoros_auth, fora do alcance de uma transação RLS-scoped (mesmo
// problema que ADM-01/ADM-03 resolveram com `service.identitiesByIds`) — mas dentro do tenant já
// existe um caminho tenant-scoped equivalente: `tenant_memberships.identity_id` ->
// `tenant_user_profiles.membership_id` -> `.name`. Uma subquery escalar evita N+1 chamadas
// cross-connection e não colide de alias quando a mesma query precisa resolver mais de um
// identity_id (aberto/fechado) ao mesmo tempo. `columnRef` é sempre um literal estático escrito
// por este arquivo, nunca entrada do usuário — seguro para `sql.raw`.
function identityNameSubquery(tenantId: string, columnRef: string) {
  return sql`(select tup.name from tenant_memberships tm join tenant_user_profiles tup on tup.tenant_id=tm.tenant_id and tup.membership_id=tm.id where tm.tenant_id=${tenantId} and tm.identity_id=${sql.raw(columnRef)} limit 1)`;
}

export function registerCashRoutes(app: FastifyInstance, service: AuthService) {
  async function auth(req: FastifyRequest, reply: FastifyReply) {
    const s = await service.session(req.cookies.vetoros_session);
    if (!s) { reply.code(401).send({ error: 'unauthorized' }); return; }
    if (!s.activeTenantId || !s.activeCompanyId || !s.activeBranchId) { reply.code(409).send({ error: 'operational_context_required' }); return; }
    return s;
  }
  async function allow(reply: FastifyReply, s: AuthSession, p: string) { try { await requirePermission(service, s, p, scope(s)); return true; } catch { reply.code(403).send({ error: 'forbidden' }); return false; } }

  // ---- Formas de pagamento (catálogo global, só leitura aqui) ----
  app.get('/payment-methods', async (req, reply) => {
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'payments.read')) return;
    return service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select id,code,name,status from payment_methods where status='active' order by name`));
  });

  // ---- Caixas ----
  app.get('/cash-registers', async (req, reply) => {
    const q = registerList.safeParse(req.query); if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'cash.read')) return;
    // sessão aberta atual embutida via LEFT JOIN LATERAL — uma única chamada alimenta a tela de
    // Caixa inteira (quais caixas existem + qual está aberto agora + saldo esperado de cada um).
    return service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      select r.*, cs.id as current_session_id, cs.opened_at as current_session_opened_at, cs.opening_amount as current_session_opening_amount,
        cs.opened_by_identity_id as current_session_opened_by_identity_id, ${identityNameSubquery(s.activeTenantId!, 'cs.opened_by_identity_id')} as current_session_opened_by_name,
        coalesce((select cm.resulting_balance from cash_movements cm where cm.cash_session_id=cs.id order by cm.created_at desc, cm.id desc limit 1), cs.opening_amount) as current_session_expected_balance
      from cash_registers r
      left join cash_sessions cs on cs.cash_register_id=r.id and cs.status='open'
      where r.branch_id=${s.activeBranchId!} and (${q.data.status ?? null}::text is null or r.status=${q.data.status ?? null})
      order by r.name`));
  });
  app.post('/cash-registers', async (req, reply) => {
    const b = registerCreate.safeParse(req.body); if (!b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'cash.manage')) return;
    try {
      const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`insert into cash_registers (tenant_id,company_id,branch_id,name) values (${s.activeTenantId!},${s.activeCompanyId!},${s.activeBranchId!},${b.data.name}) returning *`));
      await service.auditResource(s, 'cash_register.created', 'cash_register', row!.id);
      return reply.code(201).send(row);
    } catch (e) { if (duplicate(e)) return reply.code(409).send({ error: 'register_name_already_exists' }); throw e; }
  });
  app.patch('/cash-registers/:id', async (req, reply) => {
    const p = params.safeParse(req.params), b = registerUpdate.safeParse(req.body); if (!p.success || !b.success || !Object.keys(b.data).length) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'cash.manage')) return;
    try {
      const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`update cash_registers set name=coalesce(${b.data.name ?? null},name),status=coalesce(${b.data.status ?? null},status),updated_at=now() where id=${p.data.id} and branch_id=${s.activeBranchId!} returning *`));
      if (!row) return reply.code(404).send({ error: 'not_found' });
      await service.auditResource(s, 'cash_register.updated', 'cash_register', p.data.id, { status: b.data.status });
      return row;
    } catch (e) { if (duplicate(e)) return reply.code(409).send({ error: 'register_name_already_exists' }); throw e; }
  });

  // ---- Sessões de caixa ----
  app.get('/cash-sessions', async (req, reply) => {
    const q = sessionList.safeParse(req.query); if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'cash.read')) return;
    const offset = (q.data.page - 1) * q.data.pageSize;
    const rows = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      select cs.*,case when cs.status='closed' then cs.closing_amount_informed-cs.expected_amount_at_close end as difference,
        (cs.closing_justification is not null and length(trim(cs.closing_justification))>0) as has_justification,
        r.name as register_name,c.legal_name as company_legal_name,c.trade_name as company_trade_name,b.code as branch_code,b.name as branch_name,
        totals.receipts,totals.refunds,totals.supplies,totals.withdrawals,totals.total_entries,totals.total_exits,totals.movement_count,
        case when cs.status='closed' then cs.expected_amount_at_close else coalesce(totals.current_balance,cs.opening_amount) end as expected_amount,
        ${identityNameSubquery(s.activeTenantId!, 'cs.opened_by_identity_id')} as opened_by_name,
        ${identityNameSubquery(s.activeTenantId!, 'cs.closed_by_identity_id')} as closed_by_name, count(*) over()::int as total
      from cash_sessions cs join cash_registers r on r.id=cs.cash_register_id
      join companies c on c.id=cs.company_id join branches b on b.id=cs.branch_id
      left join lateral (select
        coalesce(sum(cm.amount) filter (where cm.type='receipt'),0) as receipts,
        coalesce(sum(cm.amount) filter (where cm.type='refund'),0) as refunds,
        coalesce(sum(cm.amount) filter (where cm.type='supply'),0) as supplies,
        coalesce(sum(cm.amount) filter (where cm.type='withdrawal'),0) as withdrawals,
        coalesce(sum(cm.amount) filter (where cm.type in ('receipt','supply')),0) as total_entries,
        coalesce(sum(cm.amount) filter (where cm.type in ('refund','withdrawal')),0) as total_exits,
        count(*)::int as movement_count,
        (array_agg(cm.resulting_balance order by cm.created_at desc,cm.id desc))[1] as current_balance
        from cash_movements cm where cm.cash_session_id=cs.id) totals on true
      where cs.branch_id=${s.activeBranchId!} and (${q.data.cashRegisterId ?? null}::uuid is null or cs.cash_register_id=${q.data.cashRegisterId ?? null})
        and (${q.data.sessionReference ?? null}::uuid is null or cs.id=${q.data.sessionReference ?? null})
        and (${q.data.status ?? null}::text is null or cs.status=${q.data.status ?? null})
        and (${q.data.operatorId ?? null}::uuid is null or cs.opened_by_identity_id=${q.data.operatorId ?? null} or cs.closed_by_identity_id=${q.data.operatorId ?? null})
        and (${q.data.openedFrom ?? null}::timestamptz is null or cs.opened_at>=${q.data.openedFrom ?? null})
        and (${q.data.openedTo ?? null}::timestamptz is null or cs.opened_at<(${q.data.openedTo ?? null}::date + 1))
        and (${q.data.closedFrom ?? null}::timestamptz is null or cs.closed_at>=${q.data.closedFrom ?? null})
        and (${q.data.closedTo ?? null}::timestamptz is null or cs.closed_at<(${q.data.closedTo ?? null}::date + 1))
        and (${q.data.divergence ?? null}::text is null
          or (${q.data.divergence ?? null}='with' and cs.status='closed' and cs.closing_amount_informed<>cs.expected_amount_at_close)
          or (${q.data.divergence ?? null}='without' and cs.status='closed' and cs.closing_amount_informed=cs.expected_amount_at_close))
      order by cs.opened_at desc limit ${q.data.pageSize} offset ${offset}`));
    return { items: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'total'))), page: q.data.page, pageSize: q.data.pageSize, total: Number(rows[0]?.total ?? 0) };
  });
  app.get('/cash-sessions/current', async (req, reply) => {
    const q = z.object({ cashRegisterId: id }).strict().safeParse(req.query); if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'cash.read')) return;
    const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      select cs.*, ${identityNameSubquery(s.activeTenantId!, 'cs.opened_by_identity_id')} as opened_by_name,
        coalesce((select cm.resulting_balance from cash_movements cm where cm.cash_session_id=cs.id order by cm.created_at desc, cm.id desc limit 1), cs.opening_amount) as expected_balance
      from cash_sessions cs join cash_registers r on r.id=cs.cash_register_id
      where cs.cash_register_id=${q.data.cashRegisterId} and cs.status='open' and r.branch_id=${s.activeBranchId!}`));
    return row ?? null;
  });
  app.get('/cash-session-indicators', async (req, reply) => {
    const q = z.object({ cashRegisterId: id.optional(), from: z.string().trim().min(1).optional(), to: z.string().trim().min(1).optional() }).strict().safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'cash.read')) return;
    const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select
      count(*)::int as closed_sessions,
      count(*) filter (where closing_amount_informed<>expected_amount_at_close)::int as divergent_sessions,
      coalesce(sum(abs(closing_amount_informed-expected_amount_at_close)),0) as absolute_difference,
      coalesce(sum(closing_amount_informed-expected_amount_at_close),0) as net_difference,
      coalesce(max(abs(closing_amount_informed-expected_amount_at_close)),0) as largest_difference
      from cash_sessions where branch_id=${s.activeBranchId!} and status='closed'
        and (${q.data.cashRegisterId ?? null}::uuid is null or cash_register_id=${q.data.cashRegisterId ?? null})
        and (${q.data.from ?? null}::timestamptz is null or closed_at>=${q.data.from ?? null})
        and (${q.data.to ?? null}::timestamptz is null or closed_at<(${q.data.to ?? null}::date + 1))`));
    return row;
  });
  app.get('/cash-sessions/:id/movements', async (req, reply) => {
    const p = params.safeParse(req.params), q = movementList.safeParse(req.query); if (!p.success || !q.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'cash.read')) return;
    const offset = (q.data.page - 1) * q.data.pageSize;
    const session = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select id from cash_sessions where id=${p.data.id} and branch_id=${s.activeBranchId!}`));
    if (!session.length) return reply.code(404).send({ error: 'not_found' });
    const rows = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select m.*,pm.name as payment_method_name,${identityNameSubquery(s.activeTenantId!, 'm.actor_identity_id')} as actor_name,count(*) over()::int as total from cash_movements m left join payments pay on pay.id=m.payment_id left join payment_methods pm on pm.id=pay.payment_method_id where m.cash_session_id=${p.data.id}
      and (${q.data.operatorId ?? null}::uuid is null or m.actor_identity_id=${q.data.operatorId ?? null})
      and (${q.data.type ?? null}::text is null or m.type=${q.data.type ?? null})
      and (${q.data.from ?? null}::timestamptz is null or m.created_at>=${q.data.from ?? null})
      and (${q.data.to ?? null}::timestamptz is null or m.created_at<(${q.data.to ?? null}::date + 1))
      order by m.created_at desc, m.id desc limit ${q.data.pageSize} offset ${offset}`));
    return { items: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'total'))), page: q.data.page, pageSize: q.data.pageSize, total: Number(rows[0]?.total ?? 0) };
  });
  app.get('/cash-sessions/:id', async (req, reply) => {
    const p = params.safeParse(req.params), q = z.object({ includeMovements: z.enum(['true']).optional() }).strict().safeParse(req.query);
    if (!p.success || !q.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'cash.read')) return;
    const [session] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      select cs.*,r.name as register_name,c.legal_name as company_legal_name,c.trade_name as company_trade_name,
        c.tax_id_type as company_tax_id_type,c.tax_id_normalized as company_tax_id_normalized,
        b.code as branch_code,b.name as branch_name,b.timezone as branch_timezone,
        ${identityNameSubquery(s.activeTenantId!, 'cs.opened_by_identity_id')} as opened_by_name,
        ${identityNameSubquery(s.activeTenantId!, 'cs.closed_by_identity_id')} as closed_by_name
      from cash_sessions cs join cash_registers r on r.id=cs.cash_register_id
      join companies c on c.id=cs.company_id join branches b on b.id=cs.branch_id
      where cs.id=${p.data.id} and cs.branch_id=${s.activeBranchId!}`));
    if (!session) return reply.code(404).send({ error: 'not_found' });
    const [totals, paymentMethods] = await service.withAuthenticatedTenant(s, async (tx) => Promise.all([
      tx.execute(sql`select
        coalesce(sum(amount) filter (where type='receipt'),0) as receipts,
        coalesce(sum(amount) filter (where type='refund'),0) as refunds,
        coalesce(sum(amount) filter (where type='supply'),0) as supplies,
        coalesce(sum(amount) filter (where type='withdrawal'),0) as withdrawals,
        coalesce(sum(amount) filter (where type in ('receipt','supply')),0) as total_entries,
        coalesce(sum(amount) filter (where type in ('refund','withdrawal')),0) as total_exits,
        count(*)::int as movement_count,
        coalesce((array_agg(resulting_balance order by created_at desc,id desc))[1],${session.opening_amount}) as expected_amount
        from cash_movements where cash_session_id=${p.data.id}`),
      tx.execute(sql`select pm.id,pm.code,pm.name,
        coalesce(sum(case when m.type='receipt' then m.amount when m.type='refund' then -m.amount else 0 end),0) as net_amount,
        coalesce(sum(m.amount) filter (where m.type='receipt'),0) as received_amount,
        coalesce(sum(m.amount) filter (where m.type='refund'),0) as refunded_amount
        from cash_movements m join payments pay on pay.id=m.payment_id join payment_methods pm on pm.id=pay.payment_method_id
        where m.cash_session_id=${p.data.id} and m.type in ('receipt','refund')
        group by pm.id,pm.code,pm.name order by pm.name`),
    ]));
    const summary = totals[0]!;
    const movements = q.data.includeMovements ? await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      select m.id,m.type,m.amount,m.resulting_balance,m.reason,m.created_at,pm.code as payment_method_code,
        pm.name as payment_method_name,${identityNameSubquery(s.activeTenantId!, 'm.actor_identity_id')} as actor_name
      from cash_movements m left join payments pay on pay.id=m.payment_id left join payment_methods pm on pm.id=pay.payment_method_id
      where m.cash_session_id=${p.data.id} order by m.created_at,m.id`)) : undefined;
    return { ...session, summary: { ...summary, counted_amount: session.closing_amount_informed, difference: session.status === 'closed' ? Number(session.closing_amount_informed) - Number(session.expected_amount_at_close) : null }, payment_methods: paymentMethods, ...(movements ? { movements } : {}) };
  });
  app.post('/cash-sessions/:id/movements', async (req, reply) => {
    const p = params.safeParse(req.params), b = adjustmentSchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'cash.manage')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const found = await tx.execute(sql`select id from cash_sessions where id=${p.data.id} and branch_id=${s.activeBranchId!}`);
        if (!found.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from record_cash_adjustment(${p.data.id},${b.data.type},${b.data.amount},${b.data.reason})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      await service.auditResource(s, `cash_movement.${b.data.type}`, 'cash_session', p.data.id, { amount: b.data.amount, reason: b.data.reason });
      return reply.code(201).send(result);
    } catch (e) {
      const code = dbCode(e);
      if (code === '55000') return reply.code(409).send({ error: 'session_not_open' });
      if (code === '23514') return reply.code(409).send({ error: 'insufficient_cash_balance' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_request' });
      throw e;
    }
  });
  app.post('/cash-sessions/open', async (req, reply) => {
    const b = openSchema.safeParse(req.body); if (!b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'cash.open')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const register = await tx.execute(sql`select id from cash_registers where id=${b.data.cashRegisterId} and branch_id=${s.activeBranchId!}`);
        if (!register.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from open_cash_session(${b.data.cashRegisterId},${b.data.openingAmount})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      await service.auditResource(s, 'cash_session.opened', 'cash_session', result.session_id, { cashRegisterId: b.data.cashRegisterId, openingAmount: b.data.openingAmount });
      return reply.code(201).send(result);
    } catch (e) {
      const code = dbCode(e);
      if (code === '23505') return reply.code(409).send({ error: 'register_already_open' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_request' });
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      throw e;
    }
  });
  app.post('/cash-sessions/:id/close', async (req, reply) => {
    const p = params.safeParse(req.params), b = closeSchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'cash.close')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const session = await tx.execute(sql`select id from cash_sessions where id=${p.data.id} and branch_id=${s.activeBranchId!}`);
        if (!session.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from close_cash_session(${p.data.id},${b.data.closingAmountInformed},${b.data.justification ?? null})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      await service.auditResource(s, 'cash_session.closed', 'cash_session', p.data.id, { closingAmountInformed: b.data.closingAmountInformed, difference: result.difference, justification: result.closing_justification });
      return result;
    } catch (e) {
      const code = dbCode(e);
      if (code === '55000') return reply.code(409).send({ error: 'session_not_open' });
      if (code === '23514') return reply.code(409).send({ error: 'closing_justification_required' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_request' });
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      throw e;
    }
  });

  // ---- Recebimentos ----
  const originExpr = sql`case when p.sale_id is not null then 'sale' when p.service_order_id is not null then 'service_order' else 'none' end`;
  const refundedExpr = sql`exists (select 1 from cash_movements rm where rm.payment_id=p.id and rm.type='refund')`;
  app.get('/payments', async (req, reply) => {
    const q = paymentList.safeParse(req.query); if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'payments.read')) return;
    const offset = (q.data.page - 1) * q.data.pageSize, term = q.data.q ? `%${q.data.q}%` : null;
    const rows = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      select p.*, pm.name as payment_method_name, sa.sale_number, so.order_number as service_order_number,
        coalesce(cu.legal_name, cuo.legal_name) as customer_name, ${originExpr} as origin, ${refundedExpr} as refunded,
        ${identityNameSubquery(s.activeTenantId!, 'p.created_by_identity_id')} as created_by_name, count(*) over()::int as total
      from payments p
      join payment_methods pm on pm.id=p.payment_method_id
      left join sales sa on sa.id=p.sale_id
      left join customers cu on cu.id=sa.customer_id
      left join service_orders so on so.id=p.service_order_id
      left join customers cuo on cuo.id=so.customer_id
      where p.branch_id=${s.activeBranchId!}
        and (${q.data.from ?? null}::timestamptz is null or p.created_at>=${q.data.from ?? null})
        and (${q.data.to ?? null}::timestamptz is null or p.created_at<(${q.data.to ?? null}::date + 1))
        and (${q.data.paymentMethodId ?? null}::uuid is null or p.payment_method_id=${q.data.paymentMethodId ?? null})
        and (${q.data.saleId ?? null}::uuid is null or p.sale_id=${q.data.saleId ?? null})
        and (${q.data.serviceOrderId ?? null}::uuid is null or p.service_order_id=${q.data.serviceOrderId ?? null})
        and (${q.data.origin ?? null}::text is null
          or (${q.data.origin ?? null}='sale' and p.sale_id is not null)
          or (${q.data.origin ?? null}='service_order' and p.service_order_id is not null)
          or (${q.data.origin ?? null}='none' and p.sale_id is null and p.service_order_id is null))
        and (${q.data.status ?? null}::text is null
          or (${q.data.status ?? null}='refunded' and ${refundedExpr})
          or (${q.data.status ?? null}='active' and not (${refundedExpr})))
        and (${term}::text is null or sa.sale_number::text ilike ${term} or so.order_number::text ilike ${term} or coalesce(cu.legal_name,cuo.legal_name) ilike ${term} or p.notes ilike ${term})
      order by p.created_at desc limit ${q.data.pageSize} offset ${offset}`));
    return { items: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'total'))), page: q.data.page, pageSize: q.data.pageSize, total: Number(rows[0]?.total ?? 0) };
  });
  app.get('/payments/:id', async (req, reply) => {
    const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'payments.read')) return;
    const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      select p.*, pm.name as payment_method_name, sa.sale_number, so.order_number as service_order_number,
        coalesce(cu.legal_name, cuo.legal_name) as customer_name, ${originExpr} as origin, ${refundedExpr} as refunded,
        ${identityNameSubquery(s.activeTenantId!, 'p.created_by_identity_id')} as created_by_name
      from payments p
      join payment_methods pm on pm.id=p.payment_method_id
      left join sales sa on sa.id=p.sale_id
      left join customers cu on cu.id=sa.customer_id
      left join service_orders so on so.id=p.service_order_id
      left join customers cuo on cuo.id=so.customer_id
      where p.id=${p.data.id}`));
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });
  app.post('/payments', async (req, reply) => {
    const b = paymentCreate.safeParse(req.body); if (!b.success || (b.data.saleId && b.data.serviceOrderId)) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'payments.create')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const session = await tx.execute(sql`select id from cash_sessions where id=${b.data.cashSessionId} and branch_id=${s.activeBranchId!}`);
        if (!session.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from receive_payment(${b.data.cashSessionId},${b.data.amount},${b.data.paymentMethodId},${b.data.saleId ?? null},${b.data.serviceOrderId ?? null},${b.data.notes ?? null},${b.data.idempotencyKey})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      await service.auditResource(s, 'payment.created', 'payment', result.payment_id, { amount: b.data.amount, paymentMethodId: b.data.paymentMethodId, saleId: b.data.saleId, serviceOrderId: b.data.serviceOrderId, idempotent: result.idempotent });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (e) {
      const code = dbCode(e);
      if (code === '55000') return reply.code(409).send({ error: 'session_not_open' });
      if (code === '23503') return reply.code(404).send({ error: 'invalid_origin_or_payment_method' });
      if (code === '23505') return reply.code(409).send({ error: 'idempotency_conflict' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_request' });
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      throw e;
    }
  });
  app.post('/payments/:id/refund', async (req, reply) => {
    const p = params.safeParse(req.params), b = refundSchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'payments.refund')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        // Serialize refunds for the same immutable receipt without granting UPDATE on the
        // append-only payments table. This is deliberately a separate SQL statement: after a
        // concurrent transaction commits, the following statements receive a fresh READ
        // COMMITTED snapshot and can replay the refund.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${p.data.id}::text, 0))`);
        const payment = await tx.execute(sql`select id from payments where id=${p.data.id} and branch_id=${s.activeBranchId!}`);
        if (!payment.length) return 'not_found';
        const session = await tx.execute(sql`select id from cash_sessions where id=${b.data.cashSessionId} and branch_id=${s.activeBranchId!}`);
        if (!session.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from refund_payment(${p.data.id},${b.data.cashSessionId},${b.data.reason ?? null})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      await service.auditResource(s, 'payment.refunded', 'payment', p.data.id, { cashSessionId: b.data.cashSessionId, idempotent: result.idempotent });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (e) {
      const code = dbCode(e);
      if (code === '55000') return reply.code(409).send({ error: 'session_not_open' });
      if (code === '23514') return reply.code(409).send({ error: 'insufficient_session_balance' });
      if (code === '23505') return reply.code(409).send({ error: 'refund_already_applied' });
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      throw e;
    }
  });
}
