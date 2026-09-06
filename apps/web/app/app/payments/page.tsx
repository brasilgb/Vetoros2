'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { FormEvent } from 'react';
import { PlusCircle, Receipt } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { SearchToolbar } from '../../../components/search-toolbar';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge } from '../../../components/status-badge';
import { FormDialog } from '../../../components/form-dialog';
import { FormField, formFieldClass } from '../../../components/form-section';
import { EntityCombobox } from '../../../components/entity-combobox';
import { friendlyError } from '../../../components/error-state';
import { RequireOperationalContext } from '../../../components/require-operational-context';
import { useOperationalContext } from '../../../components/operational-context';
import { useDebouncedValue } from '../../../lib/use-debounced-value';
import { formatCurrency, formatDateTime } from '../../../lib/format';
import { searchConfirmedSales, searchOpenServiceOrders, type SaleOption, type ServiceOrderOption } from '../../../lib/entity-search';

type Payment = {
  id: string; created_at: string; amount: string; payment_method_name: string; origin: 'sale' | 'service_order' | 'none';
  sale_number: number | null; service_order_number: number | null; customer_name: string | null; refunded: boolean; created_by_name: string | null;
};
type Register = { id: string; name: string; status: string; current_session_id: string | null };
type PaymentMethod = { id: string; code: string; name: string };
const PAGE_SIZE = 20;
const originLabel = (row: Payment) => (row.origin === 'sale' ? `Venda #${row.sale_number}` : row.origin === 'service_order' ? `OS #${row.service_order_number}` : 'Avulso');

// FIN-01, seção 17 do correio.md: tabela operacional com data/origem/documento/cliente/forma de
// pagamento/valor/status/operador, filtros de período/forma de pagamento/origem/status/busca —
// sem UUID cru em nenhuma coluna. "Filial" não é um filtro nesta tela porque a listagem já é
// escopada à filial ativa (mesmo padrão de `inventory/movements` — o contexto Empresa/Filial no
// cabeçalho já é o seletor de filial do sistema inteiro).
export default function PaymentsPage() {
  return (
    <RequireOperationalContext>
      <Suspense fallback={<p className="text-sm text-emerald-100/60">Carregando…</p>}>
        <PaymentsPageContent />
      </Suspense>
    </RequireOperationalContext>
  );
}

function PaymentsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasFullContext } = useOperationalContext();
  const [rows, setRows] = useState<Payment[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const [q, setQ] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [origin, setOrigin] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState<'' | 'today' | '7d' | '30d' | 'custom'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const debouncedQ = useDebouncedValue(q);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [registers, setRegisters] = useState<Register[]>([]);
  const [cashSessionId, setCashSessionId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethodId2, setPaymentMethodId2] = useState('');
  const [originType, setOriginType] = useState<'none' | 'sale' | 'service_order'>('none');
  const [sale, setSale] = useState<SaleOption | null>(null);
  const [serviceOrder, setServiceOrder] = useState<ServiceOrderOption | null>(null);
  const [notes, setNotes] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const activeFilterCount = [debouncedQ, paymentMethodId, origin, status, period].filter(Boolean).length;
  const clearFilters = useCallback(() => { setQ(''); setPaymentMethodId(''); setOrigin(''); setStatus(''); setPeriod(''); setFrom(''); setTo(''); }, []);

  const load = useCallback(async (targetPage: number) => {
    setState('loading');
    const query = new URLSearchParams({
      page: String(targetPage), pageSize: String(PAGE_SIZE),
      ...(debouncedQ ? { q: debouncedQ } : {}), ...(paymentMethodId ? { paymentMethodId } : {}), ...(origin ? { origin } : {}), ...(status ? { status } : {}),
      ...(period === 'today' ? { from: today, to: today } : {}),
      ...(period === '7d' ? { from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), to: today } : {}),
      ...(period === '30d' ? { from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: today } : {}),
      ...(period === 'custom' && from ? { from } : {}), ...(period === 'custom' && to ? { to } : {}),
    });
    const response = await api(`/payments?${query}`);
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) {
      setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar os recebimentos.'));
      return setState('error');
    }
    const body = await response.json();
    setRows(body.items); setTotal(body.total); setPage(targetPage); setState('ready');
  }, [debouncedQ, paymentMethodId, origin, status, period, from, to, today, router]);

  useEffect(() => { if (hasFullContext) void load(1); }, [load, hasFullContext]);
  useEffect(() => { void api('/payment-methods').then((r) => r.ok && r.json()).then((items) => items && setMethods(items)); }, []);

  const openDialog = useCallback(async (preselectSessionId?: string) => {
    setDialogError(''); setAmount(''); setPaymentMethodId2(''); setOriginType('none'); setSale(null); setServiceOrder(null); setNotes('');
    setIdempotencyKey(crypto.randomUUID());
    const response = await api('/cash-registers');
    const items: Register[] = response.ok ? await response.json() : [];
    setRegisters(items);
    const open = items.filter((r) => r.current_session_id);
    setCashSessionId(preselectSessionId ?? open[0]?.current_session_id ?? '');
    setDialogOpen(true);
  }, []);

  // Dispara só na montagem (deep-link vindo da tela de Caixa, "Registrar recebimento") — não deve
  // reabrir o diálogo a cada mudança de referência de `openDialog`/`searchParams`.
  useEffect(() => {
    if (searchParams.get('new') === '1') void openDialog(searchParams.get('cashSessionId') ?? undefined);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cashSessionId) return setDialogError('Selecione um caixa aberto.');
    setDialogBusy(true); setDialogError('');
    const response = await api('/payments', { method: 'POST', body: JSON.stringify({
      cashSessionId, amount: Number(amount), paymentMethodId: paymentMethodId2,
      saleId: originType === 'sale' ? sale?.id ?? null : null, serviceOrderId: originType === 'service_order' ? serviceOrder?.id ?? null : null,
      notes: notes || null, idempotencyKey,
    }) });
    setDialogBusy(false);
    if (!response.ok) return setDialogError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível registrar o recebimento.'));
    setDialogOpen(false);
    router.replace('/app/payments');
    void load(1);
  }

  const openSessions = registers.filter((r) => r.current_session_id);
  const columns: DataTableColumn<Payment>[] = [
    { key: 'date', header: 'Data', render: (row) => formatDateTime(row.created_at) },
    { key: 'origin', header: 'Origem', render: (row) => originLabel(row) },
    { key: 'customer', header: 'Cliente', render: (row) => row.customer_name ?? '—', hideBelow: 'sm' },
    { key: 'method', header: 'Forma de pagamento', render: (row) => row.payment_method_name, hideBelow: 'sm' },
    { key: 'amount', header: 'Valor', align: 'right', render: (row) => formatCurrency(row.amount) },
    { key: 'status', header: 'Status', render: (row) => (row.refunded ? <StatusBadge tone="warning">Estornado</StatusBadge> : <StatusBadge tone="success">Ativo</StatusBadge>) },
    { key: 'operator', header: 'Operador', render: (row) => row.created_by_name ?? '—', hideBelow: 'md' },
  ];

  return (
    <>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Recebimentos"
          description="Recebimentos de dinheiro, PIX, cartão e outras formas de pagamento na filial ativa."
          action={
            <button onClick={() => void openDialog()} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
              <PlusCircle className="h-4 w-4" /> Novo recebimento
            </button>
          }
        >
          <SearchToolbar value={q} onChange={setQ} placeholder="Número, cliente, observação…">
            <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
              <option value="">Qualquer período</option>
              <option value="today">Hoje</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="custom">Intervalo personalizado</option>
            </select>
            {period === 'custom' && (
              <>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100" />
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100" />
              </>
            )}
            <select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
              <option value="">Todas as formas</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select value={origin} onChange={(e) => setOrigin(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
              <option value="">Todas as origens</option>
              <option value="sale">Venda</option>
              <option value="service_order">Ordem de Serviço</option>
              <option value="none">Avulso</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
              <option value="">Todos os status</option>
              <option value="active">Ativo</option>
              <option value="refunded">Estornado</option>
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
          onRowClick={(row) => router.push(`/app/payments/${row.id}`)}
          onRetry={() => load(page)}
          errorMessage={errorMessage}
          emptyState={
            activeFilterCount > 0 ? (
              <EmptyState icon={Receipt} title="Nenhum recebimento encontrado" description="Nenhum recebimento corresponde aos filtros atuais." action={<button onClick={clearFilters} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar filtros</button>} />
            ) : (
              <EmptyState icon={Receipt} title="Nenhum recebimento registrado" description="Registre o primeiro recebimento com um caixa aberto." action={<button onClick={() => void openDialog()} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">Novo recebimento</button>} />
            )
          }
        />
        <DataTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={load} />

        <FormDialog open={dialogOpen} title="Novo recebimento" submitLabel="Registrar" busy={dialogBusy} error={dialogError} onSubmit={handleSubmit} onCancel={() => setDialogOpen(false)}>
          {openSessions.length === 0 ? (
            <p className="text-sm text-amber-200">
              Nenhum caixa aberto nesta filial. <button type="button" onClick={() => router.push('/app/cash')} className="underline">Abra um caixa</button> antes de registrar um recebimento.
            </p>
          ) : (
            <>
              <FormField label="Caixa" htmlFor="payment-session">
                <select id="payment-session" required value={cashSessionId} onChange={(e) => setCashSessionId(e.target.value)} className={formFieldClass}>
                  {openSessions.map((r) => <option key={r.id} value={r.current_session_id!}>{r.name}</option>)}
                </select>
              </FormField>
              <FormField label="Valor (R$)" htmlFor="payment-amount">
                <input id="payment-amount" type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={formFieldClass} />
              </FormField>
              <FormField label="Forma de pagamento" htmlFor="payment-method">
                <select id="payment-method" required value={paymentMethodId2} onChange={(e) => setPaymentMethodId2(e.target.value)} className={formFieldClass}>
                  <option value="" disabled>Selecione…</option>
                  {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </FormField>
              <FormField label="Origem" htmlFor="payment-origin">
                <select id="payment-origin" value={originType} onChange={(e) => { setOriginType(e.target.value as typeof originType); setSale(null); setServiceOrder(null); }} className={formFieldClass}>
                  <option value="none">Avulso (sem origem)</option>
                  <option value="sale">Venda</option>
                  <option value="service_order">Ordem de Serviço</option>
                </select>
              </FormField>
              {originType === 'sale' && (
                <FormField label="Venda" htmlFor="payment-sale" span="full">
                  <EntityCombobox value={sale} onChange={setSale} search={searchConfirmedSales} getId={(item) => item.id} getLabel={(item) => `Venda #${item.sale_number}`} renderOption={(item) => (
                    <span>Venda #{item.sale_number} {item.customer_name ? `— ${item.customer_name}` : ''}</span>
                  )} id="payment-sale" placeholder="Buscar venda confirmada…" />
                </FormField>
              )}
              {originType === 'service_order' && (
                <FormField label="Ordem de Serviço" htmlFor="payment-so" span="full">
                  <EntityCombobox value={serviceOrder} onChange={setServiceOrder} search={searchOpenServiceOrders} getId={(item) => item.id} getLabel={(item) => `OS #${item.order_number}`} renderOption={(item) => (
                    <span>OS #{item.order_number} {item.customer_name ? `— ${item.customer_name}` : ''}</span>
                  )} id="payment-so" placeholder="Buscar ordem de serviço…" />
                </FormField>
              )}
              <FormField label="Observação (opcional)" htmlFor="payment-notes" span="full">
                <textarea id="payment-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} className={formFieldClass} />
              </FormField>
            </>
          )}
        </FormDialog>
      </div>
    </>
  );
}
