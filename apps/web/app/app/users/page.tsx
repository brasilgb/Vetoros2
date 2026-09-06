'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserCog, UserPlus } from 'lucide-react';
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

// ADM-01 — segue exatamente o padrão de /app/customers (UX-01/02/03): DataTable, SearchToolbar,
// paginação, ConfirmDialog para ativar/inativar. "Último acesso" só existe porque
// `identities.last_login_at` já é confiável (é atualizado a cada login bem-sucedido — ver
// AuthService.login) — seção 6.1 do correio.md pede para só mostrar essa coluna se for esse o
// caso.
type UserRow = { id: string; name: string; email: string | null; status: string; lastLoginAt: string | null; role: { id: string; code: string; name: string } | null };

const PAGE_SIZE = 20;
const formatLastLogin = (value: string | null) => (value ? new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Nunca acessou');

export default function UsersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [toggleTarget, setToggleTarget] = useState<UserRow>();
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState('');
  const debouncedSearch = useDebouncedValue(search);

  const load = useCallback(
    async (targetPage: number, term: string) => {
      setState('loading');
      const response = await api(`/users?page=${targetPage}&pageSize=${PAGE_SIZE}&search=${encodeURIComponent(term)}`);
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
    setToggleError('');
    const nextStatus = toggleTarget.status === 'active' ? 'inactive' : 'active';
    const response = await api(`/users/${toggleTarget.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
    setToggling(false);
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) return setToggleError(friendlyError((await response.json().catch(() => ({}))).error));
    setToggleTarget(undefined);
    await load(page, debouncedSearch);
  }

  const columns: DataTableColumn<UserRow>[] = [
    { key: 'name', header: 'Nome', render: (row) => <span className="font-medium text-emerald-50">{row.name}</span> },
    { key: 'email', header: 'E-mail', render: (row) => row.email ?? '—', hideBelow: 'sm' },
    { key: 'role', header: 'Papel', render: (row) => row.role?.name ?? '—' },
    { key: 'lastLogin', header: 'Último acesso', render: (row) => formatLastLogin(row.lastLoginAt), hideBelow: 'md' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => { const { label, tone } = commonStatus(row.status); return <StatusBadge tone={tone}>{label}</StatusBadge>; },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <RowActionsMenu label={`Ações de ${row.name}`}>
          <RowActionItem onClick={() => router.push(`/app/users/${row.id}`)}>Editar</RowActionItem>
          <RowActionItem onClick={() => { setToggleError(''); setToggleTarget(row); }}>{row.status === 'active' ? 'Inativar' : 'Ativar'}</RowActionItem>
        </RowActionsMenu>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usuários"
        description="Usuários deste tenant e o papel de acesso de cada um."
        action={
          <Link href="/app/users/new" className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
            <UserPlus className="h-4 w-4" /> Novo usuário
          </Link>
        }
      >
        <SearchToolbar value={search} onChange={setSearch} placeholder="Nome ou e-mail" />
      </PageHeader>

      {state === 'denied' ? (
        <EmptyState icon={UserCog} title="Acesso negado" description="Você não tem permissão para administrar usuários." />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            state={state === 'ready' || state === 'loading' ? state : 'error'}
            onRowClick={(row) => router.push(`/app/users/${row.id}`)}
            onRetry={() => load(page, debouncedSearch)}
            emptyState={
              debouncedSearch ? (
                <EmptyState icon={UserCog} title="Nenhum usuário encontrado" description="Nenhum usuário corresponde aos filtros atuais." action={<button onClick={() => setSearch('')} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar busca</button>} />
              ) : (
                <EmptyState
                  icon={UserCog}
                  title="Nenhum usuário cadastrado"
                  description="Cadastre o primeiro usuário para dar acesso a este tenant."
                  action={
                    <Link href="/app/users/new" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">
                      Novo usuário
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
        title={toggleTarget?.status === 'active' ? 'Inativar usuário?' : 'Ativar usuário?'}
        description={
          toggleError
            ? toggleError
            : `${toggleTarget?.name ?? ''} ficará ${toggleTarget?.status === 'active' ? 'sem acesso a este tenant' : 'com acesso restaurado'}.`
        }
        confirmLabel={toggleTarget?.status === 'active' ? 'Inativar' : 'Ativar'}
        busy={toggling}
        onConfirm={confirmToggle}
        onCancel={() => setToggleTarget(undefined)}
      />
    </div>
  );
}
