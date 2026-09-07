'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { CalendarClock, PlusCircle, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { SearchToolbar } from '../../../components/search-toolbar';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge, type StatusTone } from '../../../components/status-badge';
import { FormDialog } from '../../../components/form-dialog';
import { FormField, formFieldClass } from '../../../components/form-section';
import { EntityCombobox } from '../../../components/entity-combobox';
import { friendlyError } from '../../../components/error-state';
import { RequireOperationalContext } from '../../../components/require-operational-context';
import { useOperationalContext } from '../../../components/operational-context';
import { useDebouncedValue } from '../../../lib/use-debounced-value';
import { formatCurrency, formatDate } from '../../../lib/format';
import { searchConfirmedSales, searchCustomers, searchOpenServiceOrders, type CustomerOption, type SaleOption, type ServiceOrderOption } from '../../../lib/entity-search';

type Receivable = {
  id: string; due_date: string; installment_number: number; installment_count: number; customer_name: string;
  origin: 'sale' | 'service_order'; sale_number: number | null; service_order_number: number | null;
  original_amount: string; paid_amount: string; balance: string; derived_status: 'open' | 'partial' | 'paid' | 'overdue' | 'canceled';
};
const PAGE_SIZE = 20;
const statusLabels: Record<Receivable['derived_status'], { label: string; tone: StatusTone }> = {
  open: { label: 'Em aberto', tone: 'info' }, partial: { label: 'Parcial', tone: 'warning' }, paid: { label: 'Quitado', tone: 'success' },
  overdue: { label: 'Atrasado', tone: 'danger' }, canceled: { label: 'Cancelado', tone: 'neutral' },
};
const originLabel = (row: Receivable) => (row.origin === 'sale' ? `Venda #${row.sale_number}` : `OS #${row.service_order_number}`);

// FIN-02, seção 17/18 do correio.md: tabela operacional com vencimento/cliente/origem/valor
// original/valor recebido/saldo/status, filtros de período (vencimento)/cliente/origem/status/
// busca. "Filial" não é filtro aqui pelo mesmo motivo de Recebimentos (FIN-01): a listagem já é
// escopada à filial ativa pelo contexto operacional do cabeçalho.
export default function ReceivablesPage() {
  return (
    <RequireOperationalContext>
      <Suspense fallback={<p className="text-sm text-emerald-100/60">Carregando…</p>}>
        <ReceivablesPageContent />
      </Suspense>
    </RequireOperationalContext>
  );
}

type OriginType = 'sale' | 'service_order';
type InstallmentRow = { amount: string; dueDate: string };

