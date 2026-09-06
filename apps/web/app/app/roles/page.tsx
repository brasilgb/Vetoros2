'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlusCircle, ShieldCheck } from 'lucide-react';
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

// ADM-02 — mesmo padrão de /app/users (UX-01/02/03/ADM-01): DataTable, SearchToolbar,
// RowActionsMenu, ConfirmDialog. Sem paginação — o número de papéis por tenant é pequeno (9 de
// sistema + os personalizados que o próprio tenant criar), como /app/companies.
type Role = { id: string; code: string; name: string; isSystemManaged: boolean; status: string; grantCount: number };

export default function RolesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Role[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [search, setSearch] = useState('');
  const [toggleTarget, setToggleTarget] = useState<Role>();
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Role>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const debouncedSearch = useDebouncedValue(search);

  const load = useCallback(
    async (term: string) => {
      setState('loading');
      const response = await api(`/roles?search=${encodeURIComponent(term)}`);
      if (response.status === 401) return router.replace('/login');
      if (response.status === 403) return setState('denied');
      if (!response.ok) return setState('error');
      setRows(await response.json());
      setState('ready');
    },
    [router],
  );

  useEffect(() => {
    void load(debouncedSearch);
  }, [debouncedSearch, load]);

  async function confirmToggle() {
    if (!toggleTarget) return;
    setToggling(true);
    setToggleError('');
    const response = await api(`/roles/${toggleTarget.id}`, { method: 'PATCH', body: JSON.stringify({ status: toggleTarget.status === 'active' ? 'inactive' : 'active' }) });
    setToggling(false);
    if (!response.ok) return setToggleError(friendlyError((await response.json().catch(() => ({}))).error));
    setToggleTarget(undefined);
    await load(debouncedSearch);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    const response = await api(`/roles/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (!response.ok) return setDeleteError(friendlyError((await response.json().catch(() => ({}))).error));
    setDeleteTarget(undefined);
    await load(debouncedSearch);
  }

  const columns: DataTableColumn<Role>[] = [
    { key: 'name', header: 'Papel', render: (row) => <span className="font-medium text-emerald-50">{row.name}</span> },
    {
      key: 'type',
      header: 'Tipo',
      render: (row) => <StatusBadge tone={row.isSystemManaged ? 'info' : 'neutral'}>{row.isSystemManaged ? 'Sistema' : 'Personalizado'}</StatusBadge>,
    },
    { key: 'users', header: 'Usuários', render: (row) => String(row.grantCount), hideBelow: 'sm' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => { const { label, tone } = commonStatus(row.status); return <StatusBadge tone={tone}>{label}</StatusBadge>; },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        row.isSystemManaged ? (
          <RowActionsMenu label={`Ações de ${row.name}`}>
            <RowActionItem onClick={() => router.push(`/app/roles/${row.id}`)}>Ver</RowActionItem>
          </RowActionsMenu>
        ) : (
          <RowActionsMenu label={`Ações de ${row.name}`}>
            <RowActionItem onClick={() => router.push(`/app/roles/${row.id}`)}>Editar</RowActionItem>
            <RowActionItem onClick={() => { setToggleError(''); setToggleTarget(row); }}>{row.status === 'active' ? 'Inativar' : 'Ativar'}</RowActionItem>
            <RowActionItem destructive onClick={() => { setDeleteError(''); setDeleteTarget(row); }}>Excluir</RowActionItem>
          </RowActionsMenu>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Papéis e Permissões"
        description="Papéis de sistema e personalizados deste tenant, e o que cada um permite fazer."
        action={
          <Link href="/app/roles/new" className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
            <PlusCircle className="h-4 w-4" /> Novo papel
          </Link>
        }
      >
        <SearchToolbar value={search} onChange={setSearch} placeholder="Nome do papel" />
      </PageHeader>

      {state === 'denied' ? (
        <EmptyState icon={ShieldCheck} title="Acesso negado" description="Você não tem permissão para administrar papéis." />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          state={state === 'ready' || state === 'loading' ? state : 'error'}
          onRowClick={(row) => router.push(`/app/roles/${row.id}`)}
          onRetry={() => load(debouncedSearch)}
          emptyState={
            debouncedSearch ? (
              <EmptyState icon={ShieldCheck} title="Nenhum papel encontrado" description="Nenhum papel corresponde aos filtros atuais." action={<button onClick={() => setSearch('')} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar busca</button>} />
            ) : (
              <EmptyState icon={ShieldCheck} title="Nenhum papel cadastrado" description="Isso não deveria acontecer — os papéis de sistema já vêm provisionados." />
            )
          }
        />
      )}

      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.status === 'active' ? 'Inativar papel?' : 'Ativar papel?'}
        description={toggleError || `${toggleTarget?.name ?? ''} ficará ${toggleTarget?.status === 'active' ? 'indisponível para novas atribuições' : 'disponível para atribuição novamente'}.`}
        confirmLabel={toggleTarget?.status === 'active' ? 'Inativar' : 'Ativar'}
        busy={toggling}
        onConfirm={confirmToggle}
        onCancel={() => setToggleTarget(undefined)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Excluir papel?"
        description={deleteError || `"${deleteTarget?.name ?? ''}" será excluído permanentemente. Só é possível excluir um papel que nunca foi atribuído a ninguém.`}
        confirmLabel="Excluir"
        tone="destructive"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(undefined)}
      />
    </div>
  );
}
