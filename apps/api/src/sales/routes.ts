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
const createSchema = z.object({ customerId: id.nullable().optional(), notes: z.string().trim().max(4000).nullable().optional() }).strict();
const updateSchema = z.object({ customerId: id.nullable().optional(), notes: z.string().trim().max(4000).nullable().optional() }).strict();
const listSchema = z.object({ search: z.string().trim().max(100).optional(), customerId: id.optional(), status: z.enum(statuses).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), order: z.enum(['newest', 'oldest', 'number_asc', 'number_desc']).default('newest') }).strict();
const itemCreate = z.object({ type: z.enum(['service', 'part']), inventoryPartId: id.nullable().optional(), description: z.string().trim().min(1).max(300), quantity: z.coerce.number().positive(), unitPrice: z.coerce.number().nonnegative(), discountAmount: z.coerce.number().nonnegative().default(0), notes: z.string().trim().max(2000).nullable().optional() }).strict();
const itemUpdate = z.object({ type: z.enum(['service', 'part']).optional(), inventoryPartId: id.nullable().optional(), description: z.string().trim().min(1).max(300).optional(), quantity: z.coerce.number().positive().optional(), unitPrice: z.coerce.number().nonnegative().optional(), discountAmount: z.coerce.number().nonnegative().optional(), notes: z.string().trim().max(2000).nullable().optional() }).strict();
const scope = (s: AuthSession): ResourceScope => s.activeBranchId ? { companyId: s.activeCompanyId!, branchId: s.activeBranchId } : s.activeCompanyId ? { companyId: s.activeCompanyId } : { requireTenant: true };
// VEN-03: cancelar uma venda `confirmed` volta a ser uma transição válida, agora com estorno
// de estoque (ver POST /sales/:id/cancel). `cancelled` continua terminal.
const transitions: Record<string, string[]> = { draft: ['confirmed', 'cancelled'], confirmed: ['cancelled'], cancelled: [] };

