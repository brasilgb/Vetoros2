// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthService, AuthSession, ResourceScope } from '../auth/service.js';
import { requirePermission } from '../auth/service.js';

const id = z.string().uuid();
const statuses = ['draft', 'confirmed', 'cancelled'] as const;
const params = z.object({ id });
const createSchema = z.object({ purchaseReceiptId: id, returnedAt: z.string().date().optional(), reason: z.string().trim().max(500).nullable().optional(), notes: z.string().trim().max(4000).nullable().optional() }).strict();
const updateSchema = z.object({ returnedAt: z.string().date().optional(), reason: z.string().trim().max(500).nullable().optional(), notes: z.string().trim().max(4000).nullable().optional() }).strict();
const listSchema = z.object({ search: z.string().trim().max(100).optional(), purchaseReceiptId: id.optional(), status: z.enum(statuses).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), order: z.enum(['newest', 'oldest', 'number_asc', 'number_desc']).default('newest') }).strict();
const itemCreate = z.object({ purchaseReceiptItemId: id, quantity: z.coerce.number().positive(), description: z.string().trim().min(1).max(300).optional() }).strict();
const itemUpdate = z.object({ quantity: z.coerce.number().positive().optional(), description: z.string().trim().min(1).max(300).optional() }).strict();
const scope = (s: AuthSession): ResourceScope => s.activeBranchId ? { companyId: s.activeCompanyId!, branchId: s.activeBranchId } : s.activeCompanyId ? { companyId: s.activeCompanyId } : { requireTenant: true };

// Resumo de devoluções de um recebimento (seção 23 do COM-04): quanto de cada item já foi
// devolvido em devoluções CONFIRMADAS (nunca armazenado, sempre derivado) e a lista de
// devoluções relacionadas. Exportado para ser reaproveitado por purchase-receipts/routes.ts
// sem duplicar a consulta nem criar dependência circular (purchase-returns não importa nada
// de purchase-receipts).
export async function purchaseReceiptReturnSummary(tx: unknown, receiptId: string) {
  const db = tx as { execute: (q: unknown) => Promise<unknown[]> };
  const rows = await db.execute(sql`select pri.id purchase_receipt_item_id,coalesce(sum(ri.quantity) filter (where pr.status='confirmed'),0) returned_quantity from purchase_receipt_items pri left join purchase_return_items ri on ri.purchase_receipt_item_id=pri.id left join purchase_returns pr on pr.id=ri.purchase_return_id where pri.purchase_receipt_id=${receiptId} group by pri.id`) as Array<{ purchase_receipt_item_id: string; returned_quantity: string }>;
  const returns = await db.execute(sql`select * from purchase_returns where purchase_receipt_id=${receiptId} order by created_at desc`);
  return { returnedByItem: Object.fromEntries(rows.map((r) => [r.purchase_receipt_item_id, Number(r.returned_quantity)])), returns };
}

