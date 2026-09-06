'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackageCheck } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { SearchToolbar } from '../../../components/search-toolbar';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge, commonStatus } from '../../../components/status-badge';
import { friendlyError } from '../../../components/error-state';
import { RequireOperationalContext } from '../../../components/require-operational-context';
import { useOperationalContext } from '../../../components/operational-context';
import { formatDate } from '../../../lib/format';
import { useDebouncedValue } from '../../../lib/use-debounced-value';

type Receipt = { id: string; receipt_number: number; purchase_order_number: number; supplier_name: string; branch_name: string; received_at: string; status: string };
const statuses = ['draft', 'confirmed', 'cancelled'] as const;
const PAGE_SIZE = 20;

export default function PurchaseReceiptsPage() {
  const router = useRouter();
  const { hasFullContext } = useOperationalContext();
  const [rows, setRows] = useState<Receipt[]>([]);
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
      const response = await api(`/purchase-receipts?${query}`);
      if (response.status === 401) return router.replace('/login');
      if (!response.ok) {
        setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar os recebimentos.'));
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
  const columns: DataTableColumn<Receipt>[] = [
    { key: 'number', header: 'Recebimento', render: (row) => <span className="font-medium text-emerald-50">#{row.receipt_number}</span> },
    { key: 'order', header: 'Pedido', render: (row) => `#${row.purchase_order_number}`, hideBelow: 'sm' },
    { key: 'supplier', header: 'Fornecedor', render: (row) => row.supplier_name },
    { key: 'date', header: 'Data', render: (row) => formatDate(row.received_at), hideBelow: 'md' },
    { key: 'status', header: 'Status', render: (row) => { const { label, tone } = commonStatus(row.status); return <StatusBadge tone={tone}>{label}</StatusBadge>; } },
  ];

  return (
    <RequireOperationalContext>
      <div className="flex flex-col gap-6">
        <PageHeader title="Recebimentos" description="Recebimentos de mercadoria a partir de pedidos de compra aprovados.">
          <SearchToolbar value={search} onChange={setSearch} placeholder="Número do recebimento, pedido ou fornecedor">
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
          onRowClick={(row) => router.push(`/app/purchase-receipts/${row.id}`)}
          onRetry={() => load(page)}
          errorMessage={errorMessage}
          emptyState={
            hasFilters ? (
              <EmptyState icon={PackageCheck} title="Nenhum recebimento encontrado" description="Nenhum recebimento corresponde aos filtros atuais." action={<button onClick={() => { setSearch(''); setStatus(''); }} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar filtros</button>} />
            ) : (
              <EmptyState icon={PackageCheck} title="Nenhum recebimento registrado" description="Os recebimentos são iniciados a partir de um pedido de compra aprovado." />
            )
          }
        />
        <DataTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={load} />
      </div>
    </RequireOperationalContext>
  );
}
