// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthService, AuthSession, ResourceScope } from '../auth/service.js';
import { requirePermission } from '../auth/service.js';
import type { FiscalAddress, FiscalIssuePayload, FiscalProvider, FiscalProviderResult } from './provider.js';

const id = z.string().uuid();
const params = z.object({ id });
const documentTypes = ['nfce', 'nfe', 'nfse'] as const;
const statuses = ['draft', 'pending', 'authorized', 'rejected', 'cancellation_pending', 'cancelled'] as const;
const createSchema = z.object({ saleId: id.nullable().optional(), serviceOrderId: id.nullable().optional(), documentType: z.enum(documentTypes) }).strict();
const listSchema = z.object({ status: z.enum(statuses).optional(), documentType: z.enum(documentTypes).optional(), origin: z.enum(['sale', 'service_order']).optional(), q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict();
const cancelSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
const scope = (s: AuthSession): ResourceScope => (s.activeBranchId ? { companyId: s.activeCompanyId!, branchId: s.activeBranchId } : s.activeCompanyId ? { companyId: s.activeCompanyId } : { requireTenant: true });
// Seção 11: máquina de estados espelhada aqui só para decidir o código HTTP certo (a fonte de
// verdade física é o trigger da migration 0034 — se um dia divergirem, o banco vence).
const issuable = new Set(['draft', 'rejected']);

function toFiscalAddress(row: { postal_code: string | null; street: string | null; number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null; country: string | null; ibge_city_code?: string | null } | undefined): FiscalAddress | null {
  if (!row?.street || !row.city) return null;
  return { postalCode: row.postal_code, street: row.street, number: row.number, complement: row.complement, district: row.district, city: row.city, state: row.state, country: row.country ?? 'BR', ibgeCityCode: row.ibge_city_code ?? null };
}

export function registerFiscalRoutes(app: FastifyInstance, service: AuthService, fiscalProvider: FiscalProvider) {
  async function auth(req: FastifyRequest, reply: FastifyReply) { const s = await service.session(req.cookies.vetoros_session); if (!s) { reply.code(401).send({ error: 'unauthorized' }); return; } if (!s.activeTenantId || !s.activeCompanyId || !s.activeBranchId) { reply.code(409).send({ error: 'operational_context_required' }); return; } return s; }
  async function allow(reply: FastifyReply, s: AuthSession, p: string) { try { await requirePermission(service, s, p, scope(s)); return true; } catch { reply.code(403).send({ error: 'forbidden' }); return false; } }

  async function documentDetail(s: AuthSession, documentId: string) {
    return service.withAuthenticatedTenant(s, async (tx) => {
      const [row] = await tx.execute(sql`select fd.*,co.legal_name company_name,b.name branch_name,sa.sale_number,so.order_number service_order_number from fiscal_documents fd join companies co on co.id=fd.company_id join branches b on b.id=fd.branch_id left join sales sa on sa.id=fd.origin_sale_id left join service_orders so on so.id=fd.origin_service_order_id where fd.id=${documentId}`);
      if (!row) return null;
      const items = await tx.execute(sql`select * from fiscal_document_items where fiscal_document_id=${documentId} order by created_at`);
      return { ...row, items };
    });
  }

  // Aplica o resultado de uma chamada ao provedor (issue ou consult) — nunca faz a chamada de
  // rede em si (isso já aconteceu antes de chegar aqui). O guard `where status in (...)` evita
  // aplicar duas vezes o mesmo resultado sob concorrência (seção 22) sem precisar segurar lock
  // de linha durante o I/O externo — só a escrita final, que é rápida, precisa de proteção.
  async function applyProviderResult(s: AuthSession, documentId: string, result: FiscalProviderResult) {
    if (result.outcome === 'authorized') {
      const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`update fiscal_documents set status='authorized',series=coalesce(${result.series ?? null},series),document_number=coalesce(${result.documentNumber ?? null},document_number),access_key=coalesce(${result.accessKey ?? null},access_key),protocol=coalesce(${result.protocol ?? null},protocol),xml_url=coalesce(${result.xmlUrl ?? null},xml_url),pdf_url=coalesce(${result.pdfUrl ?? null},pdf_url),external_id=coalesce(${result.externalId ?? null},external_id),authorized_at=now(),updated_at=now() where id=${documentId} and status='pending' returning *`));
      if (row) await service.auditResource(s, 'fiscal_document.authorized', 'fiscal_document', documentId, { accessKey: result.accessKey });
      return { httpStatus: 200, body: row ?? (await documentDetail(s, documentId)) };
    }
    if (result.outcome === 'rejected') {
      const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`update fiscal_documents set status='rejected',rejection_reason=${result.reason},external_id=coalesce(${result.externalId ?? null},external_id),rejected_at=now(),updated_at=now() where id=${documentId} and status='pending' returning *`));
      if (row) await service.auditResource(s, 'fiscal_document.rejected', 'fiscal_document', documentId, { reason: result.reason });
      return { httpStatus: 200, body: row ?? (await documentDetail(s, documentId)) };
    }
    if (result.outcome === 'pending') {
      await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`update fiscal_documents set external_id=coalesce(${result.externalId ?? null},external_id),updated_at=now() where id=${documentId}`));
      return { httpStatus: 202, body: await documentDetail(s, documentId) };
    }
    await service.auditResource(s, 'fiscal_document.provider_error', 'fiscal_document', documentId, { message: result.message });
    return { httpStatus: 502, body: { error: 'fiscal_provider_error', message: result.message } };
  }

  async function buildIssuePayload(s: AuthSession, doc: Record<string, unknown>, items: Array<Record<string, unknown>>): Promise<FiscalIssuePayload> {
    const [company] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select legal_name,trade_name,tax_id_normalized,state_registration,municipal_registration,cnae,tax_regime,postal_code,street,address_number,address_complement,district,city,state,country from companies where id=${doc.company_id}`));
    const [branch] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select postal_code,street,address_number,address_complement,district,city,state,country,ibge_city_code from branches where id=${doc.branch_id}`));
    const issuerAddress = toFiscalAddress({ postal_code: branch?.postal_code ?? company?.postal_code, street: branch?.street ?? company?.street, number: branch?.address_number ?? company?.address_number, complement: branch?.address_complement ?? company?.address_complement, district: branch?.district ?? company?.district, city: branch?.city ?? company?.city, state: branch?.state ?? company?.state, country: branch?.country ?? company?.country, ibge_city_code: branch?.ibge_city_code }) ?? { postalCode: null, street: '', number: null, complement: null, district: null, city: '', state: null, country: 'BR', ibgeCityCode: null };
    return {
      environment: doc.environment as 'homologacao' | 'producao',
      documentType: doc.document_type as 'nfce' | 'nfe' | 'nfse',
      externalRef: doc.idempotency_key as string,
      issuer: { cnpj: company!.tax_id_normalized, stateRegistration: company!.state_registration, municipalRegistration: company!.municipal_registration, legalName: company!.legal_name, tradeName: company!.trade_name, cnae: company!.cnae, taxRegime: company!.tax_regime, address: issuerAddress },
      recipient: { personType: doc.recipient_person_type as 'individual' | 'company', document: doc.recipient_document as string | null, documentType: doc.recipient_document_type as string | null, legalName: doc.recipient_legal_name as string, email: doc.recipient_email as string | null, address: (doc.recipient_address as FiscalAddress | null) ?? null },
      items: items.map((item) => ({ description: item.description as string, quantity: Number(item.quantity), unitPrice: Number(item.unit_price), ncm: item.ncm as string | null, cest: item.cest as string | null, origin: item.origin as string | null, cfop: item.cfop as string | null, taxSituation: item.tax_situation as string | null, serviceCode: item.service_code as string | null, issRate: item.iss_rate === null ? null : Number(item.iss_rate) })),
      totals: { subtotal: Number(doc.subtotal), discountTotal: Number(doc.discount_total), total: Number(doc.total) },
    };
  }

  app.get('/fiscal-documents', async (req, reply) => {
    const q = listSchema.safeParse(req.query); if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'fiscal.read')) return;
    const offset = (q.data.page - 1) * q.data.pageSize, term = q.data.q ? `%${q.data.q}%` : null;
    const rows = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`
      select fd.*,sa.sale_number,so.order_number service_order_number,count(*) over()::int total
      from fiscal_documents fd left join sales sa on sa.id=fd.origin_sale_id left join service_orders so on so.id=fd.origin_service_order_id
      where fd.branch_id=${s.activeBranchId!}
        and (${q.data.status ?? null}::text is null or fd.status=${q.data.status ?? null})
        and (${q.data.documentType ?? null}::text is null or fd.document_type=${q.data.documentType ?? null})
        and (${q.data.origin ?? null}::text is null or (${q.data.origin ?? null}='sale' and fd.origin_sale_id is not null) or (${q.data.origin ?? null}='service_order' and fd.origin_service_order_id is not null))
        and (${term}::text is null or fd.recipient_legal_name ilike ${term} or fd.recipient_document ilike ${term} or fd.document_number::text ilike ${term} or sa.sale_number::text ilike ${term} or so.order_number::text ilike ${term})
      order by fd.created_at desc limit ${q.data.pageSize} offset ${offset}`));
    return { items: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'total'))), page: q.data.page, pageSize: q.data.pageSize, total: Number(rows[0]?.total ?? 0) };
  });

  app.get('/fiscal-documents/:id', async (req, reply) => {
    const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'fiscal.read')) return;
    return await documentDetail(s, p.data.id) ?? reply.code(404).send({ error: 'not_found' });
  });

  // Criação (seção 9/10): snapshot completo no momento em que o documento nasce, a partir de
  // uma venda confirmada ou de uma OS concluída/entregue (seção 5: aprovação de orçamento nunca
  // é confundida com faturamento — a OS precisa ter chegado ao ponto de entrega real do
  // serviço). Nada aqui é editável depois — é o trigger de imutabilidade (migration 0034) quem
  // garante isso fisicamente, não só a ausência de rota PATCH.
  app.post('/fiscal-documents', async (req, reply) => {
    const b = createSchema.safeParse(req.body);
    if (!b.success || (b.data.saleId && b.data.serviceOrderId) || (!b.data.saleId && !b.data.serviceOrderId)) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'fiscal.create')) return;
    const result = await service.withAuthenticatedTenant(s, async (tx) => {
      const [company] = await tx.execute(sql`select fiscal_environment from companies where id=${s.activeCompanyId!}`);
      let customerId: string, companyId = s.activeCompanyId!, branchId = s.activeBranchId!, subtotal: number, discountTotal: number, total: number;
      let lineItems: Array<{ description: string; quantity: string; unit_price: string; total: string; inventory_part_id: string | null }>;
      if (b.data.saleId) {
        const [sale] = await tx.execute(sql`select * from sales where id=${b.data.saleId}`);
        if (!sale) return 'origin_not_found';
        if (sale.status !== 'confirmed') return 'origin_not_ready';
        customerId = sale.customer_id; companyId = sale.company_id; branchId = sale.branch_id;
        subtotal = Number(sale.subtotal); discountTotal = Number(sale.discount_total); total = Number(sale.total);
        lineItems = await tx.execute(sql`select description,quantity,unit_price,total,inventory_part_id from sale_items where sale_id=${b.data.saleId} order by created_at`);
      } else {
        const [order] = await tx.execute(sql`select * from service_orders where id=${b.data.serviceOrderId}`);
        if (!order) return 'origin_not_found';
        if (!['completed', 'delivered'].includes(order.status)) return 'origin_not_ready';
        if (!order.customer_id) return 'origin_not_ready';
        customerId = order.customer_id; companyId = order.company_id; branchId = order.branch_id;
        const items = await tx.execute(sql`select description,quantity,unit_price,total_amount total,null::uuid inventory_part_id from service_order_items where service_order_id=${b.data.serviceOrderId} order by created_at`);
        lineItems = items;
        subtotal = lineItems.reduce((n, i) => n + Number(i.total), 0); discountTotal = 0; total = subtotal;
      }
      if (!customerId) return 'customer_required';
      if (!lineItems.length) return 'origin_has_no_items';
      const [customer] = await tx.execute(sql`select person_type,document_type,document_normalized,legal_name,email from customers where id=${customerId}`);
      const [address] = await tx.execute(sql`select postal_code,street,number,complement,district,city,state,country from customer_addresses where customer_id=${customerId} and is_primary limit 1`);
      const recipientAddress = toFiscalAddress(address);
      const recipientAddressJson = recipientAddress ? JSON.stringify(recipientAddress) : null;
      // Peças envolvidas nesta origem, via subquery (nunca monta literal de array manualmente —
      // mesmo padrão do resto do projeto: `id in (select ...)`, não interpolação de string).
      const parts = b.data.saleId
        ? await tx.execute(sql`select id,ncm,cest,origin,default_cfop from inventory_parts where id in (select inventory_part_id from sale_items where sale_id=${b.data.saleId} and inventory_part_id is not null)`)
        : await tx.execute(sql`select id,ncm,cest,origin,default_cfop from inventory_parts where id in (select inventory_part_id from service_order_items where service_order_id=${b.data.serviceOrderId} and inventory_part_id is not null)`);
      const partsById = new Map(parts.map((p) => [p.id, p]));
      const idempotencyKey = `fd-${randomUUID()}`;
      const [document] = await tx.execute(sql`insert into fiscal_documents(tenant_id,company_id,branch_id,origin_sale_id,origin_service_order_id,document_type,status,environment,recipient_person_type,recipient_document_type,recipient_document,recipient_legal_name,recipient_email,recipient_address,subtotal,discount_total,total,idempotency_key,created_by_identity_id,updated_by_identity_id) values(${s.activeTenantId!},${companyId},${branchId},${b.data.saleId ?? null},${b.data.serviceOrderId ?? null},${b.data.documentType},'draft',${company?.fiscal_environment ?? 'homologacao'},${customer!.person_type},${customer!.document_type},${customer!.document_normalized},${customer!.legal_name},${customer!.email},${recipientAddressJson}::jsonb,${subtotal},${discountTotal},${total},${idempotencyKey},${s.identityId},${s.identityId}) returning *`);
      for (const item of lineItems) {
        const part = item.inventory_part_id ? partsById.get(item.inventory_part_id) : undefined;
        await tx.execute(sql`insert into fiscal_document_items(tenant_id,fiscal_document_id,description,quantity,unit_price,ncm,cest,origin,cfop) values(${s.activeTenantId!},${document!.id},${item.description},${item.quantity},${item.unit_price},${part?.ncm ?? null},${part?.cest ?? null},${part?.origin ?? null},${part?.default_cfop ?? null})`);
      }
      return document;
    });
    if (result === 'origin_not_found') return reply.code(404).send({ error: 'origin_not_found' });
    if (result === 'origin_not_ready') return reply.code(409).send({ error: 'origin_not_ready_for_fiscal_document' });
    if (result === 'customer_required') return reply.code(409).send({ error: 'origin_requires_customer' });
    if (result === 'origin_has_no_items') return reply.code(400).send({ error: 'origin_has_no_items' });
    await service.auditResource(s, 'fiscal_document.created', 'fiscal_document', result.id, { saleId: b.data.saleId, serviceOrderId: b.data.serviceOrderId, documentType: b.data.documentType });
    return reply.code(201).send(await documentDetail(s, result.id));
  });

  // Emissão (seção 16/21/22): fase 1 reivindica atomicamente (lock rápido, sem rede) — uma
  // segunda tentativa concorrente encontra o documento já `pending` e nunca chega a acionar o
  // provedor. Fase 2 chama o provedor fora de qualquer transação (uma chamada de rede não deve
  // segu002rar lock de linha) e aplica o resultado com o mesmo guard idempotente de
  // `applyProviderResult`.
  app.post('/fiscal-documents/:id/issue', async (req, reply) => {
    const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'fiscal.issue')) return;
    const claimed = await service.withAuthenticatedTenant(s, async (tx) => {
      const [doc] = await tx.execute(sql`select * from fiscal_documents where id=${p.data.id} for update`);
      if (!doc) return 'missing';
      if (doc.status === 'pending') return 'already_pending';
      if (!issuable.has(doc.status)) return 'transition';
      const items = await tx.execute(sql`select 1 from fiscal_document_items where fiscal_document_id=${p.data.id} limit 1`);
      if (!items.length) return 'empty';
      const [updated] = await tx.execute(sql`update fiscal_documents set status='pending',requested_at=now(),rejection_reason=null,updated_by_identity_id=${s.identityId},updated_at=now() where id=${p.data.id} returning *`);
      return updated;
    });
    if (claimed === 'missing') return reply.code(404).send({ error: 'not_found' });
    if (claimed === 'transition') return reply.code(409).send({ error: 'invalid_status_transition' });
    if (claimed === 'already_pending') return reply.code(409).send({ error: 'issuance_already_in_progress' });
    if (claimed === 'empty') return reply.code(400).send({ error: 'fiscal_document_has_no_items' });
    await service.auditResource(s, 'fiscal_document.issue_requested', 'fiscal_document', p.data.id, {});
    const items = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select * from fiscal_document_items where fiscal_document_id=${p.data.id} order by created_at`));
    const payload = await buildIssuePayload(s, claimed, items);
    const result = await fiscalProvider.issue(payload);
    const { httpStatus, body } = await applyProviderResult(s, p.data.id, result);
    return reply.code(httpStatus).send(body);
  });

  // Reconciliação (seção 20): consulta o provedor pelo estado real quando o documento ficou
  // `pending` (timeout, resposta desconhecida, provedor indisponível na hora da emissão) — nunca
  // assume que "não sabemos" significa "não foi emitido".
  app.post('/fiscal-documents/:id/consult', async (req, reply) => {
    const p = params.safeParse(req.params); if (!p.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'fiscal.issue')) return;
    const doc = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`select * from fiscal_documents where id=${p.data.id}`));
    if (!doc.length) return reply.code(404).send({ error: 'not_found' });
    if (doc[0].status !== 'pending') return reply.code(409).send({ error: 'invalid_status_transition' });
    const result = await fiscalProvider.consult(doc[0].idempotency_key, doc[0].document_type);
    const { httpStatus, body } = await applyProviderResult(s, p.data.id, result);
    return reply.code(httpStatus).send(body);
  });

  // Cancelamento (seção 19): nunca um `status='cancelled'` local puro — passa por
  // `cancellation_pending` e só vira `cancelled` quando o provedor confirma. Se o provedor
  // rejeitar o cancelamento, o documento volta para `authorized` (nunca fica preso num limbo)
  // e o motivo fica em `rejection_reason` (mesmo campo de rejeição de emissão — é sempre "o
  // último motivo que o provedor deu", nunca um segundo histórico paralelo).
  app.post('/fiscal-documents/:id/cancel', async (req, reply) => {
    const p = params.safeParse(req.params), b = cancelSchema.safeParse(req.body); if (!p.success || !b.success) return reply.code(400).send({ error: 'invalid_request' });
    const s = await auth(req, reply); if (!s || !await allow(reply, s, 'fiscal.cancel')) return;
    const claimed = await service.withAuthenticatedTenant(s, async (tx) => {
      const [doc] = await tx.execute(sql`select * from fiscal_documents where id=${p.data.id} for update`);
      if (!doc) return 'missing';
      if (doc.status === 'cancellation_pending') return doc;
      if (doc.status !== 'authorized') return 'transition';
      const [updated] = await tx.execute(sql`update fiscal_documents set status='cancellation_pending',cancellation_requested_at=now(),updated_by_identity_id=${s.identityId},updated_at=now() where id=${p.data.id} returning *`);
      return updated;
    });
    if (claimed === 'missing') return reply.code(404).send({ error: 'not_found' });
    if (claimed === 'transition') return reply.code(409).send({ error: 'invalid_status_transition' });
    await service.auditResource(s, 'fiscal_document.cancellation_requested', 'fiscal_document', p.data.id, { reason: b.data.reason });
    const cancelResult = await fiscalProvider.cancel(claimed.idempotency_key, claimed.document_type, b.data.reason);
    if (cancelResult.outcome === 'cancelled') {
      const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`update fiscal_documents set status='cancelled',cancelled_at=now(),updated_at=now() where id=${p.data.id} and status='cancellation_pending' returning *`));
      if (row) await service.auditResource(s, 'fiscal_document.cancelled', 'fiscal_document', p.data.id, { reason: b.data.reason });
      return reply.code(200).send(row ?? await documentDetail(s, p.data.id));
    }
    if (cancelResult.outcome === 'rejected') {
      const [row] = await service.withAuthenticatedTenant(s, (tx) => tx.execute(sql`update fiscal_documents set status='authorized',rejection_reason=${cancelResult.reason},updated_at=now() where id=${p.data.id} and status='cancellation_pending' returning *`));
      return reply.code(409).send({ error: 'cancellation_rejected_by_provider', reason: cancelResult.reason, document: row ?? await documentDetail(s, p.data.id) });
    }
    if (cancelResult.outcome === 'pending') return reply.code(202).send(await documentDetail(s, p.data.id));
    await service.auditResource(s, 'fiscal_document.provider_error', 'fiscal_document', p.data.id, { message: cancelResult.message });
    return reply.code(502).send({ error: 'fiscal_provider_error', message: cancelResult.message });
  });
}
