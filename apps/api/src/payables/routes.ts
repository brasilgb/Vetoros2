// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// FIN-03 — Contas a Pagar. Ver executed.md "Descoberta"/"Decisões arquiteturais". Espelha FIN-02
// (Recebíveis) na filosofia geral — status administrativo mínimo (`active`/`canceled`), o resto
// sempre derivado; origem via FK real nullable, nunca polimórfica; nenhuma escrita direta nas
// tabelas, sempre por função `security definer` — mas com duas diferenças estruturais reais: 1)
// título (`payables`) e parcela (`payable_installments`) são tabelas separadas aqui; 2) o
// pagamento (`payable_payments`) é o próprio ledger append-only deste domínio — não há vínculo
// com Caixa (FIN-01) nesta rodada (seção 11 do correio.md).
//
// Toda invariante crítica (soma exata contra o pedido de compra, saldo da parcela, duplo estorno,
// cancelamento com pagamento ativo) é garantida pelas funções da migration 0024, nunca só por uma
// checagem antecipada aqui — esta camada só traduz os `errcode` dessas funções para respostas
// HTTP compreensíveis (mesmo padrão de cash/routes.ts e receivables/routes.ts).
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
const createSchema = z.object({
  supplierId: id.nullable().optional(), purchaseOrderId: id.nullable().optional(),
  description: z.string().trim().min(1).max(300), documentNumber: z.string().trim().max(100).nullable().optional(),
  issueDate: z.string().trim().min(1).nullable().optional(),
  installments: z.array(installmentSchema).min(1).max(60),
}).strict();
const updateSchema = z.object({ description: z.string().trim().min(1).max(300).optional(), documentNumber: z.string().trim().max(100).nullable().optional() }).strict();
const paySchema = z.object({
  amount: z.coerce.number().positive(), paidAt: z.string().trim().min(1).nullable().optional(),
  paymentMethodId: id.nullable().optional(), notes: z.string().trim().max(2000).nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();
const reverseSchema = z.object({ reason: z.string().trim().max(1000).nullable().optional() }).strict();
const cancelSchema = z.object({ reason: z.string().trim().max(1000).nullable().optional() }).strict();
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  supplierId: id.optional(), origin: z.enum(['purchase_order', 'manual']).optional(),
  status: z.enum(['open', 'partial', 'paid', 'overdue', 'canceled']).optional(),
  from: z.string().trim().min(1).optional(), to: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).max(200).optional(),
}).strict();

const scope = (s: AuthSession): ResourceScope => (s.activeBranchId ? { companyId: s.activeCompanyId!, branchId: s.activeBranchId } : s.activeCompanyId ? { companyId: s.activeCompanyId } : { requireTenant: true });

function identityNameSubquery(tenantId: string, columnRef: string) {
  return sql`(select tup.name from tenant_memberships tm join tenant_user_profiles tup on tup.tenant_id=tm.tenant_id and tup.membership_id=tm.id where tm.tenant_id=${tenantId} and tm.identity_id=${sql.raw(columnRef)} limit 1)`;
}