export function registerPurchaseReturnRoutes(app: FastifyInstance, service: AuthService) {
  async function auth(req: FastifyRequest, reply: FastifyReply) { const s = await service.session(req.cookies.vetoros_session); if (!s) { reply.code(401).send({ error: 'unauthorized' }); return; } if (!s.activeTenantId || !s.activeCompanyId || !s.activeBranchId) { reply.code(409).send({ error: 'operational_context_required' }); return; } return s; }
  async function allow(reply: FastifyReply, s: AuthSession, p: string) { try { await requirePermission(service, s, p, scope(s)); return true; } catch { reply.code(403).send({ error: 'forbidden' }); return false; } }

  async function returnDetail(s: AuthSession, returnId: string) {
    return service.withAuthenticatedTenant(s, async (tx) => {
      const [row] = await tx.execute(sql`select r.*,pr.receipt_number,pr.purchase_order_id,po.purchase_order_number,po.supplier_id,sup.legal_name supplier_name,b.name branch_name from purchase_returns r join purchase_receipts pr on pr.id=r.purchase_receipt_id join purchase_orders po on po.id=pr.purchase_order_id join suppliers sup on sup.id=po.supplier_id join branches b on b.id=r.branch_id where r.id=${returnId}`);
      if (!row) return null;
      const items = await tx.execute(sql`select ri.*,pri.quantity received_quantity,ip.sku part_sku,coalesce((select sum(ri2.quantity) from purchase_return_items ri2 join purchase_returns pr2 on pr2.id=ri2.purchase_return_id where ri2.purchase_receipt_item_id=ri.purchase_receipt_item_id and pr2.status='confirmed' and pr2.id<>${returnId}),0) previously_returned_quantity from purchase_return_items ri join purchase_receipt_items pri on pri.id=ri.purchase_receipt_item_id join inventory_parts ip on ip.id=ri.inventory_part_id where ri.purchase_return_id=${returnId} order by ri.created_at`);
      const withRemaining = items.map((i) => ({ ...i, remaining_returnable_quantity: Number(i.received_quantity) - Number(i.previously_returned_quantity) - Number(i.quantity) }));
      return { ...row, items: withRemaining };
    });
  }

  app.get('/purchase-returns', async (req, reply) => { const q = listSchema.safeParse(req.query); if (!q.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_returns.read')) return; const offset = (q.data.page - 1) * q.data.pageSize, term = q.data.search ? `%${q.data.search}%` : null; const ordering = q.data.order === 'oldest' ? sql`r.created_at asc` : q.data.order === 'number_asc' ? sql`r.return_number asc` : q.data.order === 'number_desc' ? sql`r.return_number desc` : sql`r.created_at desc`; const rows = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select r.*,pr.receipt_number,pr.purchase_order_id,po.purchase_order_number,sup.legal_name supplier_name,b.name branch_name,count(*) over()::int total from purchase_returns r join purchase_receipts pr on pr.id=r.purchase_receipt_id join purchase_orders po on po.id=pr.purchase_order_id join suppliers sup on sup.id=po.supplier_id join branches b on b.id=r.branch_id where (${q.data.purchaseReceiptId ?? null}::uuid is null or r.purchase_receipt_id=${q.data.purchaseReceiptId ?? null}) and (${q.data.status ?? null}::text is null or r.status=${q.data.status ?? null}) and (${term}::text is null or r.return_number::text ilike ${term} or pr.receipt_number::text ilike ${term} or sup.legal_name ilike ${term}) order by ${ordering} limit ${q.data.pageSize} offset ${offset}`)); return { items: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'total'))), page: q.data.page, pageSize: q.data.pageSize, total: Number(rows[0]?.total ?? 0) }; });
  app.get('/purchase-returns/:id', async (req, reply) => { const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_returns.read')) return; return await returnDetail(s, p.data.id) ?? reply.code(404).send({ error: 'not_found' }); });
  app.post('/purchase-returns', async (req, reply) => {
    const b = createSchema.safeParse(req.body); if (!b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_returns.create')) return;
    const returnedAt = b.data.returnedAt ?? new Date().toISOString().slice(0, 10);
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      const [receipt] = await tx.execute(sql`select id,company_id,branch_id,status from purchase_receipts where id=${b.data.purchaseReceiptId}`);
      if (!receipt) return 'receipt';
      if (receipt.status !== 'confirmed') return 'not_confirmed';
      const [counter] = await tx.execute(sql`insert into purchase_return_number_counters(tenant_id,last_number) values(${s.activeTenantId!},1) on conflict(tenant_id) do update set last_number=purchase_return_number_counters.last_number+1,updated_at=now() returning last_number`);
      const [row] = await tx.execute(sql`insert into purchase_returns(tenant_id,company_id,branch_id,purchase_receipt_id,return_number,returned_at,reason,notes,created_by_identity_id,updated_by_identity_id) values(${s.activeTenantId!},${receipt.company_id},${receipt.branch_id},${b.data.purchaseReceiptId},${counter!.last_number},${returnedAt},${b.data.reason ?? null},${b.data.notes ?? null},${s.identityId},${s.identityId}) returning *`);
      return row;
    });
    if (result === 'receipt') return reply.code(404).send({ error: 'purchase_receipt_not_found' });
    if (result === 'not_confirmed') return reply.code(409).send({ error: 'purchase_receipt_not_confirmed' });
    await service.auditResource(s, 'purchase_return.created', 'purchase_return', result.id, { purchaseReceiptId: b.data.purchaseReceiptId });
    return reply.code(201).send(result);
  });
  app.patch('/purchase-returns/:id', async (req, reply) => { const p = params.safeParse(req.params), b = updateSchema.safeParse(req.body); if (!p.success || !b.success || !Object.keys(b.data).length) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_returns.update')) return; const result = await service.withAuthenticatedTenant(s, async (tx) => { const [old] = await tx.execute(sql`select status from purchase_returns where id=${p.data.id} for update`); if (!old) return 'missing'; if (old.status !== 'draft') return 'locked'; const [row] = await tx.execute(sql`update purchase_returns set returned_at=coalesce(${b.data.returnedAt ?? null},returned_at),reason=case when ${'reason' in b.data} then ${b.data.reason ?? null} else reason end,notes=case when ${'notes' in b.data} then ${b.data.notes ?? null} else notes end,updated_by_identity_id=${s.identityId},updated_at=now() where id=${p.data.id} returning *`); return row; }); if (result === 'missing') return reply.code(404).send({ error: 'not_found' }); if (result === 'locked') return reply.code(409).send({ error: 'purchase_return_not_editable' }); await service.auditResource(s, 'purchase_return.updated', 'purchase_return', p.data.id); return result; });

  app.get('/purchase-returns/:id/items', async (req, reply) => { const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_returns.read')) return; const found = await returnDetail(s, p.data.id); return found ? found.items : reply.code(404).send({ error: 'not_found' }); });
  app.post('/purchase-returns/:id/items', async (req, reply) => {
    const p = params.safeParse(req.params), b = itemCreate.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_returns.update')) return;
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      const [ret] = await tx.execute(sql`select status,purchase_receipt_id from purchase_returns where id=${p.data.id}`); if (!ret) return 'return';
      if (ret.status !== 'draft') return 'locked';
      const [receiptItem] = await tx.execute(sql`select id,quantity,inventory_part_id,description from purchase_receipt_items where id=${b.data.purchaseReceiptItemId} and purchase_receipt_id=${ret.purchase_receipt_id}`);
      if (!receiptItem) return 'item';
      const [{ returned }] = await tx.execute(sql`select coalesce(sum(ri.quantity),0) returned from purchase_return_items ri join purchase_returns pr on pr.id=ri.purchase_return_id where ri.purchase_receipt_item_id=${receiptItem.id} and pr.status='confirmed'`);
      const returnable = Number(receiptItem.quantity) - Number(returned);
      if (b.data.quantity > returnable) return 'exceeds';
      const [row] = await tx.execute(sql`insert into purchase_return_items(tenant_id,purchase_return_id,purchase_receipt_id,purchase_receipt_item_id,inventory_part_id,description,quantity) values(${s.activeTenantId!},${p.data.id},${ret.purchase_receipt_id},${receiptItem.id},${receiptItem.inventory_part_id},${b.data.description ?? receiptItem.description},${b.data.quantity}) returning *`);
      return row;
    });
    if (result === 'return') return reply.code(404).send({ error: 'not_found' });
    if (result === 'locked') return reply.code(409).send({ error: 'purchase_return_not_editable' });
    if (result === 'item') return reply.code(404).send({ error: 'purchase_receipt_item_not_found' });
    if (result === 'exceeds') return reply.code(409).send({ error: 'quantity_exceeds_returnable' });
    await service.auditResource(s, 'purchase_return_item.created', 'purchase_return', p.data.id, { purchaseReceiptItemId: b.data.purchaseReceiptItemId, quantity: b.data.quantity });
    return reply.code(201).send(result);
  });
  app.patch('/purchase-returns/:id/items/:itemId', async (req, reply) => {
    const p = z.object({ id, itemId: id }).safeParse(req.params), b = itemUpdate.safeParse(req.body); if (!p.success || !b.success || !Object.keys(b.data).length) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_returns.update')) return;
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      const [old] = await tx.execute(sql`select ri.*,r.status return_status from purchase_return_items ri join purchase_returns r on r.id=ri.purchase_return_id where ri.id=${p.data.itemId} and ri.purchase_return_id=${p.data.id}`);
      if (!old) return 'missing'; if (old.return_status !== 'draft') return 'locked';
      const quantity = b.data.quantity ?? Number(old.quantity);
      if ('quantity' in b.data) {
        const [receiptItem] = await tx.execute(sql`select quantity from purchase_receipt_items where id=${old.purchase_receipt_item_id}`);
        const [{ returned }] = await tx.execute(sql`select coalesce(sum(ri.quantity),0) returned from purchase_return_items ri join purchase_returns pr on pr.id=ri.purchase_return_id where ri.purchase_receipt_item_id=${old.purchase_receipt_item_id} and pr.status='confirmed'`);
        if (quantity > Number(receiptItem.quantity) - Number(returned)) return 'exceeds';
      }
      const [row] = await tx.execute(sql`update purchase_return_items set description=coalesce(${b.data.description ?? null},description),quantity=${quantity},updated_at=now() where id=${p.data.itemId} and purchase_return_id=${p.data.id} returning *`);
      return row;
    });
    if (result === 'missing') return reply.code(404).send({ error: 'not_found' });
    if (result === 'locked') return reply.code(409).send({ error: 'purchase_return_not_editable' });
    if (result === 'exceeds') return reply.code(409).send({ error: 'quantity_exceeds_returnable' });
    await service.auditResource(s, 'purchase_return_item.updated', 'purchase_return', p.data.id);
    return result;
  });
  app.delete('/purchase-returns/:id/items/:itemId', async (req, reply) => { const p = z.object({ id, itemId: id }).safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_returns.update')) return; const result = await service.withAuthenticatedTenant(s, async (tx) => { const [ret] = await tx.execute(sql`select status from purchase_returns where id=${p.data.id}`); if (!ret) return 'missing'; if (ret.status !== 'draft') return 'locked'; const [row] = await tx.execute(sql`delete from purchase_return_items where id=${p.data.itemId} and purchase_return_id=${p.data.id} returning id`); return row ?? 'missing'; }); if (result === 'missing') return reply.code(404).send({ error: 'not_found' }); if (result === 'locked') return reply.code(409).send({ error: 'purchase_return_not_editable' }); await service.auditResource(s, 'purchase_return_item.deleted', 'purchase_return', p.data.id); return { deleted: true }; });

  app.post('/purchase-returns/:id/confirm', async (req, reply) => {
    const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_returns.confirm')) return;
    try {
      const [result] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select return_id id,return_status status,confirmed_at,idempotent from confirm_purchase_return(${p.data.id})`));
      await service.auditResource(s, 'purchase_return.confirmed', 'purchase_return', p.data.id, { idempotent: result.idempotent });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      if (code === '22023') return reply.code(400).send({ error: 'purchase_return_has_no_items' });
      if (code === '23514') return reply.code(409).send({ error: 'insufficient_or_invalid_quantity' });
      if (code === '55000') return reply.code(409).send({ error: 'purchase_return_or_receipt_state_forbids_confirmation' });
      throw e;
    }
  });
  app.post('/purchase-returns/:id/cancel', async (req, reply) => { const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_returns.update')) return; const result = await service.withAuthenticatedTenant(s, async (tx) => { const [old] = await tx.execute(sql`select status from purchase_returns where id=${p.data.id} for update`); if (!old) return 'missing'; if (old.status !== 'draft') return 'locked'; const [row] = await tx.execute(sql`update purchase_returns set status='cancelled',updated_by_identity_id=${s.identityId},updated_at=now() where id=${p.data.id} returning *`); return row; }); if (result === 'missing') return reply.code(404).send({ error: 'not_found' }); if (result === 'locked') return reply.code(409).send({ error: 'purchase_return_not_editable' }); await service.auditResource(s, 'purchase_return.cancelled', 'purchase_return', p.data.id); return result; });

  app.get('/purchase-receipts/:id/returns', async (req, reply) => { const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_returns.read')) return; const result = await service.withAuthenticatedTenant(s, async (tx) => { const [receipt] = await tx.execute(sql`select id from purchase_receipts where id=${p.data.id}`); if (!receipt) return null; return tx.execute(sql`select * from purchase_returns where purchase_receipt_id=${p.data.id} order by created_at desc`); }); return result ?? reply.code(404).send({ error: 'not_found' }); });
}
