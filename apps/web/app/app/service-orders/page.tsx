'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlusCircle, Wrench } from 'lucide-react';
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

type ServiceOrder = { id: string; order_number: number; title: string; customer_name: string; status: string; created_at: string };

const PAGE_SIZE = 20;

export default function ServiceOrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ServiceOrder[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const { hasFullContext } = useOperationalContext();

  const load = useCallback(
    async (targetPage: number) => {
      setState('loading');
      const query = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE), ...(debouncedSearch ? { search: debouncedSearch } : {}), ...(status ? { status } : {}) });
      const response = await api(`/service-orders?${query}`);
      if (response.status === 401) return router.replace('/login');
      if (!response.ok) {
        setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar as ordens de serviço.'));
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

  const columns: DataTableColumn<ServiceOrder>[] = [
    { key: 'number', header: 'OS', render: (row) => <span className="font-medium text-emerald-50">#{row.order_number}</span> },
    { key: 'title', header: 'Título', render: (row) => row.title },
    { key: 'customer', header: 'Cliente', render: (row) => row.customer_name },
    { key: 'opened', header: 'Abertura', render: (row) => formatDate(row.created_at) },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const { label, tone } = commonStatus(row.status);
        return <StatusBadge tone={tone}>{label}</StatusBadge>;
      },
    },
  ];

  return (
    <RequireOperationalContext>
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ordens de Serviço"
        description="Ordens de serviço abertas para clientes."
        action={
          <Link href="/app/service-orders/new" className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
            <PlusCircle className="h-4 w-4" /> Nova OS
          </Link>
        }
      >
        <SearchToolbar value={search} onChange={setSearch} placeholder="Número ou cliente">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
            <option value="">Todos os status</option>
            <option value="open">Aberta</option>
            <option value="in_progress">Em andamento</option>
            <option value="completed">Concluída</option>
            <option value="canceled">Cancelada</option>
          </select>
        </SearchToolbar>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        state={state}
        onRowClick={(row) => router.push(`/app/service-orders/${row.id}`)}
        onRetry={() => load(page)}
        errorMessage={errorMessage}
        emptyState={
          hasFilters ? (
            <EmptyState icon={Wrench} title="Nenhuma OS encontrada" description="Nenhuma ordem de serviço corresponde aos filtros atuais." action={<button onClick={() => { setSearch(''); setStatus(''); }} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar filtros</button>} />
          ) : (
            <EmptyState
              icon={Wrench}
              title="Nenhuma ordem de serviço aberta"
              description="Abra a primeira OS para começar a registrar um atendimento."
              action={
                <Link href="/app/service-orders/new" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">
                  Abrir OS
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
