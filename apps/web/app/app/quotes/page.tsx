'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, PlusCircle } from 'lucide-react';
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

type Quote = { id: string; quote_number: number; title: string; status: string; customer_name: string };
const statuses = ['draft', 'sent', 'approved', 'rejected', 'expired', 'cancelled'] as const;
const PAGE_SIZE = 20;

export default function QuotesPage() {
  const router = useRouter();
  const { hasFullContext } = useOperationalContext();
  const [rows, setRows] = useState<Quote[]>([]);
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
      const response = await api(`/quotes?${query}`);
      if (response.status === 401) return router.replace('/login');
      if (!response.ok) {
        setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar os orçamentos.'));
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
  const columns: DataTableColumn<Quote>[] = [
    { key: 'number', header: 'Orçamento', render: (row) => <span className="font-medium text-emerald-50">#{row.quote_number}</span> },
    { key: 'customer', header: 'Cliente', render: (row) => row.customer_name },
    { key: 'title', header: 'Título', render: (row) => row.title, hideBelow: 'sm' },
    { key: 'status', header: 'Status', render: (row) => { const { label, tone } = commonStatus(row.status); return <StatusBadge tone={tone}>{label}</StatusBadge>; } },
  ];

  return (
    <RequireOperationalContext>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Orçamentos"
          description="Orçamentos para clientes, com conversão em Ordem de Serviço quando aprovados."
          action={
            <Link href="/app/quotes/new" className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
              <PlusCircle className="h-4 w-4" /> Novo orçamento
            </Link>
          }
        >
          <SearchToolbar value={search} onChange={setSearch} placeholder="Número, título ou cliente">
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
          onRowClick={(row) => router.push(`/app/quotes/${row.id}`)}
          onRetry={() => load(page)}
          errorMessage={errorMessage}
          emptyState={
            hasFilters ? (
              <EmptyState icon={FileText} title="Nenhum orçamento encontrado" description="Nenhum orçamento corresponde aos filtros atuais." action={<button onClick={() => { setSearch(''); setStatus(''); }} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar filtros</button>} />
            ) : (
              <EmptyState
                icon={FileText}
                title="Nenhum orçamento cadastrado"
                description="Crie o primeiro orçamento para começar a negociar com o cliente."
                action={
                  <Link href="/app/quotes/new" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">
                    Novo orçamento
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
