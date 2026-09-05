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
const createSchema = z.object({ purchaseOrderId: id, receivedAt: z.string().date().optional(), notes: z.string().trim().max(4000).nullable().optional() }).strict();
const updateSchema = z.object({ receivedAt: z.string().date().optional(), notes: z.string().trim().max(4000).nullable().optional() }).strict();
const listSchema = z.object({ search: z.string().trim().max(100).optional(), purchaseOrderId: id.optional(), status: z.enum(statuses).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), order: z.enum(['newest', 'oldest', 'number_asc', 'number_desc']).default('newest') }).strict();
const itemCreate = z.object({ purchaseOrderItemId: id, quantity: z.coerce.number().positive(), description: z.string().trim().min(1).max(300).optional() }).strict();
const itemUpdate = z.object({ quantity: z.coerce.number().positive().optional(), description: z.string().trim().min(1).max(300).optional() }).strict();
const scope = (s: AuthSession): ResourceScope => s.activeBranchId ? { companyId: s.activeCompanyId!, branchId: s.activeBranchId } : s.activeCompanyId ? { companyId: s.activeCompanyId } : { requireTenant: true };

// Estado físico do pedido quanto ao recebimento (seção 13/22 do COM-03): derivado sempre a
// partir dos recebimentos CONFIRMADOS, nunca armazenado — evita duas fontes de verdade.
export async function purchaseOrderReceiptState(tx: unknown, orderId: string): Promise<'pending' | 'partially_received' | 'received'> {
  const rows = await (tx as { execute: (q: unknown) => Promise<Array<{ ordered: string; received: string }>> }).execute(sql`select oi.quantity ordered,coalesce(sum(pri.quantity) filter (where pr.status='confirmed'),0) received from purchase_order_items oi left join purchase_receipt_items pri on pri.purchase_order_item_id=oi.id left join purchase_receipts pr on pr.id=pri.purchase_receipt_id where oi.purchase_order_id=${orderId} group by oi.id,oi.quantity`);
  if (!rows.length) return 'pending';
  const allReceived = rows.every((r) => Number(r.received) >= Number(r.ordered));
  const noneReceived = rows.every((r) => Number(r.received) <= 0);
  return allReceived ? 'received' : noneReceived ? 'pending' : 'partially_received';
}

