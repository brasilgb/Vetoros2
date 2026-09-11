// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// FIN-02 — Contas a Receber. Ver executed.md "Descoberta"/"Decisões arquiteturais". Continua
// diretamente FIN-01 (apps/api/src/cash/routes.ts): aquele registra o dinheiro que já entrou
// (`payments`); este registra a dívida com vencimento (`receivables`) e a ponte explícita entre
// os dois (`allocate`) — nunca implícita por coincidência de valor (seção 8 do correio.md).
//
// Toda invariante crítica (soma exata da entrada+parcelas, capacidade de alocação do pagamento,
// saldo do título, cancelamento com alocação ativa) é garantida pelas funções `security definer`
// da migration 0023, nunca só por uma checagem antecipada aqui — esta camada só traduz os
// `errcode` dessas funções para respostas HTTP compreensíveis (mesmo padrão de cash/routes.ts).
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

const installmentSchema = z.object({ amount: z.coerce.number().positive(), dueDate: z.string().trim().min(1) }).strict();
const generateSchema = z.object({
  saleId: id.nullable().optional(), serviceOrderId: id.nullable().optional(),
  installments: z.array(installmentSchema).min(1).max(60),
}).strict();
const allocateSchema = z.object({ paymentId: id, amount: z.coerce.number().positive(), idempotencyKey: z.string().trim().min(8).max(120) }).strict();
const cancelSchema = z.object({ reason: z.string().trim().max(1000).nullable().optional() }).strict();
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  customerId: id.optional(), saleId: id.optional(), serviceOrderId: id.optional(), origin: z.enum(['sale', 'service_order']).optional(),
  status: z.enum(['open', 'partial', 'paid', 'overdue', 'canceled']).optional(),
  from: z.string().trim().min(1).optional(), to: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).max(200).optional(),
}).strict();

const scope = (s: AuthSession): ResourceScope => (s.activeBranchId ? { companyId: s.activeCompanyId!, branchId: s.activeBranchId } : s.activeCompanyId ? { companyId: s.activeCompanyId } : { requireTenant: true });

// Nome de exibição de um `identities.id` — mesma técnica de cash/routes.ts (subquery escalar via
// `tenant_memberships`/`tenant_user_profiles`, já que `identities` vive fora do alcance de uma
// transação RLS-scoped). `columnRef` é sempre um literal estático deste arquivo, nunca entrada do
// usuário — seguro para `sql.raw`.
function identityNameSubquery(tenantId: string, columnRef: string) {
  return sql`(select tup.name from tenant_memberships tm join tenant_user_profiles tup on tup.tenant_id=tm.tenant_id and tup.membership_id=tm.id where tm.tenant_id=${tenantId} and tm.identity_id=${sql.raw(columnRef)} limit 1)`;
}

// Valor já apropriado a um título, EXCLUINDO alocações cujo pagamento tenha sido estornado
// (seção 7/9 do correio.md: saldo determinístico a partir de pagamentos e estornos, nunca um
// campo mutável). `refExpr` é o literal estático do alias da linha de `receivables` na query
// externa (`r`/`rr`), nunca entrada do usuário.
function paidAmountExpr(refExpr: string) {
  return sql`coalesce((select sum(ra.amount) from receivable_allocations ra where ra.receivable_id=${sql.raw(refExpr)}.id and not exists (select 1 from cash_movements cm where cm.payment_id=ra.payment_id and cm.type='refund')),0)`;
}
// Status derivado (seção 10): NUNCA persiste `overdue`/`partial`/`paid`/`open` — só `active`/
// `canceled` são reais na tabela; os demais são sempre calculados a partir do saldo e do
// vencimento, aqui e na hora de filtrar a listagem.
function derivedStatusExpr(refExpr: string) {
  const paid = paidAmountExpr(refExpr);
  return sql`case when ${sql.raw(refExpr)}.status='canceled' then 'canceled' when ${paid}>=${sql.raw(refExpr)}.original_amount then 'paid' when ${sql.raw(refExpr)}.due_date<current_date then 'overdue' when ${paid}>0 then 'partial' else 'open' end`;
}

