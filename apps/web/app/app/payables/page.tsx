'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Landmark, PlusCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { SearchToolbar } from '../../../components/search-toolbar';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge, type StatusTone } from '../../../components/status-badge';
import { EntityCombobox } from '../../../components/entity-combobox';
import { SupplierOptionRow, supplierLabel } from '../../../components/entity-option-rows';
import { friendlyError } from '../../../components/error-state';
import { RequireOperationalContext } from '../../../components/require-operational-context';
import { useOperationalContext } from '../../../components/operational-context';
import { useDebouncedValue } from '../../../lib/use-debounced-value';
import { formatCurrency, formatDate } from '../../../lib/format';
import { searchSuppliers, type SupplierOption } from '../../../lib/entity-search';

type Payable = {
  id: string; next_due_date: string | null; supplier_display_name: string | null; description: string;
  origin: 'purchase_order' | 'manual'; purchase_order_number: number | null;
  original_amount: string; paid_amount: string; balance: string; derived_status: 'open' | 'partial' | 'paid' | 'overdue' | 'canceled';
};
const PAGE_SIZE = 20;
const statusLabels: Record<Payable['derived_status'], { label: string; tone: StatusTone }> = {
  open: { label: 'Em aberto', tone: 'info' }, partial: { label: 'Parcial', tone: 'warning' }, paid: { label: 'Pago', tone: 'success' },
  overdue: { label: 'Atrasado', tone: 'danger' }, canceled: { label: 'Cancelado', tone: 'neutral' },
};
const originLabel = (row: Payable) => (row.origin === 'purchase_order' ? `Pedido #${row.purchase_order_number}` : 'Manual');

// FIN-03, seção 17.1 do correio.md: tabela operacional com vencimento/fornecedor/descrição/
// valor/pago/saldo/situação, filtros de fornecedor/origem/status/vencimento/busca, destaque
// visual para vencidos. Igual a Contas a Receber (FIN-02): "Filial" não é filtro aqui — a
// listagem já é escopada à filial ativa pelo contexto operacional do cabeçalho.
export default function PayablesPage() {
  return (
    <RequireOperationalContext>
      <Suspense fallback={<p className="text-sm text-slate-500">Carregando…</p>}>
        <PayablesPageContent />
      </Suspense>
    </RequireOperationalContext>
  );
}

function PayablesPageContent() {
  const router = useRouter();
  const { hasFullContext } = useOperationalContext();
  const [rows, setRows] = useState<Payable[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [origin, setOrigin] = useState('');
  const [supplier, setSupplier] = useState<SupplierOption | null>(null);
  const [period, setPeriod] = useState<'' | 'overdue' | '7d' | '30d' | 'custom'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const debouncedQ = useDebouncedValue(q);

  const today = new Date().toISOString().slice(0, 10);
  const activeFilterCount = [debouncedQ, status, origin, supplier, period].filter(Boolean).length;
  const clearFilters = useCallback(() => { setQ(''); setStatus(''); setOrigin(''); setSupplier(null); setPeriod(''); setFrom(''); setTo(''); }, []);

  const load = useCallback(async (targetPage: number) => {
    setState('loading');
    const query = new URLSearchParams({
      page: String(targetPage), pageSize: String(PAGE_SIZE),
      ...(debouncedQ ? { q: debouncedQ } : {}), ...(status ? { status } : {}), ...(origin ? { origin } : {}), ...(supplier ? { supplierId: supplier.id } : {}),
      ...(period === 'overdue' ? { to: today } : {}),
      ...(period === '7d' ? { from: today, to: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) } : {}),
      ...(period === '30d' ? { from: today, to: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) } : {}),
      ...(period === 'custom' && from ? { from } : {}), ...(period === 'custom' && to ? { to } : {}),
    });
    const response = await api(`/payables?${query}`);
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) {
      setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar as contas a pagar.'));
      return setState('error');
    }
    const body = await response.json();
    setRows(body.items); setTotal(body.total); setPage(targetPage); setState('ready');
  }, [debouncedQ, status, origin, supplier, period, from, to, today, router]);

  useEffect(() => { if (hasFullContext) void load(1); }, [load, hasFullContext]);

  const columns: DataTableColumn<Payable>[] = [
    { key: 'due', header: 'Vencimento', render: (row) => formatDate(row.next_due_date) },
    { key: 'supplier', header: 'Fornecedor/credor', render: (row) => row.supplier_display_name ?? '—' },
    { key: 'description', header: 'Descrição', render: (row) => row.description, hideBelow: 'sm' },
    { key: 'origin', header: 'Origem', render: (row) => originLabel(row), hideBelow: 'md' },
    { key: 'original', header: 'Valor', align: 'right', render: (row) => formatCurrency(row.original_amount), hideBelow: 'sm' },
    { key: 'balance', header: 'Saldo', align: 'right', render: (row) => formatCurrency(row.balance) },
    { key: 'status', header: 'Situação', render: (row) => <StatusBadge tone={statusLabels[row.derived_status].tone}>{statusLabels[row.derived_status].label}</StatusBadge> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contas a Pagar"
        description="Obrigações financeiras da empresa perante fornecedores e outros credores."
        action={
          <Link href="/app/payables/new" className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white">
            <PlusCircle className="h-4 w-4" /> Nova conta a pagar
          </Link>
        }
      >
        <SearchToolbar value={q} onChange={setQ} placeholder="Descrição, documento, fornecedor, pedido…">
          <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700">
            <option value="">Qualquer vencimento</option>
            <option value="overdue">Até hoje</option>
            <option value="7d">Próximos 7 dias</option>
            <option value="30d">Próximos 30 dias</option>
            <option value="custom">Intervalo personalizado</option>
          </select>
          {period === 'custom' && (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700" />
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700" />
            </>
          )}
          <div className="w-52"><EntityCombobox value={supplier} onChange={setSupplier} search={searchSuppliers} getId={(s) => s.id} getLabel={supplierLabel} renderOption={(s) => <SupplierOptionRow item={s} />} id="payables-supplier" placeholder="Fornecedor…" /></div>
          <select value={origin} onChange={(e) => setOrigin(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700">
            <option value="">Todas as origens</option>
            <option value="purchase_order">Pedido de compra</option>
            <option value="manual">Manual</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700">
            <option value="">Todas as situações</option>
            <option value="open">Em aberto</option>
            <option value="partial">Parcial</option>
            <option value="paid">Pago</option>
            <option value="overdue">Atrasado</option>
            <option value="canceled">Cancelado</option>
          </select>
          {activeFilterCount > 0 && (
            <button type="button" onClick={clearFilters} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
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
        onRowClick={(row) => router.push(`/app/payables/${row.id}`)}
        onRetry={() => load(page)}
        errorMessage={errorMessage}
        emptyState={
          activeFilterCount > 0 ? (
            <EmptyState icon={Landmark} title="Nenhuma conta encontrada" description="Nenhuma conta a pagar corresponde aos filtros atuais." action={<button onClick={clearFilters} className="rounded-xl border border-slate-300 px-4 py-2 text-sm">Limpar filtros</button>} />
          ) : (
            <EmptyState icon={Landmark} title="Nenhuma conta a pagar" description="Crie uma conta manual ou a partir de um pedido de compra aprovado." action={<Link href="/app/payables/new" className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Nova conta a pagar</Link>} />
          )
        }
      />
      <DataTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={load} />
    </div>
  );
}