function ReceivablesPageContent() {
  const router = useRouter();
  const { hasFullContext } = useOperationalContext();
  const [rows, setRows] = useState<Receivable[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [origin, setOrigin] = useState('');
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [period, setPeriod] = useState<'' | 'overdue' | '7d' | '30d' | 'custom'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const debouncedQ = useDebouncedValue(q);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [originType, setOriginType] = useState<OriginType>('sale');
  const [sale, setSale] = useState<SaleOption | null>(null);
  const [serviceOrder, setServiceOrder] = useState<ServiceOrderOption | null>(null);
  const [originTotal, setOriginTotal] = useState<number | null>(null);
  const [alreadyReceived, setAlreadyReceived] = useState(0);
  const [installments, setInstallments] = useState<InstallmentRow[]>([{ amount: '', dueDate: '' }]);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const activeFilterCount = [debouncedQ, status, origin, customer, period].filter(Boolean).length;
  const clearFilters = useCallback(() => { setQ(''); setStatus(''); setOrigin(''); setCustomer(null); setPeriod(''); setFrom(''); setTo(''); }, []);

  const load = useCallback(async (targetPage: number) => {
    setState('loading');
    const query = new URLSearchParams({
      page: String(targetPage), pageSize: String(PAGE_SIZE),
      ...(debouncedQ ? { q: debouncedQ } : {}), ...(status ? { status } : {}), ...(origin ? { origin } : {}), ...(customer ? { customerId: customer.id } : {}),
      ...(period === 'overdue' ? { to: today } : {}),
      ...(period === '7d' ? { from: today, to: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) } : {}),
      ...(period === '30d' ? { from: today, to: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) } : {}),
      ...(period === 'custom' && from ? { from } : {}), ...(period === 'custom' && to ? { to } : {}),
    });
    const response = await api(`/receivables?${query}`);
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) {
      setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar as contas a receber.'));
      return setState('error');
    }
    const body = await response.json();
    setRows(body.items); setTotal(body.total); setPage(targetPage); setState('ready');
  }, [debouncedQ, status, origin, customer, period, from, to, today, router]);

  useEffect(() => { if (hasFullContext) void load(1); }, [load, hasFullContext]);

  const openDialog = useCallback(() => {
    setDialogError(''); setOriginType('sale'); setSale(null); setServiceOrder(null); setOriginTotal(null); setAlreadyReceived(0);
    setInstallments([{ amount: '', dueDate: '' }]);
    setDialogOpen(true);
  }, []);

  // Ao escolher a origem, busca o total (venda/OS) e o que já foi recebido diretamente para ela
  // (seção 6 do correio.md — "entrada/sinal"), para orientar visualmente o operador sobre quanto
  // ainda precisa ser parcelado. A validação de verdade (a soma bater exatamente) é sempre feita
  // pelo backend em `generate_receivables` — isto aqui é só apoio visual.
  useEffect(() => {
    async function loadOrigin() {
      if (originType === 'sale' && sale) {
        const [detail, payments] = await Promise.all([api(`/sales/${sale.id}`), api(`/payments?saleId=${sale.id}&pageSize=100`)]);
        const detailBody = detail.ok ? await detail.json() : null;
        const paymentsBody = payments.ok ? await payments.json() : { items: [] };
        setOriginTotal(detailBody ? Number(detailBody.total) : null);
        setAlreadyReceived(paymentsBody.items.filter((p: { refunded: boolean }) => !p.refunded).reduce((n: number, p: { amount: string }) => n + Number(p.amount), 0));
      } else if (originType === 'service_order' && serviceOrder) {
        const [detail, payments] = await Promise.all([api(`/service-orders/${serviceOrder.id}`), api(`/payments?serviceOrderId=${serviceOrder.id}&pageSize=100`)]);
        const detailBody = detail.ok ? await detail.json() : null;
        const paymentsBody = payments.ok ? await payments.json() : { items: [] };
        setOriginTotal(detailBody ? Number(detailBody.total) : null);
        setAlreadyReceived(paymentsBody.items.filter((p: { refunded: boolean }) => !p.refunded).reduce((n: number, p: { amount: string }) => n + Number(p.amount), 0));
      } else {
        setOriginTotal(null); setAlreadyReceived(0);
      }
    }
    void loadOrigin();
  }, [originType, sale, serviceOrder]);

  const installmentsTotal = installments.reduce((n, i) => n + (Number(i.amount) || 0), 0);
  const remaining = originTotal !== null ? Number((originTotal - alreadyReceived).toFixed(2)) : null;
  const sumMatches = remaining !== null && Math.abs(installmentsTotal - remaining) < 0.005;

  function addInstallment() { setInstallments((prev) => [...prev, { amount: '', dueDate: '' }]); }
  function removeInstallment(index: number) { setInstallments((prev) => prev.filter((_, i) => i !== index)); }
  function updateInstallment(index: number, field: keyof InstallmentRow, value: string) {
    setInstallments((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (originType === 'sale' && !sale) return setDialogError('Selecione uma venda confirmada.');
    if (originType === 'service_order' && !serviceOrder) return setDialogError('Selecione uma ordem de serviço.');
    if (!sumMatches) return setDialogError('A soma das parcelas precisa fechar exatamente com o valor a financiar.');
    setDialogBusy(true); setDialogError('');
    const response = await api('/receivables/generate', { method: 'POST', body: JSON.stringify({
      saleId: originType === 'sale' ? sale?.id : null, serviceOrderId: originType === 'service_order' ? serviceOrder?.id : null,
      installments: installments.map((i) => ({ amount: Number(i.amount), dueDate: i.dueDate })),
    }) });
    setDialogBusy(false);
    if (!response.ok) return setDialogError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível gerar o parcelamento.'));
    setDialogOpen(false);
    void load(1);
  }

  const columns: DataTableColumn<Receivable>[] = [
    { key: 'due_date', header: 'Vencimento', render: (row) => formatDate(row.due_date) },
    { key: 'customer', header: 'Cliente', render: (row) => row.customer_name },
    { key: 'origin', header: 'Origem', render: (row) => `${originLabel(row)} · ${row.installment_number}/${row.installment_count}`, hideBelow: 'sm' },
    { key: 'original', header: 'Valor', align: 'right', render: (row) => formatCurrency(row.original_amount), hideBelow: 'sm' },
    { key: 'balance', header: 'Saldo', align: 'right', render: (row) => formatCurrency(row.balance) },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge tone={statusLabels[row.derived_status].tone}>{statusLabels[row.derived_status].label}</StatusBadge> },
  ];

  return (
    <>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Contas a Receber"
          description="Parcelas e vencimentos gerados a partir de vendas e ordens de serviço."
          action={
            <button onClick={openDialog} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
              <PlusCircle className="h-4 w-4" /> Gerar parcelamento
            </button>
          }
        >
          <SearchToolbar value={q} onChange={setQ} placeholder="Número, cliente…">
            <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
              <option value="">Qualquer vencimento</option>
              <option value="overdue">Até hoje</option>
              <option value="7d">Próximos 7 dias</option>
              <option value="30d">Próximos 30 dias</option>
              <option value="custom">Intervalo personalizado</option>
            </select>
            {period === 'custom' && (
              <>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100" />
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100" />
              </>
            )}
            <div className="w-52"><EntityCombobox value={customer} onChange={setCustomer} search={searchCustomers} getId={(c) => c.id} getLabel={(c) => c.legal_name} renderOption={(c) => <span>{c.legal_name}</span>} id="receivables-customer" placeholder="Cliente…" /></div>
            <select value={origin} onChange={(e) => setOrigin(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
              <option value="">Todas as origens</option>
              <option value="sale">Venda</option>
              <option value="service_order">Ordem de Serviço</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
              <option value="">Todos os status</option>
              <option value="open">Em aberto</option>
              <option value="partial">Parcial</option>
              <option value="paid">Quitado</option>
              <option value="overdue">Atrasado</option>
              <option value="canceled">Cancelado</option>
            </select>
            {activeFilterCount > 0 && (
              <button type="button" onClick={clearFilters} className="rounded-xl border border-emerald-800 px-3 py-2.5 text-sm text-emerald-100 hover:bg-emerald-950">
                Limpar {activeFilterCount} filtro{activeFilterCount > 1 ? 's' : ''}
              </button>
            )}
          </SearchToolbar>
        </PageHeader>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          state={state}
          onRowClick={(row) => router.push(`/app/receivables/${row.id}`)}
          onRetry={() => load(page)}
          errorMessage={errorMessage}
          emptyState={
            activeFilterCount > 0 ? (
              <EmptyState icon={CalendarClock} title="Nenhum título encontrado" description="Nenhuma conta a receber corresponde aos filtros atuais." action={<button onClick={clearFilters} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar filtros</button>} />
            ) : (
              <EmptyState icon={CalendarClock} title="Nenhuma conta a receber" description="Gere o parcelamento de uma venda confirmada ou ordem de serviço para começar." action={<button onClick={openDialog} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">Gerar parcelamento</button>} />
            )
          }
        />
        <DataTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={load} />

        <FormDialog open={dialogOpen} title="Gerar parcelamento" description="A soma das parcelas precisa fechar exatamente com o valor ainda não recebido da origem." submitLabel="Gerar" busy={dialogBusy} error={dialogError} onSubmit={handleSubmit} onCancel={() => setDialogOpen(false)}>
          <FormField label="Origem" htmlFor="rec-origin">
            <select id="rec-origin" value={originType} onChange={(e) => { setOriginType(e.target.value as OriginType); setSale(null); setServiceOrder(null); }} className={formFieldClass}>
              <option value="sale">Venda confirmada</option>
              <option value="service_order">Ordem de Serviço</option>
            </select>
          </FormField>
          {originType === 'sale' ? (
            <FormField label="Venda" htmlFor="rec-sale" span="full">
              <EntityCombobox value={sale} onChange={setSale} search={searchConfirmedSales} getId={(item) => item.id} getLabel={(item) => `Venda #${item.sale_number}`} renderOption={(item) => <span>Venda #{item.sale_number} {item.customer_name ? `— ${item.customer_name}` : ''}</span>} id="rec-sale" placeholder="Buscar venda confirmada…" />
            </FormField>
          ) : (
            <FormField label="Ordem de Serviço" htmlFor="rec-so" span="full">
              <EntityCombobox value={serviceOrder} onChange={setServiceOrder} search={searchOpenServiceOrders} getId={(item) => item.id} getLabel={(item) => `OS #${item.order_number}`} renderOption={(item) => <span>OS #{item.order_number} {item.customer_name ? `— ${item.customer_name}` : ''}</span>} id="rec-so" placeholder="Buscar ordem de serviço…" />
            </FormField>
          )}
          {originTotal !== null && (
            <FormField label="Resumo" htmlFor="rec-summary" span="full">
              <p id="rec-summary" className="mt-1 rounded-xl border border-emerald-800 bg-emerald-950 p-3 text-sm text-emerald-100/80">
                Total da origem: {formatCurrency(originTotal)} · Já recebido: {formatCurrency(alreadyReceived)} · A financiar: <strong className="text-emerald-50">{formatCurrency(remaining ?? 0)}</strong>
              </p>
            </FormField>
          )}
          <FormField label="Parcelas" htmlFor="rec-installments" span="full" helperText={remaining !== null ? `Soma atual: ${formatCurrency(installmentsTotal)} de ${formatCurrency(remaining)}` : undefined}>
            <div className="mt-1 flex flex-col gap-2">
              {installments.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input type="number" min="0.01" step="0.01" required placeholder="Valor (R$)" value={row.amount} onChange={(e) => updateInstallment(index, 'amount', e.target.value)} className={formFieldClass} />
                  <input type="date" required value={row.dueDate} onChange={(e) => updateInstallment(index, 'dueDate', e.target.value)} className={formFieldClass} />
                  <button type="button" onClick={() => removeInstallment(index)} disabled={installments.length === 1} className="rounded-lg p-2 text-red-300 hover:bg-red-950/40 disabled:opacity-30" aria-label="Remover parcela">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addInstallment} className="self-start rounded-xl border border-emerald-800 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-950">+ Parcela</button>
            </div>
          </FormField>
        </FormDialog>
      </div>
    </>
  );
}