// Valor líquido pago de UMA parcela — soma de `payment` menos `reversal` (o estorno sempre tem o
// mesmo valor do pagamento original, então isto sempre volta a 0 para um pagamento totalmente
// estornado). `refExpr` é sempre um literal estático deste arquivo (alias da linha de
// `payable_installments`/`payables` na query externa), nunca entrada do usuário.
function installmentPaidExpr(refExpr: string) {
  return sql`coalesce((select sum(case when pp.type='payment' then pp.amount else -pp.amount end) from payable_payments pp where pp.payable_installment_id=${sql.raw(refExpr)}.id),0)`;
}
// Valor líquido pago do TÍTULO inteiro — soma sobre todas as parcelas.
function payablePaidExpr(refExpr: string) {
  return sql`coalesce((select sum(case when pp.type='payment' then pp.amount else -pp.amount end) from payable_payments pp join payable_installments pi on pi.id=pp.payable_installment_id where pi.payable_id=${sql.raw(refExpr)}.id),0)`;
}
// Existe parcela vencida (due_date no passado) com saldo ainda em aberto?
function payableOverdueExpr(refExpr: string) {
  return sql`exists (select 1 from payable_installments pi where pi.payable_id=${sql.raw(refExpr)}.id and pi.due_date<current_date and pi.original_amount>${installmentPaidExpr('pi')})`;
}
// Status derivado do TÍTULO (seção 6 do correio.md): `active`/`canceled` são os únicos valores
// reais em `payables.status` — `open`/`partial`/`paid`/`overdue` são sempre calculados a partir
// do valor pago e do vencimento das parcelas, nunca persistidos (evita a divergência que uma
// segunda fonte de verdade sempre arrisca).
function payableStatusExpr(refExpr: string) {
  const paid = payablePaidExpr(refExpr), overdue = payableOverdueExpr(refExpr);
  return sql`case when ${sql.raw(refExpr)}.status='canceled' then 'canceled' when ${paid}>=${sql.raw(refExpr)}.original_amount then 'paid' when ${overdue} then 'overdue' when ${paid}>0 then 'partial' else 'open' end`;
}

