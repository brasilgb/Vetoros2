'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlusCircle, ShoppingCart } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { SearchToolbar } from '../../../components/search-toolbar';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge, commonStatus } from '../../../components/status-badge';
import { friendlyError } from '../../../components/error-state';
import { RequireOperationalContext } from '../../../components/require-operational-context';
import { useOperationalContext } from '../../../components/operational-context';
import { useDebouncedValue } from '../../../lib/use-debounced-value';

type Sale = { id: string; sale_number: number; customer_name: string | null; status: string };
const statuses = ['draft', 'confirmed', 'cancelled'] as const;
const PAGE_SIZE = 20;

export default function SalesPage() {
  const router = useRouter();
  const { hasFullContext } = useOperationalContext();
  const [rows, setRows] = useState<Sale[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const debouncedSearch = useDebouncedValue(search);

  const load = useCallback(
    async (targetPage: number) => {
      setState('loading');
      const query = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE), ...(debouncedSearch ? { search: debouncedSearch } : {}), ...(status ? { status } : {}) });
      const response = await api(`/sales?${query}`);
      if (response.status === 401) return router.replace('/login');
      if (!response.ok) {
        setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar as vendas.'));
        return setState('error');
      }
      const body = await response.json();
      setRows(body.items);
      setTotal(body.total);
      setPage(targetPage);
      setState('ready');
    },
    [debouncedSearch, status, router],
  );

  useEffect(() => {
    if (!hasFullContext) return;
    void load(1);
  }, [load, hasFullContext]);

  const hasFilters = Boolean(debouncedSearch || status);
  const columns: DataTableColumn<Sale>[] = [
    { key: 'number', header: 'Venda', render: (row) => <span className="font-medium text-emerald-50">#{row.sale_number}</span> },
    { key: 'customer', header: 'Cliente', render: (row) => row.customer_name ?? 'Consumidor não identificado' },
    { key: 'status', header: 'Status', render: (row) => { const { label, tone } = commonStatus(row.status); return <StatusBadge tone={tone}>{label}</StatusBadge>; } },
  ];

  return (
    <RequireOperationalContext>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Vendas"
          description="Vendas de peças e serviços ao balcão."
          action={
            <Link href="/app/sales/new" className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
              <PlusCircle className="h-4 w-4" /> Nova venda
            </Link>
          }
        >
          <SearchToolbar value={search} onChange={setSearch} placeholder="Número ou cliente">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
              <option value="">Todos os status</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {commonStatus(s).label}
                </option>
              ))}
            </select>
          </SearchToolbar>
        </PageHeader>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          state={state}
          onRowClick={(row) => router.push(`/app/sales/${row.id}`)}
          onRetry={() => load(page)}
          errorMessage={errorMessage}
          emptyState={
            hasFilters ? (
              <EmptyState icon={ShoppingCart} title="Nenhuma venda encontrada" description="Nenhuma venda corresponde aos filtros atuais." action={<button onClick={() => { setSearch(''); setStatus(''); }} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar filtros</button>} />
            ) : (
              <EmptyState
                icon={ShoppingCart}
                title="Nenhuma venda registrada"
                description="Registre a primeira venda para começar."
                action={
                  <Link href="/app/sales/new" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">
                    Nova venda
                  </Link>
                }
              />
            )
          }
        />
        <DataTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={load} />
      </div>
    </RequireOperationalContext>
  );
}