export function registerSaleRoutes(app: FastifyInstance, service: AuthService) {
  async function auth(req: FastifyRequest, reply: FastifyReply) { const s = await service.session(req.cookies.vetoros_session); if (!s) { reply.code(401).send({ error: 'unauthorized' }); return; } if (!s.activeTenantId || !s.activeCompanyId || !s.activeBranchId) { reply.code(409).send({ error: 'operational_context_required' }); return; } return s; }
  async function allow(reply: FastifyReply, s: AuthSession, p: string) { try { await requirePermission(service, s, p, scope(s)); return true; } catch { reply.code(403).send({ error: 'forbidden' }); return false; } }

  async function saleDetail(s: AuthSession, saleId: string) {
    return service.withAuthenticatedTenant(s, async (tx) => {
      const [row] = await tx.execute(sql`select s.*,c.legal_name customer_name,b.name branch_name from sales s left join customers c on c.id=s.customer_id join branches b on b.id=s.branch_id where s.id=${saleId}`);
      if (!row) return null;
      const items = await tx.execute(sql`select i.*,ip.sku part_sku from sale_items i left join inventory_parts ip on ip.id=i.inventory_part_id where i.sale_id=${saleId} order by i.created_at`);
      const typed = items as Array<{ total: string | number; discount_amount: string | number; quantity: string | number; unit_price: string | number }>;
      const subtotal = typed.reduce((n, i) => n + Number(i.quantity) * Number(i.unit_price), 0);
      const discountTotal = typed.reduce((n, i) => n + Number(i.discount_amount), 0);
      const total = typed.reduce((n, i) => n + Number(i.total), 0);
      return { ...row, items, subtotal: Number(subtotal.toFixed(2)), discount_total: Number(discountTotal.toFixed(2)), total: Number(total.toFixed(2)) };
    });
  }

  app.get('/sales', async (req, reply) => { const q = listSchema.safeParse(req.query); if (!q.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'sales.read')) return; const offset = (q.data.page - 1) * q.data.pageSize, term = q.data.search ? `%${q.data.search}%` : null; const ordering = q.data.order === 'oldest' ? sql`sa.created_at asc` : q.data.order === 'number_asc' ? sql`sa.sale_number asc` : q.data.order === 'number_desc' ? sql`sa.sale_number desc` : sql`sa.created_at desc`; const rows = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select sa.*,c.legal_name customer_name,b.name branch_name,count(*) over()::int total from sales sa left join customers c on c.id=sa.customer_id join branches b on b.id=sa.branch_id where (${q.data.customerId ?? null}::uuid is null or sa.customer_id=${q.data.customerId ?? null}) and (${q.data.status ?? null}::text is null or sa.status=${q.data.status ?? null}) and (${term}::text is null or sa.sale_number::text ilike ${term} or c.legal_name ilike ${term}) order by ${ordering} limit ${q.data.pageSize} offset ${offset}`)); return { items: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'total'))), page: q.data.page, pageSize: q.data.pageSize, total: Number(rows[0]?.total ?? 0) }; });
  app.get('/sales/:id', async (req, reply) => { const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'sales.read')) return; return await saleDetail(s, p.data.id) ?? reply.code(404).send({ error: 'not_found' }); });
  app.post('/sales', async (req, reply) => {
    const b = createSchema.safeParse(req.body); if (!b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'sales.create')) return;
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      if (b.data.customerId) { const customer = await tx.execute(sql`select id from customers where id=${b.data.customerId}`); if (!customer.length) return 'customer'; }
      const [counter] = await tx.execute(sql`insert into sale_number_counters(tenant_id,last_number) values(${s.activeTenantId!},1) on conflict(tenant_id) do update set last_number=sale_number_counters.last_number+1,updated_at=now() returning last_number`);
      const [row] = await tx.execute(sql`insert into sales(tenant_id,company_id,branch_id,sale_number,customer_id,notes,created_by_identity_id,updated_by_identity_id) values(${s.activeTenantId!},${s.activeCompanyId!},${s.activeBranchId!},${counter!.last_number},${b.data.customerId ?? null},${b.data.notes ?? null},${s.identityId},${s.identityId}) returning *`);
      return row;
    });
    if (result === 'customer') return reply.code(404).send({ error: 'customer_not_found' });
    await service.auditResource(s, 'sale.created', 'sale', result.id);
    return reply.code(201).send(result);
  });
  app.patch('/sales/:id', async (req, reply) => {
    const p = params.safeParse(req.params), b = updateSchema.safeParse(req.body); if (!p.success || !b.success || !Object.keys(b.data).length) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'sales.update')) return;
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      const [old] = await tx.execute(sql`select status from sales where id=${p.data.id} for update`); if (!old) return 'missing'; if (old.status !== 'draft') return 'locked';
      if ('customerId' in b.data && b.data.customerId) { const customer = await tx.execute(sql`select id from customers where id=${b.data.customerId}`); if (!customer.length) return 'customer'; }
      const [row] = await tx.execute(sql`update sales set customer_id=case when ${'customerId' in b.data} then ${b.data.customerId ?? null} else customer_id end,notes=case when ${'notes' in b.data} then ${b.data.notes ?? null} else notes end,updated_by_identity_id=${s.identityId},updated_at=now() where id=${p.data.id} returning *`);
      return row;
    });
    if (result === 'missing') return reply.code(404).send({ error: 'not_found' });
    if (result === 'locked') return reply.code(409).send({ error: 'sale_not_editable' });
    if (result === 'customer') return reply.code(404).send({ error: 'customer_not_found' });
    await service.auditResource(s, 'sale.updated', 'sale', p.data.id);
    return result;
  });

  app.get('/sales/:id/items', async (req, reply) => { const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'sales.read')) return; const found = await saleDetail(s, p.data.id); return found ? found.items : reply.code(404).send({ error: 'not_found' }); });
  app.post('/sales/:id/items', async (req, reply) => {
    const p = params.safeParse(req.params), b = itemCreate.safeParse(req.body); if (!p.success || !b.success || b.data.discountAmount > b.data.quantity * b.data.unitPrice || (b.data.type === 'service' && b.data.inventoryPartId)) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'sales.update')) return;
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      const [sale] = await tx.execute(sql`select status from sales where id=${p.data.id}`); if (!sale) return 'sale'; if (sale.status !== 'draft') return 'locked';
      if (b.data.inventoryPartId) { const part = await tx.execute(sql`select id from inventory_parts where id=${b.data.inventoryPartId} and status='active'`); if (!part.length) return 'part'; }
      const [row] = await tx.execute(sql`insert into sale_items(tenant_id,sale_id,type,inventory_part_id,description,quantity,unit_price,discount_amount,notes) values(${s.activeTenantId!},${p.data.id},${b.data.type},${b.data.inventoryPartId ?? null},${b.data.description},${b.data.quantity},${b.data.unitPrice},${b.data.discountAmount},${b.data.notes ?? null}) returning *`);
      return row;
    });
    if (result === 'sale') return reply.code(404).send({ error: 'not_found' });
    if (result === 'locked') return reply.code(409).send({ error: 'sale_not_editable' });
    if (result === 'part') return reply.code(404).send({ error: 'inventory_part_not_found' });
    await service.auditResource(s, 'sale_item.created', 'sale', p.data.id, { inventoryPartId: b.data.inventoryPartId });
    return reply.code(201).send(result);
  });
  app.patch('/sales/:id/items/:itemId', async (req, reply) => {
    const p = z.object({ id, itemId: id }).safeParse(req.params), b = itemUpdate.safeParse(req.body); if (!p.success || !b.success || !Object.keys(b.data).length) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'sales.update')) return;
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      const [old] = await tx.execute(sql`select i.*,sa.status sale_status from sale_items i join sales sa on sa.id=i.sale_id where i.id=${p.data.itemId} and i.sale_id=${p.data.id}`);
      if (!old) return 'missing'; if (old.sale_status !== 'draft') return 'locked';
      const type = b.data.type ?? old.type, part = 'inventoryPartId' in b.data ? b.data.inventoryPartId : old.inventory_part_id;
      if (type === 'service' && part) return 'invalid';
      if (part) { const found = await tx.execute(sql`select id from inventory_parts where id=${part} and status='active'`); if (!found.length) return 'part'; }
      const quantity = b.data.quantity ?? Number(old.quantity), unitPrice = b.data.unitPrice ?? Number(old.unit_price), discount = b.data.discountAmount ?? Number(old.discount_amount);
      if (discount > quantity * unitPrice) return 'invalid';
      const [row] = await tx.execute(sql`update sale_items set type=${type},inventory_part_id=${part ?? null},description=coalesce(${b.data.description ?? null},description),quantity=${quantity},unit_price=${unitPrice},discount_amount=${discount},notes=case when ${'notes' in b.data} then ${b.data.notes ?? null} else notes end,updated_at=now() where id=${p.data.itemId} and sale_id=${p.data.id} returning *`);
      return row;
    });
    if (result === 'missing') return reply.code(404).send({ error: 'not_found' });
    if (result === 'locked') return reply.code(409).send({ error: 'sale_not_editable' });
    if (result === 'part') return reply.code(404).send({ error: 'inventory_part_not_found' });
    if (result === 'invalid') return reply.code(400).send({ error: 'invalid_request' });
    await service.auditResource(s, 'sale_item.updated', 'sale', p.data.id);
    return result;
  });
  app.delete('/sales/:id/items/:itemId', async (req, reply) => { const p = z.object({ id, itemId: id }).safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' }); const s = await auth(req, reply); if (!s || !await allow(reply, s, 'sales.update')) return; const result = await service.withAuthenticatedTenant(s, async (tx) => { const [sale] = await tx.execute(sql`select status from sales where id=${p.data.id}`); if (!sale) return 'missing'; if (sale.status !== 'draft') return 'locked'; const [row] = await tx.execute(sql`delete from sale_items where id=${p.data.itemId} and sale_id=${p.data.id} returning id`); return row ?? 'missing'; }); if (result === 'missing') return reply.code(404).send({ error: 'not_found' }); if (result === 'locked') return reply.code(409).send({ error: 'sale_not_editable' }); await service.auditResource(s, 'sale_item.deleted', 'sale', p.data.id); return { deleted: true }; });

  // VEN-02: a confirmação passa a dar baixa física das peças vinculadas ao estoque, na mesma
  // transação do documento comercial. Não há uma segunda função plpgsql dedicada (como
  // confirm_purchase_receipt/confirm_purchase_return): o próprio `for update` na linha da
  // venda já serve de mutex por venda (reconfirmar é idempotente — nenhuma nova baixa é
  // gerada), e cada item de estoque é baixado chamando record_stock_movement (EST-01), cujo
  // próprio `for update` em stock_balances é o mecanismo real de proteção contra overselling
  // concorrente — o mesmo já usado por EST-02/COM-03/COM-04. Os itens são processados em
  // ordem estável de inventory_part_id para nunca adquirir os locks de stock_balances em
  // ordem diferente da usada por qualquer outra confirmação concorrente (evita deadlock).
  // Qualquer falha (ex.: saldo insuficiente) propaga uma exceção que reverte toda a
  // transação: nenhuma baixa parcial, a venda permanece `draft`.
  app.post('/sales/:id/confirm', async (req, reply) => {
    const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'sales.confirm')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const [old] = await tx.execute(sql`select * from sales where id=${p.data.id} for update`);
        if (!old) return 'missing';
        if (old.status === 'confirmed') return { ...old, idempotent: true };
        if (!transitions[old.status].includes('confirmed')) return 'transition';
        if (!(await tx.execute(sql`select 1 from sale_items where sale_id=${p.data.id} limit 1`)).length) return 'empty';
        const stockItems = await tx.execute(sql`select id,inventory_part_id,quantity from sale_items where sale_id=${p.data.id} and type='part' and inventory_part_id is not null order by inventory_part_id`);
        const reason = `Venda #${old.sale_number}`;
        for (const item of stockItems) {
          await tx.execute(sql`select * from record_stock_movement(${old.company_id},${old.branch_id},${item.inventory_part_id},'exit',${item.quantity},${reason},null,null,null,null,${p.data.id},${item.id})`);
        }
        const [row] = await tx.execute(sql`update sales set status='confirmed',confirmed_at=now(),updated_by_identity_id=${s.identityId},updated_at=now() where id=${p.data.id} returning *`);
        return { ...row, idempotent: false };
      });
      if (result === 'missing') return reply.code(404).send({ error: 'not_found' });
      if (result === 'transition') return reply.code(409).send({ error: 'invalid_status_transition' });
      if (result === 'empty') return reply.code(400).send({ error: 'sale_has_no_items' });
      await service.auditResource(s, 'sale.confirmed', 'sale', p.data.id, { idempotent: result.idempotent });
      return result;
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === '23514') return reply.code(409).send({ error: 'insufficient_stock' });
      if (code === '23503') return reply.code(404).send({ error: 'inventory_part_or_branch_not_found' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_movement' });
      throw e;
    }
  });
  // VEN-03: cancelar uma venda `draft` continua sendo só mudança de status (nunca produziu
  // saída, nada a estornar). Cancelar uma venda `confirmed` localiza as saídas originais de
  // VEN-02 pelo próprio ledger (`stock_movements` com `sale_id`/`type='exit'`) — nunca confia
  // em quantidade vinda do payload nem recalcula a partir de `sale_items` (que poderiam, em
  // tese, divergir do que fisicamente saiu) — e gera uma entrada de estorno igual, item a
  // item, via record_stock_movement (mesma função de VEN-02, sem nenhuma alteração). A
  // identificação da entrada como "estorno daquela saída" não usa uma referência nova: o par
  // (sale_item_id, type) já é suficiente e é a própria garantia estrutural de idempotência —
  // ver o índice único stock_movements_sale_item_type_uq (migration 0018). Igual à
  // confirmação, o `for update` na própria venda é o mutex que torna cancelar duas vezes
  // idempotente (a segunda chamada nunca entra no loop de estorno); os itens são processados
  // em ordem estável de `part_id`, mesma técnica de VEN-02/COM-04 contra deadlock.
  app.post('/sales/:id/cancel', async (req, reply) => {
    const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'sales.update')) return;
    try {
      const result = await service.withAuthenticatedTenant(s, async (tx) => {
        const [old] = await tx.execute(sql`select * from sales where id=${p.data.id} for update`);
        if (!old) return 'missing';
        if (old.status === 'cancelled') return { ...old, idempotent: true };
        if (!transitions[old.status].includes('cancelled')) return 'transition';
        // FIN-01, seção 9: uma venda com recebimento registrado não pode simplesmente "sumir" do
        // financeiro ao ser cancelada — quem decide isso é um estorno explícito em
        // POST /payments/:id/refund, não um cascade automático aqui. Só bloqueia se existir
        // recebimento SEM estorno (`refund`); uma venda cujos recebimentos já foram todos
        // estornados pode ser cancelada normalmente.
        const activePayments = await tx.execute(sql`select 1 from payments p where p.sale_id=${p.data.id} and not exists (select 1 from cash_movements m where m.payment_id=p.id and m.type='refund') limit 1`);
        if (activePayments.length) return 'has_active_payments';
        if (old.status === 'confirmed') {
          const exits = await tx.execute(sql`select id,part_id,branch_id,quantity,sale_item_id from stock_movements where sale_id=${p.data.id} and type='exit' and sale_item_id is not null order by part_id`);
          const reason = `Cancelamento da venda #${old.sale_number}`;
          for (const exit of exits) {
            if (exit.branch_id !== old.branch_id) throw new Error('sale_stock_movement_branch_mismatch');
            await tx.execute(sql`select * from record_stock_movement(${old.company_id},${old.branch_id},${exit.part_id},'entry',${exit.quantity},${reason},null,null,null,null,${p.data.id},${exit.sale_item_id})`);
          }
        }
        const [row] = await tx.execute(sql`update sales set status='cancelled',updated_by_identity_id=${s.identityId},updated_at=now() where id=${p.data.id} returning *`);
        return { ...row, idempotent: false };
      });
      if (result === 'missing') return reply.code(404).send({ error: 'not_found' });
      if (result === 'transition') return reply.code(409).send({ error: 'invalid_status_transition' });
      if (result === 'has_active_payments') return reply.code(409).send({ error: 'sale_has_active_payments' });
      await service.auditResource(s, 'sale.cancelled', 'sale', p.data.id, { idempotent: result.idempotent });
      return result;
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === '23514') return reply.code(409).send({ error: 'insufficient_stock' });
      if (code === '23505') return reply.code(409).send({ error: 'reversal_already_applied' });
      if (code === '23503') return reply.code(404).send({ error: 'inventory_part_or_branch_not_found' });
      if (code === '22023') return reply.code(400).send({ error: 'invalid_movement' });
      throw e;
    }
  });
}
