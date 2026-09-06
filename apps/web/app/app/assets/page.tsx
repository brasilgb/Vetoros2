'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Cpu, PlusCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { SearchToolbar } from '../../../components/search-toolbar';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge, commonStatus } from '../../../components/status-badge';
import { friendlyError } from '../../../components/error-state';
import { useDebouncedValue } from '../../../lib/use-debounced-value';

type Asset = { id: string; internal_identifier: string; category: string; brand: string | null; model: string | null; customer_name: string; status: string };
const PAGE_SIZE = 20;

export default function AssetsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Asset[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
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
      const response = await api(`/assets?${query}`);
      if (response.status === 401) return router.replace('/login');
      if (response.status === 403) return setState('denied');
      if (!response.ok) {
        setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar os equipamentos.'));
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
    void load(1);
  }, [load]);

  const hasFilters = Boolean(debouncedSearch || status);
  const columns: DataTableColumn<Asset>[] = [
    { key: 'identifier', header: 'Equipamento', render: (row) => <span className="font-medium text-emerald-50">{row.internal_identifier}</span> },
    { key: 'category', header: 'Categoria', render: (row) => row.category, hideBelow: 'sm' },
    { key: 'brand_model', header: 'Marca / Modelo', render: (row) => [row.brand, row.model].filter(Boolean).join(' ') || '—', hideBelow: 'md' },
    { key: 'customer', header: 'Cliente', render: (row) => row.customer_name },
    { key: 'status', header: 'Status', render: (row) => { const { label, tone } = commonStatus(row.status); return <StatusBadge tone={tone}>{label}</StatusBadge>; } },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Equipamentos"
        description="Equipamentos dos clientes atendidos."
        action={
          <Link href="/app/assets/new" className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
            <PlusCircle className="h-4 w-4" /> Novo equipamento
          </Link>
        }
      >
        <SearchToolbar value={search} onChange={setSearch} placeholder="Identificador, marca, modelo, série, cliente…">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
            <option value="">Todos os status</option>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
            <option value="retired">Desativado</option>
          </select>
        </SearchToolbar>
      </PageHeader>

      {state === 'denied' ? (
        <EmptyState icon={Cpu} title="Acesso negado" description="Você não tem permissão para visualizar equipamentos." />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            state={state === 'ready' || state === 'loading' ? state : 'error'}
            onRowClick={(row) => router.push(`/app/assets/${row.id}`)}
            onRetry={() => load(page)}
            errorMessage={errorMessage}
            emptyState={
              hasFilters ? (
                <EmptyState icon={Cpu} title="Nenhum equipamento encontrado" description="Nenhum equipamento corresponde aos filtros atuais." action={<button onClick={() => { setSearch(''); setStatus(''); }} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar filtros</button>} />
              ) : (
                <EmptyState
                  icon={Cpu}
                  title="Nenhum equipamento cadastrado"
                  description="Cadastre o primeiro equipamento para começar a abrir OS e orçamentos para ele."
                  action={
                    <Link href="/app/assets/new" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">
                      Novo equipamento
                    </Link>
                  }
                />
              )
            }
          />
          <DataTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={load} />
        </>
      )}
    </div>
  );
}
