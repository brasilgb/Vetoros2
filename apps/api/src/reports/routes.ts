import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthService, AuthSession } from '../auth/service.js';
import { requirePermission } from '../auth/service.js';

const filters = z.object({ from: z.string().date().optional(), to: z.string().date().optional() }).strict();
type ReportFilters = { from: string; to: string };
type ReportSummary = {
  period: ReportFilters;
  serviceOrders: { total: number; completed: number; canceled: number; amount: string | number; byStatus: Array<{ status: string; total: number }> };
  sales: { total: number; canceled: number; amount: string | number };
  customers: { total: number; individuals: number; companies: number };
  stockMovements: Array<{ type: string; quantity: string | number; movements: number }>;
};

export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function reportLoader(service: AuthService) {
  return (session: AuthSession, period: ReportFilters): Promise<ReportSummary> => service.withAuthenticatedTenant(session, async (tx) => {
    const { from, to } = period;
    const [orders] = await tx.execute<{ total: number; completed: number; canceled: number; amount: string | number }>(sql`select count(distinct o.id)::int as total, count(distinct o.id) filter (where o.status='completed')::int as completed, count(distinct o.id) filter (where o.status='canceled')::int as canceled, coalesce(sum(i.total_amount),0) as amount from service_orders o left join service_order_items i on i.service_order_id=o.id where o.company_id=${session.activeCompanyId} and o.branch_id=${session.activeBranchId} and o.opened_at >= ${from}::date and o.opened_at < ${to}::date`);
    const orderStatus = await tx.execute<{ status: string; total: number }>(sql`select status, count(*)::int as total from service_orders where company_id=${session.activeCompanyId} and branch_id=${session.activeBranchId} and opened_at >= ${from}::date and opened_at < ${to}::date group by status order by status`);
    const [sales] = await tx.execute<{ total: number; canceled: number; amount: string | number }>(sql`select count(distinct s.id) filter (where s.status='confirmed')::int as total, count(distinct s.id) filter (where s.status='cancelled')::int as canceled, coalesce(sum(i.total) filter (where s.status='confirmed'),0) as amount from sales s left join sale_items i on i.sale_id=s.id where s.company_id=${session.activeCompanyId} and s.branch_id=${session.activeBranchId} and s.sale_date >= ${from}::date and s.sale_date < ${to}::date`);
    const [customers] = await tx.execute<{ total: number; individuals: number; companies: number }>(sql`select count(*)::int as total, count(*) filter (where person_type='individual')::int as individuals, count(*) filter (where person_type='company')::int as companies from customers where created_at >= ${from}::date and created_at < ${to}::date`);
    const stock = await tx.execute<{ type: string; quantity: string | number; movements: number }>(sql`select type, coalesce(sum(quantity),0) as quantity, count(*)::int as movements from stock_movements where company_id=${session.activeCompanyId} and branch_id=${session.activeBranchId} and created_at >= ${from}::date and created_at < ${to}::date group by type order by type`);
    return { period, serviceOrders: { ...orders!, byStatus: [...orderStatus] }, sales: sales!, customers: customers!, stockMovements: [...stock] };
  });
}

function toCsv(report: ReportSummary) {
  const rows: unknown[][] = [['secao', 'metrica', 'rotulo', 'valor', 'from', 'to']];
  const add = (section: string, metric: string, label: string, value: unknown) => rows.push([section, metric, label, value, report.period.from, report.period.to]);
  add('ordens_servico', 'total', 'Total de OS', report.serviceOrders.total);
  add('ordens_servico', 'concluidas', 'OS concluídas', report.serviceOrders.completed);
  add('ordens_servico', 'canceladas', 'OS canceladas', report.serviceOrders.canceled);
  add('ordens_servico', 'valor', 'Valor canônico das OS', report.serviceOrders.amount);
  for (const item of report.serviceOrders.byStatus) add('ordens_servico_status', 'quantidade', item.status, item.total);
  add('vendas', 'confirmadas', 'Vendas confirmadas', report.sales.total);
  add('vendas', 'canceladas', 'Vendas canceladas', report.sales.canceled);
  add('vendas', 'valor', 'Valor canônico das vendas', report.sales.amount);
  add('clientes', 'total', 'Clientes cadastrados', report.customers.total);
  add('clientes', 'pf', 'Pessoas físicas', report.customers.individuals);
  add('clientes', 'pj', 'Pessoas jurídicas', report.customers.companies);
  for (const item of report.stockMovements) {
    add('estoque', 'quantidade', item.type, item.quantity);
    add('estoque', 'movimentos', item.type, item.movements);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function registerReportRoutes(app: FastifyInstance, service: AuthService) {
  const load = reportLoader(service);
  async function auth(req: FastifyRequest, reply: FastifyReply) {
    const session = await service.session(req.cookies.vetoros_session);
    if (!session) { reply.code(401).send({ error: 'unauthorized' }); return; }
    if (!session.activeTenantId) { reply.code(409).send({ error: 'tenant_required' }); return; }
    if (!session.activeCompanyId || !session.activeBranchId) { reply.code(409).send({ error: 'operational_context_required' }); return; }
    try { await requirePermission(service, session, 'reports.read'); return session; } catch { reply.code(403).send({ error: 'forbidden' }); }
  }
  function parse(query: unknown, reply: FastifyReply): ReportFilters | undefined {
    const parsed = filters.safeParse(query);
    if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from >= parsed.data.to)) { reply.code(400).send({ error: 'invalid_request' }); return; }
    return { from: parsed.data.from ?? '1900-01-01', to: parsed.data.to ?? '9999-12-31' };
  }
  app.get('/reports/summary', async (req, reply) => {
    const period = parse(req.query, reply); if (!period) return;
    const session = await auth(req, reply); if (!session) return;
    return load(session, period);
  });
  app.get('/reports/export.csv', async (req, reply) => {
    const period = parse(req.query, reply); if (!period) return;
    const session = await auth(req, reply); if (!session) return;
    const report = await load(session, period);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="vetoros-relatorio-${period.from}-${period.to}.csv"`).send(toCsv(report));
  });
}
