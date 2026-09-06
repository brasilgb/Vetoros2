'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Users } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { SearchToolbar } from '../../../components/search-toolbar';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge, commonStatus } from '../../../components/status-badge';
import { RowActionsMenu, RowActionItem } from '../../../components/row-actions-menu';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { friendlyError } from '../../../components/error-state';
import { useDebouncedValue } from '../../../lib/use-debounced-value';

type Customer = { id: string; customer_number: number; legal_name: string; trade_name: string | null; document_normalized: string | null; mobile: string | null; email: string | null; status: string };

const PAGE_SIZE = 20;

export default function CustomersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Customer[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [toggleTarget, setToggleTarget] = useState<Customer>();
  const [toggling, setToggling] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  const load = useCallback(
    async (targetPage: number, term: string) => {
      setState('loading');
      const response = await api(`/customers?page=${targetPage}&pageSize=${PAGE_SIZE}&search=${encodeURIComponent(term)}`);
      if (response.status === 401) return router.replace('/login');
      if (response.status === 403) return setState('denied');
      if (!response.ok) return setState('error');
      const body = await response.json();
      setRows(body.items);
      setTotal(body.total);
      setPage(targetPage);
      setState('ready');
    },
    [router],
  );

  useEffect(() => {
    void load(1, debouncedSearch);
  }, [debouncedSearch, load]);

  async function confirmToggle() {
    if (!toggleTarget) return;
    setToggling(true);
    const nextStatus = toggleTarget.status === 'active' ? 'inactive' : 'active';
    const response = await api(`/customers/${toggleTarget.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
    setToggling(false);
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) return alert(friendlyError((await response.json().catch(() => ({}))).error));
    setToggleTarget(undefined);
    await load(page, debouncedSearch);
  }

  const columns: DataTableColumn<Customer>[] = [
    {
      key: 'name',
      header: 'Cliente',
      render: (row) => (
        <div>
          <p className="font-medium text-emerald-50">
            #{row.customer_number} · {row.trade_name || row.legal_name}
          </p>
          {row.trade_name && <p className="text-xs text-emerald-100/50">{row.legal_name}</p>}
        </div>
      ),
    },
    { key: 'document', header: 'Documento', render: (row) => row.document_normalized || '—' },
    { key: 'contact', header: 'Contato', render: (row) => row.mobile || row.email || '—' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const { label, tone } = commonStatus(row.status);
        return <StatusBadge tone={tone}>{label}</StatusBadge>;
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <RowActionsMenu label={`Ações de ${row.legal_name}`}>
          <RowActionItem onClick={() => router.push(`/app/customers/${row.id}`)}>Editar</RowActionItem>
          <RowActionItem onClick={() => setToggleTarget(row)}>{row.status === 'active' ? 'Inativar' : 'Ativar'}</RowActionItem>
        </RowActionsMenu>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clientes"
        description="Cadastro base de clientes do tenant."
        action={
          <Link href="/app/customers/new" className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
            <UserPlus className="h-4 w-4" /> Novo cliente
          </Link>
        }
      >
        <SearchToolbar value={search} onChange={setSearch} placeholder="Nome, documento, contato ou número" />
      </PageHeader>

      {state === 'denied' ? (
        <EmptyState icon={Users} title="Acesso negado" description="Você não tem permissão para visualizar clientes." />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            state={state === 'ready' || state === 'loading' ? state : 'error'}
            onRowClick={(row) => router.push(`/app/customers/${row.id}`)}
            onRetry={() => load(page, debouncedSearch)}
            emptyState={
              debouncedSearch ? (
                <EmptyState icon={Users} title="Nenhum cliente encontrado" description="Nenhum cliente corresponde aos filtros atuais." action={<button onClick={() => setSearch('')} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar busca</button>} />
              ) : (
                <EmptyState
                  icon={Users}
                  title="Nenhum cliente cadastrado"
                  description="Cadastre seu primeiro cliente para começar a registrar atendimentos."
                  action={
                    <Link href="/app/customers/new" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">
                      Adicionar cliente
                    </Link>
                  }
                />
              )
            }
          />
          <DataTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={(next) => load(next, debouncedSearch)} />
        </>
      )}

      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.status === 'active' ? 'Inativar cliente?' : 'Ativar cliente?'}
        description={`${toggleTarget?.trade_name || toggleTarget?.legal_name || ''} ficará ${toggleTarget?.status === 'active' ? 'inativo' : 'ativo'} no cadastro.`}
        confirmLabel={toggleTarget?.status === 'active' ? 'Inativar' : 'Ativar'}
        busy={toggling}
        onConfirm={confirmToggle}
        onCancel={() => setToggleTarget(undefined)}
      />
    </div>
  );
}