export function registerPayableRoutes(app: FastifyInstance, service: AuthService) {
  async function auth(req: FastifyRequest, reply: FastifyReply) {
    const s = await service.session(req.cookies.vetoros_session);
    if (!s) { reply.code(401).send({ error: 'unauthorized' }); return; }
    if (!s.activeTenantId || !s.activeCompanyId || !s.activeBranchId) { reply.code(409).send({ error: 'operational_context_required' }); return; }
    return s;
  }
  async function allow(reply: FastifyReply, s: AuthSession, p: string) { try { await requirePermission(service, s, p, scope(s)); return true; } catch { reply.code(403).send({ error: 'forbidden' }); return false; } }

  const originExpr = sql`case when p.purchase_order_id is not null then 'purchase_order' else 'manual' end`;

  app.get('/payables', async (req, reply) => {
    const q = listSchema.safeParse(req.query); if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'payables.read')) return;
    const offset = (q.data.page - 1) * q.data.pageSize, term = q.data.q ? `%${q.data.q}%` : null;
    const paid = payablePaidExpr('p'), status = payableStatusExpr('p');
    // vencimento de referência para filtro/ordenação da listagem: a PRÓXIMA parcela ainda com
    // saldo em aberto (ou, se todas pagas/inexistentes, a última) — evita a listagem parecer
    // "sem vencimento" para um título com várias parcelas.
    const nextDueExpr = sql`coalesce((select min(pi.due_date) from payable_installments pi where pi.payable_id=p.id and pi.original_amount>${installmentPaidExpr('pi')}), (select max(pi.due_date) from payable_installments pi where pi.payable_id=p.id))`;
    const rows = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      select p.*, coalesce(p.supplier_name_snapshot, sup.legal_name) as supplier_display_name, po.purchase_order_number,
        ${originExpr} as origin, ${paid} as paid_amount, (p.original_amount - ${paid}) as balance, ${status} as derived_status,
        ${nextDueExpr} as next_due_date, count(*) over()::int as total
      from payables p
      left join suppliers sup on sup.id=p.supplier_id
      left join purchase_orders po on po.id=p.purchase_order_id
      where p.branch_id=${s.activeBranchId!}
        and (${q.data.supplierId ?? null}::uuid is null or p.supplier_id=${q.data.supplierId ?? null})
        and (${q.data.origin ?? null}::text is null
          or (${q.data.origin ?? null}='purchase_order' and p.purchase_order_id is not null)
          or (${q.data.origin ?? null}='manual' and p.purchase_order_id is null))
        and (${q.data.from ?? null}::date is null or ${nextDueExpr}>=${q.data.from ?? null})
        and (${q.data.to ?? null}::date is null or ${nextDueExpr}<=${q.data.to ?? null})
        and (${q.data.status ?? null}::text is null or ${status}=${q.data.status ?? null})
        and (${term}::text is null or p.description ilike ${term} or p.document_number ilike ${term} or coalesce(p.supplier_name_snapshot,sup.legal_name) ilike ${term} or po.purchase_order_number::text ilike ${term})
      order by ${nextDueExpr} asc, p.created_at desc limit ${q.data.pageSize} offset ${offset}`));
    return { items: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'total'))), page: q.data.page, pageSize: q.data.pageSize, total: Number(rows[0]?.total ?? 0) };
  });

  app.get('/payables/:id', async (req, reply) => {
    const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'payables.read')) return;
    const paid = payablePaidExpr('p'), status = payableStatusExpr('p');
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      const [row] = await tx.execute(sql`
        select p.*, coalesce(p.supplier_name_snapshot, sup.legal_name) as supplier_display_name, b.name as branch_name,
          po.purchase_order_number, ${originExpr} as origin, ${paid} as paid_amount, (p.original_amount - ${paid}) as balance, ${status} as derived_status
        from payables p
        left join suppliers sup on sup.id=p.supplier_id
        left join purchase_orders po on po.id=p.purchase_order_id
        join branches b on b.id=p.branch_id
        where p.id=${p.data.id}`);
      if (!row) return null;
      const instPaid = installmentPaidExpr('pi');
      const installments = await tx.execute(sql`
        select pi.*, ${instPaid} as paid_amount, (pi.original_amount - ${instPaid}) as balance,
          case when pi.due_date<current_date and pi.original_amount>${instPaid} then true else false end as overdue
        from payable_installments pi where pi.payable_id=${p.data.id} order by pi.installment_number`);
      const payments = await tx.execute(sql`
        select pp.id, pp.type, pp.amount, pp.paid_at, pp.payment_method_id, pm.name as payment_method_name, pp.notes,
          pp.payable_installment_id, pi.installment_number, pp.reverses_payment_id,
          exists (select 1 from payable_payments r where r.reverses_payment_id=pp.id) as reversed,
          ${identityNameSubquery(s.activeTenantId!, 'pp.created_by_identity_id')} as created_by_name, pp.created_at
        from payable_payments pp
        join payable_installments pi on pi.id=pp.payable_installment_id
        left join payment_methods pm on pm.id=pp.payment_method_id
        where pi.payable_id=${p.data.id} order by pp.created_at desc`);
      return { ...row, installments, payments };
    });
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return result;
  });

  app.post('/payables', async (req, reply) => {
    const b = createSchema.safeParse(req.body);
    if (!b.success || (b.data.supplierId && b.data.purchaseOrderId)) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'payables.create')) return;
    try {
      const installmentsJson = JSON.stringify(b.data.installments.map((i) => ({ amount: i.amount, dueDate: i.dueDate })));
      const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select * from create_payable(${b.data.supplierId ?? null},${b.data.purchaseOrderId ?? null},${s.activeCompanyId!},${s.activeBranchId!},${b.data.description},${b.data.documentNumber ?? null},${b.data.issueDate ?? null},${installmentsJson}::jsonb)`));
      if (!row.idempotent) await service.auditResource(s, 'payable.created', 'payable', row.id, { supplierId: b.data.supplierId, purchaseOrderId: b.data.purchaseOrderId, originalAmount: row.original_amount, installmentCount: b.data.installments.length });
      return reply.code(row.idempotent ? 200 : 201).send(row);
    } catch (e) {
      const code = dbCode(e);
      if (code === '23503') return reply.code(404).send({ error: 'invalid_origin_or_supplier' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_installments' });
      throw e;
    }
  });

  app.patch('/payables/:id', async (req, reply) => {
    const p = params.safeParse(req.params), b = updateSchema.safeParse(req.body); if (!p.success || !b.success || !Object.keys(b.data).length) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'payables.update')) return;
    const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      update payables set description=coalesce(${b.data.description ?? null},description),
        document_number=case when ${'documentNumber' in b.data} then ${b.data.documentNumber ?? null} else document_number end,
        updated_by_identity_id=${s.identityId}, updated_at=now()
      where id=${p.data.id} and branch_id=${s.activeBranchId!} returning *`));
    if (!row) return reply.code(404).send({ error: 'not_found' });
    await service.auditResource(s, 'payable.updated', 'payable', p.data.id, { description: b.data.description, documentNumber: b.data.documentNumber });
    return row;
  });

  app.post('/payables/:id/installments/:installmentId/payments', async (req, reply) => {
    const p = z.object({ id, installmentId: id }).safeParse(req.params), b = paySchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'payables.pay')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const installment = await tx.execute(sql`select pi.id from payable_installments pi join payables pay on pay.id=pi.payable_id where pi.id=${p.data.installmentId} and pi.payable_id=${p.data.id} and pay.branch_id=${s.activeBranchId!}`);
        if (!installment.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from pay_installment(${p.data.installmentId},${b.data.amount},${b.data.paidAt ?? null},${b.data.paymentMethodId ?? null},${b.data.notes ?? null},${b.data.idempotencyKey})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (!result.idempotent) await service.auditResource(s, 'payable.paid', 'payable', p.data.id, { installmentId: p.data.installmentId, amount: b.data.amount });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (e) {
      const code = dbCode(e);
      if (code === '55000') return reply.code(409).send({ error: 'payable_not_active' });
      if (code === '23514') return reply.code(409).send({ error: 'payment_exceeds_balance' });
      if (code === '23505') return reply.code(409).send({ error: 'idempotency_conflict' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_request' });
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      throw e;
    }
  });

  app.post('/payables/:id/installments/:installmentId/payments/:paymentId/reverse', async (req, reply) => {
    const p = z.object({ id, installmentId: id, paymentId: id }).safeParse(req.params), b = reverseSchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'payables.reverse')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const payment = await tx.execute(sql`
          select pp.id from payable_payments pp join payable_installments pi on pi.id=pp.payable_installment_id join payables pay on pay.id=pi.payable_id
          where pp.id=${p.data.paymentId} and pp.payable_installment_id=${p.data.installmentId} and pi.payable_id=${p.data.id} and pay.branch_id=${s.activeBranchId!}`);
        if (!payment.length) return 'not_found';
        const [row] = await tx.execute(sql`select * from reverse_payable_payment(${p.data.paymentId},${b.data.reason ?? null})`);
        return row;
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (!result.idempotent) await service.auditResource(s, 'payable.payment_reversed', 'payable', p.data.id, { installmentId: p.data.installmentId, paymentId: p.data.paymentId, reason: b.data.reason ?? null });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (e) {
      const code = dbCode(e);
      if (code === '23505') return reply.code(409).send({ error: 'already_reversed' });
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      throw e;
    }
  });

  app.post('/payables/:id/cancel', async (req, reply) => {
    const p = params.safeParse(req.params), b = cancelSchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'payables.cancel')) return;
    try {
      const [row] = await service.withAuthenticatedTenant(s, async (tx) => {
        const exists = await tx.execute(sql`select id from payables where id=${p.data.id} and branch_id=${s.activeBranchId!}`);
        if (!exists.length) return [];
        return tx.execute(sql`select * from cancel_payable(${p.data.id},${b.data.reason ?? null})`);
      });
      if (!row) return reply.code(404).send({ error: 'not_found' });
      if (!row.idempotent) await service.auditResource(s, 'payable.canceled', 'payable', p.data.id, { reason: b.data.reason ?? null });
      return row;
    } catch (e) {
      const code = dbCode(e);
      if (code === '23514') return reply.code(409).send({ error: 'payable_has_active_payments' });
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      throw e;
    }
  });
}
