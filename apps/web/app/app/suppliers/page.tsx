'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Truck, UserPlus } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { SearchToolbar } from '../../../components/search-toolbar';
import { DataTable, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge, commonStatus } from '../../../components/status-badge';
import { RowActionsMenu, RowActionItem } from '../../../components/row-actions-menu';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { friendlyError } from '../../../components/error-state';
import { useDebouncedValue } from '../../../lib/use-debounced-value';

type Supplier = { id: string; supplier_number: string; legal_name: string; trade_name: string | null; document_normalized: string | null; primary_contact: string | null; status: string };

export default function SuppliersPage() {
  const router = useRouter();
  const [items, setItems] = useState<Supplier[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [toggleTarget, setToggleTarget] = useState<Supplier>();
  const [toggling, setToggling] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  const load = useCallback(async () => {
    setState('loading');
    const query = new URLSearchParams({ ...(debouncedSearch ? { search: debouncedSearch } : {}), ...(status ? { status } : {}) });
    const response = await api(`/suppliers?${query}`);
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) return setState('error');
    setItems((await response.json()).items);
    setState('ready');
  }, [debouncedSearch, status, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmToggle() {
    if (!toggleTarget) return;
    setToggling(true);
    const nextStatus = toggleTarget.status === 'active' ? 'inactive' : 'active';
    const response = await api(`/suppliers/${toggleTarget.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
    setToggling(false);
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) return alert(friendlyError((await response.json().catch(() => ({}))).error));
    setToggleTarget(undefined);
    await load();
  }

  const hasFilters = Boolean(debouncedSearch || status);

  const columns: DataTableColumn<Supplier>[] = [
    {
      key: 'name',
      header: 'Fornecedor',
      render: (row) => (
        <div>
          <p className="font-medium text-emerald-50">
            #{row.supplier_number} · {row.trade_name || row.legal_name}
          </p>
          {row.trade_name && <p className="text-xs text-emerald-100/50">{row.legal_name}</p>}
        </div>
      ),
    },
    { key: 'document', header: 'Documento', render: (row) => row.document_normalized || '—' },
    { key: 'contact', header: 'Contato', render: (row) => row.primary_contact || '—' },
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
          <RowActionItem onClick={() => router.push(`/app/suppliers/${row.id}`)}>Editar</RowActionItem>
          <RowActionItem onClick={() => setToggleTarget(row)}>{row.status === 'active' ? 'Inativar' : 'Ativar'}</RowActionItem>
        </RowActionsMenu>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fornecedores"
        description="Cadastro de fornecedores usados em pedidos de compra."
        action={
          <Link href="/app/suppliers/new" className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
            <UserPlus className="h-4 w-4" /> Novo fornecedor
          </Link>
        }
      >
        <SearchToolbar value={search} onChange={setSearch} placeholder="Número, nome ou documento">
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
        onRowClick={(row) => router.push(`/app/suppliers/${row.id}`)}
        onRetry={load}
        emptyState={
          hasFilters ? (
            <EmptyState icon={Truck} title="Nenhum fornecedor encontrado" description="Nenhum fornecedor corresponde aos filtros atuais." action={<button onClick={() => { setSearch(''); setStatus(''); }} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar filtros</button>} />
          ) : (
            <EmptyState
              icon={Truck}
              title="Nenhum fornecedor cadastrado"
              description="Cadastre seu primeiro fornecedor para começar a registrar compras."
              action={
                <Link href="/app/suppliers/new" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">
                  Adicionar fornecedor
                </Link>
              }
            />
          )
        }
      />

      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.status === 'active' ? 'Inativar fornecedor?' : 'Ativar fornecedor?'}
        description={`${toggleTarget?.trade_name || toggleTarget?.legal_name || ''} ficará ${toggleTarget?.status === 'active' ? 'inativo' : 'ativo'} no cadastro.`}
        confirmLabel={toggleTarget?.status === 'active' ? 'Inativar' : 'Ativar'}
        busy={toggling}
        onConfirm={confirmToggle}
        onCancel={() => setToggleTarget(undefined)}
      />
    </div>
  );
}