export function registerReceivableRoutes(app: FastifyInstance, service: AuthService) {
  async function auth(req: FastifyRequest, reply: FastifyReply) {
    const s = await service.session(req.cookies.vetoros_session);
    if (!s) { reply.code(401).send({ error: 'unauthorized' }); return; }
    if (!s.activeTenantId || !s.activeCompanyId || !s.activeBranchId) { reply.code(409).send({ error: 'operational_context_required' }); return; }
    return s;
  }
  async function allow(reply: FastifyReply, s: AuthSession, p: string) { try { await requirePermission(service, s, p, scope(s)); return true; } catch { reply.code(403).send({ error: 'forbidden' }); return false; } }

  const originExpr = sql`case when r.sale_id is not null then 'sale' when r.service_order_id is not null then 'service_order' else null end`;

  app.get('/receivables', async (req, reply) => {
    const q = listSchema.safeParse(req.query); if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'receivables.read')) return;
    const offset = (q.data.page - 1) * q.data.pageSize, term = q.data.q ? `%${q.data.q}%` : null;
    const paid = paidAmountExpr('r'), status = derivedStatusExpr('r');
    const rows = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      select r.*, c.legal_name as customer_name, sa.sale_number, so.order_number as service_order_number,
        ${originExpr} as origin, ${paid} as paid_amount, (r.original_amount - ${paid}) as balance, ${status} as derived_status,
        count(*) over()::int as total
      from receivables r
      join customers c on c.id=r.customer_id
      left join sales sa on sa.id=r.sale_id
      left join service_orders so on so.id=r.service_order_id
      where r.branch_id=${s.activeBranchId!}
        and (${q.data.customerId ?? null}::uuid is null or r.customer_id=${q.data.customerId ?? null})
        and (${q.data.saleId ?? null}::uuid is null or r.sale_id=${q.data.saleId ?? null})
        and (${q.data.serviceOrderId ?? null}::uuid is null or r.service_order_id=${q.data.serviceOrderId ?? null})
        and (${q.data.origin ?? null}::text is null
          or (${q.data.origin ?? null}='sale' and r.sale_id is not null)
          or (${q.data.origin ?? null}='service_order' and r.service_order_id is not null))
        and (${q.data.from ?? null}::date is null or r.due_date>=${q.data.from ?? null})
        and (${q.data.to ?? null}::date is null or r.due_date<=${q.data.to ?? null})
        and (${q.data.status ?? null}::text is null or ${status}=${q.data.status ?? null})
        and (${term}::text is null or sa.sale_number::text ilike ${term} or so.order_number::text ilike ${term} or c.legal_name ilike ${term})
      order by r.due_date asc, r.installment_number asc limit ${q.data.pageSize} offset ${offset}`));
    return { items: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'total'))), page: q.data.page, pageSize: q.data.pageSize, total: Number(rows[0]?.total ?? 0) };
  });

  app.get('/receivables/:id', async (req, reply) => {
    const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'receivables.read')) return;
    const paid = paidAmountExpr('r'), status = derivedStatusExpr('r');
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      const [row] = await tx.execute(sql`
        select r.*, c.legal_name as customer_name, b.name as branch_name, sa.sale_number, so.order_number as service_order_number,
          ${originExpr} as origin, ${paid} as paid_amount, (r.original_amount - ${paid}) as balance, ${status} as derived_status
        from receivables r
        join customers c on c.id=r.customer_id
        join branches b on b.id=r.branch_id
        left join sales sa on sa.id=r.sale_id
        left join service_orders so on so.id=r.service_order_id
        where r.id=${p.data.id}`);
      if (!row) return null;
      const siblingsFilter = row.sale_id ? sql`sale_id=${row.sale_id}` : sql`service_order_id=${row.service_order_id}`;
      const siblings = await tx.execute(sql`select r.id,r.installment_number,r.installment_count,r.original_amount,r.due_date,${derivedStatusExpr('r')} as derived_status from receivables r where ${siblingsFilter} order by r.installment_number`);
      const allocations = await tx.execute(sql`
        select ra.id, ra.amount, ra.created_at, ra.payment_id, p.amount as payment_amount, p.created_at as payment_created_at, pm.name as payment_method_name,
          exists (select 1 from cash_movements cm where cm.payment_id=ra.payment_id and cm.type='refund') as payment_refunded,
          ${identityNameSubquery(s.activeTenantId!, 'ra.created_by_identity_id')} as created_by_name
        from receivable_allocations ra join payments p on p.id=ra.payment_id join payment_methods pm on pm.id=p.payment_method_id
        where ra.receivable_id=${p.data.id} order by ra.created_at desc`);
      return { ...row, siblings, allocations };
    });
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return result;
  });

  app.post('/receivables/generate', async (req, reply) => {
    const b = generateSchema.safeParse(req.body);
    if (!b.success || (b.data.saleId && b.data.serviceOrderId) || (!b.data.saleId && !b.data.serviceOrderId)) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'receivables.create')) return;
    try {
      const installmentsJson = JSON.stringify(b.data.installments.map((i) => ({ amount: i.amount, dueDate: i.dueDate })));
      const rows = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select * from generate_receivables(${b.data.saleId ?? null},${b.data.serviceOrderId ?? null},${installmentsJson}::jsonb)`));
      const idempotent = Boolean(rows[0]?.idempotent);
      if (!idempotent) {
        for (const row of rows) await service.auditResource(s, 'receivable.generated', 'receivable', row.id, { saleId: b.data.saleId, serviceOrderId: b.data.serviceOrderId, installmentNumber: row.installment_number, installmentCount: row.installment_count, originalAmount: row.original_amount, dueDate: row.due_date });
      }
      return reply.code(idempotent ? 200 : 201).send({ items: rows });
    } catch (e) {
      const code = dbCode(e);
      if (code === '23503') return reply.code(404).send({ error: 'invalid_origin' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_installments' });
      if (code === '23505') return reply.code(409).send({ error: 'idempotency_conflict' });
      throw e;
    }
  });

  app.post('/receivables/:id/cancel', async (req, reply) => {
    const p = params.safeParse(req.params), b = cancelSchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'receivables.cancel')) return;
    try {
      const [row] = await service.withAuthenticatedTenant(s, async (tx) => {
        const exists = await tx.execute(sql`select id from receivables where id=${p.data.id} and branch_id=${s.activeBranchId!}`);
        if (!exists.length) return [];
        return tx.execute(sql`select * from cancel_receivable(${p.data.id},${b.data.reason ?? null})`);
      });
      if (!row) return reply.code(404).send({ error: 'not_found' });
      if (!row.idempotent) await service.auditResource(s, 'receivable.canceled', 'receivable', p.data.id, { reason: b.data.reason ?? null });
      return row;
    } catch (e) {
      const code = dbCode(e);
      if (code === '23514') return reply.code(409).send({ error: 'receivable_has_allocations' });
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      throw e;
    }
  });

  app.post('/receivables/:id/allocate', async (req, reply) => {
    const p = params.safeParse(req.params), b = allocateSchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'receivables.allocate')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const receivable = await tx.execute(sql`select id from receivables where id=${p.data.id} and branch_id=${s.activeBranchId!}`);
        if (!receivable.length) return 'not_found';
        const payment = await tx.execute(sql`select id from payments where id=${b.data.paymentId} and branch_id=${s.activeBranchId!}`);
        if (!payment.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from allocate_payment(${b.data.paymentId},${p.data.id},${b.data.amount},${b.data.idempotencyKey})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (!result.idempotent) await service.auditResource(s, 'receivable.allocated', 'receivable', p.data.id, { paymentId: b.data.paymentId, amount: b.data.amount });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (e) {
      const code = dbCode(e);
      if (code === '55000') return reply.code(409).send({ error: 'payment_or_receivable_not_active' });
      if (code === '23503') return reply.code(409).send({ error: 'origin_mismatch' });
      if (code === '23514') return reply.code(409).send({ error: 'insufficient_capacity' });
      if (code === '23505') return reply.code(409).send({ error: 'idempotency_conflict' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_request' });
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      throw e;
    }
  });
}