export function registerPurchaseReceiptRoutes(app: FastifyInstance, service: AuthService) {
  async function auth(req: FastifyRequest, reply: FastifyReply) { const s = await service.session(req.cookies.vetoros_session); if (!s) { reply.code(401).send({ error: 'unauthorized' }); return; } if (!s.activeTenantId || !s.activeCompanyId || !s.activeBranchId) { reply.code(409).send({ error: 'operational_context_required' }); return; } return s; }
  async function allow(reply: FastifyReply, s: AuthSession, p: string) { try { await requirePermission(service, s, p, scope(s)); return true; } catch { reply.code(403).send({ error: 'forbidden' }); return false; } }

  async function receiptDetail(s: AuthSession, receiptId: string) {
    return service.withAuthenticatedTenant(s, async (tx) => {
      const [row] = await tx.execute(sql`select r.*,po.purchase_order_number,po.supplier_id,sup.legal_name supplier_name,b.name branch_name from purchase_receipts r join purchase_orders po on po.id=r.purchase_order_id join suppliers sup on sup.id=po.supplier_id join branches b on b.id=r.branch_id where r.id=${receiptId}`);
      if (!row) return null;
      const items = await tx.execute(sql`select ri.*,oi.quantity ordered_quantity,ip.sku part_sku,coalesce((select sum(pri.quantity) from purchase_receipt_items pri join purchase_receipts pr on pr.id=pri.purchase_receipt_id where pri.purchase_order_item_id=ri.purchase_order_item_id and pr.status='confirmed' and pr.id<>${receiptId}),0) previously_received_quantity from purchase_receipt_items ri join purchase_order_items oi on oi.id=ri.purchase_order_item_id join inventory_parts ip on ip.id=ri.inventory_part_id where ri.purchase_receipt_id=${receiptId} order by ri.created_at`);
      const withPending = items.map((i) => ({ ...i, pending_after_quantity: Number(i.ordered_quantity) - Number(i.previously_received_quantity) - Number(i.quantity) }));
      const orderReceiptState = await purchaseOrderReceiptState(tx, row.purchase_order_id);
      return { ...row, items: withPending, order_receipt_state: orderReceiptState };
    });
  }

  app.get('/purchase-receipts', async (req, reply) => { const q = listSchema.safeParse(req.query); if (!q.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_receipts.read')) return; const offset = (q.data.page - 1) * q.data.pageSize, term = q.data.search ? `%${q.data.search}%` : null; const ordering = q.data.order === 'oldest' ? sql`r.created_at asc` : q.data.order === 'number_asc' ? sql`r.receipt_number asc` : q.data.order === 'number_desc' ? sql`r.receipt_number desc` : sql`r.created_at desc`; const rows = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select r.*,po.purchase_order_number,sup.legal_name supplier_name,b.name branch_name,count(*) over()::int total from purchase_receipts r join purchase_orders po on po.id=r.purchase_order_id join suppliers sup on sup.id=po.supplier_id join branches b on b.id=r.branch_id where (${q.data.purchaseOrderId ?? null}::uuid is null or r.purchase_order_id=${q.data.purchaseOrderId ?? null}) and (${q.data.status ?? null}::text is null or r.status=${q.data.status ?? null}) and (${term}::text is null or r.receipt_number::text ilike ${term} or po.purchase_order_number::text ilike ${term} or sup.legal_name ilike ${term}) order by ${ordering} limit ${q.data.pageSize} offset ${offset}`)); return { items: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'total'))), page: q.data.page, pageSize: q.data.pageSize, total: Number(rows[0]?.total ?? 0) }; });
  app.get('/purchase-receipts/:id', async (req, reply) => { const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_receipts.read')) return; return await receiptDetail(s, p.data.id) ?? reply.code(404).send({ error: 'not_found' }); });
  app.post('/purchase-receipts', async (req, reply) => {
    const b = createSchema.safeParse(req.body); if (!b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_receipts.create')) return;
    const receivedAt = b.data.receivedAt ?? new Date().toISOString().slice(0, 10);
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      const [order] = await tx.execute(sql`select id,company_id,branch_id,status from purchase_orders where id=${b.data.purchaseOrderId}`);
      if (!order) return 'order';
      if (order.status !== 'approved') return 'not_approved';
      const [counter] = await tx.execute(sql`insert into purchase_receipt_number_counters(tenant_id,last_number) values(${s.activeTenantId!},1) on conflict(tenant_id) do update set last_number=purchase_receipt_number_counters.last_number+1,updated_at=now() returning last_number`);
      const [row] = await tx.execute(sql`insert into purchase_receipts(tenant_id,company_id,branch_id,purchase_order_id,receipt_number,received_at,notes,created_by_identity_id,updated_by_identity_id) values(${s.activeTenantId!},${order.company_id},${order.branch_id},${b.data.purchaseOrderId},${counter!.last_number},${receivedAt},${b.data.notes ?? null},${s.identityId},${s.identityId}) returning *`);
      return row;
    });
    if (result === 'order') return reply.code(404).send({ error: 'purchase_order_not_found' });
    if (result === 'not_approved') return reply.code(409).send({ error: 'purchase_order_not_approved' });
    await service.auditResource(s, 'purchase_receipt.created', 'purchase_receipt', result.id, { purchaseOrderId: b.data.purchaseOrderId });
    return reply.code(201).send(result);
  });
  app.patch('/purchase-receipts/:id', async (req, reply) => { const p = params.safeParse(req.params), b = updateSchema.safeParse(req.body); if (!p.success || !b.success || !Object.keys(b.data).length) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_receipts.update')) return; const result = await service.withAuthenticatedTenant(s, async (tx) => { const [old] = await tx.execute(sql`select status from purchase_receipts where id=${p.data.id} for update`); if (!old) return 'missing'; if (old.status !== 'draft') return 'locked'; const [row] = await tx.execute(sql`update purchase_receipts set received_at=coalesce(${b.data.receivedAt ?? null},received_at),notes=case when ${'notes' in b.data} then ${b.data.notes ?? null} else notes end,updated_by_identity_id=${s.identityId},updated_at=now() where id=${p.data.id} returning *`); return row; }); if (result === 'missing') return reply.code(404).send({ error: 'not_found' }); if (result === 'locked') return reply.code(409).send({ error: 'purchase_receipt_not_editable' }); await service.auditResource(s, 'purchase_receipt.updated', 'purchase_receipt', p.data.id); return result; });

  app.get('/purchase-receipts/:id/items', async (req, reply) => { const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_receipts.read')) return; const found = await receiptDetail(s, p.data.id); return found ? found.items : reply.code(404).send({ error: 'not_found' }); });
  app.post('/purchase-receipts/:id/items', async (req, reply) => {
    const p = params.safeParse(req.params), b = itemCreate.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_receipts.update')) return;
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      const [receipt] = await tx.execute(sql`select status,purchase_order_id from purchase_receipts where id=${p.data.id}`); if (!receipt) return 'receipt';
      if (receipt.status !== 'draft') return 'locked';
      const [orderItem] = await tx.execute(sql`select id,quantity,inventory_part_id,description from purchase_order_items where id=${b.data.purchaseOrderItemId} and purchase_order_id=${receipt.purchase_order_id}`);
      if (!orderItem) return 'item';
      const [{ received }] = await tx.execute(sql`select coalesce(sum(pri.quantity),0) received from purchase_receipt_items pri join purchase_receipts pr on pr.id=pri.purchase_receipt_id where pri.purchase_order_item_id=${orderItem.id} and pr.status='confirmed'`);
      const pending = Number(orderItem.quantity) - Number(received);
      if (b.data.quantity > pending) return 'exceeds';
      const [row] = await tx.execute(sql`insert into purchase_receipt_items(tenant_id,purchase_receipt_id,purchase_order_id,purchase_order_item_id,inventory_part_id,description,quantity) values(${s.activeTenantId!},${p.data.id},${receipt.purchase_order_id},${orderItem.id},${orderItem.inventory_part_id},${b.data.description ?? orderItem.description},${b.data.quantity}) returning *`);
      return row;
    });
    if (result === 'receipt') return reply.code(404).send({ error: 'not_found' });
    if (result === 'locked') return reply.code(409).send({ error: 'purchase_receipt_not_editable' });
    if (result === 'item') return reply.code(404).send({ error: 'purchase_order_item_not_found' });
    if (result === 'exceeds') return reply.code(409).send({ error: 'quantity_exceeds_pending' });
    await service.auditResource(s, 'purchase_receipt_item.created', 'purchase_receipt', p.data.id, { purchaseOrderItemId: b.data.purchaseOrderItemId, quantity: b.data.quantity });
    return reply.code(201).send(result);
  });
  app.patch('/purchase-receipts/:id/items/:itemId', async (req, reply) => {
    const p = z.object({ id, itemId: id }).safeParse(req.params), b = itemUpdate.safeParse(req.body); if (!p.success || !b.success || !Object.keys(b.data).length) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_receipts.update')) return;
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      const [old] = await tx.execute(sql`select ri.*,r.status receipt_status from purchase_receipt_items ri join purchase_receipts r on r.id=ri.purchase_receipt_id where ri.id=${p.data.itemId} and ri.purchase_receipt_id=${p.data.id}`);
      if (!old) return 'missing'; if (old.receipt_status !== 'draft') return 'locked';
      const quantity = b.data.quantity ?? Number(old.quantity);
      if ('quantity' in b.data) {
        const [{ ordered, received }] = await tx.execute(sql`select oi.quantity ordered,coalesce((select sum(pri.quantity) from purchase_receipt_items pri join purchase_receipts pr on pr.id=pri.purchase_receipt_id where pri.purchase_order_item_id=oi.id and pr.status='confirmed'),0) received from purchase_order_items oi where oi.id=${old.purchase_order_item_id}`);
        if (quantity > Number(ordered) - Number(received)) return 'exceeds';
      }
      const [row] = await tx.execute(sql`update purchase_receipt_items set description=coalesce(${b.data.description ?? null},description),quantity=${quantity},updated_at=now() where id=${p.data.itemId} and purchase_receipt_id=${p.data.id} returning *`);
      return row;
    });
    if (result === 'missing') return reply.code(404).send({ error: 'not_found' });
    if (result === 'locked') return reply.code(409).send({ error: 'purchase_receipt_not_editable' });
    if (result === 'exceeds') return reply.code(409).send({ error: 'quantity_exceeds_pending' });
    await service.auditResource(s, 'purchase_receipt_item.updated', 'purchase_receipt', p.data.id);
    return result;
  });
  app.delete('/purchase-receipts/:id/items/:itemId', async (req, reply) => { const p = z.object({ id, itemId: id }).safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_receipts.update')) return; const result = await service.withAuthenticatedTenant(s, async (tx) => { const [receipt] = await tx.execute(sql`select status from purchase_receipts where id=${p.data.id}`); if (!receipt) return 'missing'; if (receipt.status !== 'draft') return 'locked'; const [row] = await tx.execute(sql`delete from purchase_receipt_items where id=${p.data.itemId} and purchase_receipt_id=${p.data.id} returning id`); return row ?? 'missing'; }); if (result === 'missing') return reply.code(404).send({ error: 'not_found' }); if (result === 'locked') return reply.code(409).send({ error: 'purchase_receipt_not_editable' }); await service.auditResource(s, 'purchase_receipt_item.deleted', 'purchase_receipt', p.data.id); return { deleted: true }; });

  app.post('/purchase-receipts/:id/confirm', async (req, reply) => {
    const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_receipts.confirm')) return;
    try {
      const [result] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select receipt_id id,receipt_status status,confirmed_at,idempotent from confirm_purchase_receipt(${p.data.id})`));
      await service.auditResource(s, 'purchase_receipt.confirmed', 'purchase_receipt', p.data.id, { idempotent: result.idempotent });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === 'P0002') return reply.code(404).send({ error: 'not_found' });
      if (code === '22023') return reply.code(400).send({ error: 'purchase_receipt_has_no_items' });
      if (code === '23514') return reply.code(409).send({ error: 'received_quantity_exceeds_pending' });
      if (code === '55000') return reply.code(409).send({ error: 'purchase_order_or_receipt_state_forbids_confirmation' });
      throw e;
    }
  });
  app.post('/purchase-receipts/:id/cancel', async (req, reply) => { const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_receipts.update')) return; const result = await service.withAuthenticatedTenant(s, async (tx) => { const [old] = await tx.execute(sql`select status from purchase_receipts where id=${p.data.id} for update`); if (!old) return 'missing'; if (old.status !== 'draft') return 'locked'; const [row] = await tx.execute(sql`update purchase_receipts set status='cancelled',updated_by_identity_id=${s.identityId},updated_at=now() where id=${p.data.id} returning *`); return row; }); if (result === 'missing') return reply.code(404).send({ error: 'not_found' }); if (result === 'locked') return reply.code(409).send({ error: 'purchase_receipt_not_editable' }); await service.auditResource(s, 'purchase_receipt.cancelled', 'purchase_receipt', p.data.id); return result; });

  app.get('/purchase-orders/:id/receipts', async (req, reply) => { const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'purchase_receipts.read')) return; const result = await service.withAuthenticatedTenant(s, async (tx) => { const [order] = await tx.execute(sql`select id from purchase_orders where id=${p.data.id}`); if (!order) return null; return tx.execute(sql`select r.*,po.purchase_order_number from purchase_receipts r join purchase_orders po on po.id=r.purchase_order_id where r.purchase_order_id=${p.data.id} order by r.created_at desc`); }); return result ?? reply.code(404).send({ error: 'not_found' }); });
}
