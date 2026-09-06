'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Package, PlusCircle } from 'lucide-react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { SearchToolbar } from '../../../../components/search-toolbar';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../../components/data-table';
import { EmptyState } from '../../../../components/empty-state';
import { StatusBadge, commonStatus } from '../../../../components/status-badge';
import { friendlyError } from '../../../../components/error-state';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../components/operational-context';
import { useDebouncedValue } from '../../../../lib/use-debounced-value';

// Listagem orientada ao trabalho diário (seção 3.5 do correio.md UX-02): SKU, descrição, saldo
// e status — sem colunas técnicas (custo/preço de referência ficam no cadastro, não na lista).
type Part = { id: string; sku: string; description: string; unit: string; status: string; balance: string };
const PAGE_SIZE = 20;

export default function InventoryPartsPage() {
  const router = useRouter();
  const { hasFullContext } = useOperationalContext();
  const [items, setItems] = useState<Part[]>([]);
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
      const response = await api(`/inventory/parts?${query}`);
      if (response.status === 401) return router.replace('/login');
      if (!response.ok) {
        setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar as peças.'));
        return setState('error');
      }
      const body = await response.json();
      setItems(body.items);
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
  const columns: DataTableColumn<Part>[] = [
    { key: 'sku', header: 'Peça', render: (row) => <span className="font-medium text-emerald-50">{row.sku}</span> },
    { key: 'description', header: 'Descrição', render: (row) => row.description },
    { key: 'balance', header: 'Saldo', align: 'right', render: (row) => `${Number(row.balance)} ${row.unit}` },
    { key: 'status', header: 'Status', render: (row) => { const { label, tone } = commonStatus(row.status); return <StatusBadge tone={tone}>{label}</StatusBadge>; } },
  ];

  return (
    <RequireOperationalContext>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Peças / Produtos"
          description="Cadastro de peças e saldo na filial ativa."
          action={
            <Link href="/app/inventory/parts/new" className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
              <PlusCircle className="h-4 w-4" /> Nova peça
            </Link>
          }
        >
          <SearchToolbar value={search} onChange={setSearch} placeholder="SKU ou descrição">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
              <option value="">Todos os status</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
          </SearchToolbar>
        </PageHeader>

        <DataTable
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          state={state}
          onRowClick={(row) => router.push(`/app/inventory/parts/${row.id}`)}
          onRetry={() => load(page)}
          errorMessage={errorMessage}
          emptyState={
            hasFilters ? (
              <EmptyState icon={Package} title="Nenhuma peça encontrada" description="Nenhuma peça corresponde aos filtros atuais." action={<button onClick={() => { setSearch(''); setStatus(''); }} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar filtros</button>} />
            ) : (
              <EmptyState
                icon={Package}
                title="Nenhuma peça cadastrada"
                description="Cadastre a primeira peça para começar a controlar o estoque."
                action={
                  <Link href="/app/inventory/parts/new" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">
                    Nova peça
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
