'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PlusCircle, Wallet } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { SearchToolbar } from '../../../components/search-toolbar';
import { DataTable, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge } from '../../../components/status-badge';
import { friendlyError } from '../../../components/error-state';
import { RequireOperationalContext } from '../../../components/require-operational-context';
import { useOperationalContext } from '../../../components/operational-context';
import { useDebouncedValue } from '../../../lib/use-debounced-value';
import { formatCurrency } from '../../../lib/format';

type FinancialAccount = {
  id: string; name: string; bank_name: string | null; branch_number: string | null; account_number: string | null; account_digit: string | null;
  status: 'active' | 'inactive'; balance: string;
};

// FIN-04, seção 25.1 do correio.md: listagem com nome/instituição/identificação resumida/
// empresa/saldo/status. "Empresa" não é uma coluna aqui (a listagem já é escopada à empresa ativa
// do contexto operacional — mesmo critério de Contas a Receber/a Pagar, que também omitem
// "Filial" pelo mesmo motivo).
export default function FinancialAccountsPage() {
  return (
    <RequireOperationalContext>
      <Suspense fallback={<p className="text-sm text-slate-500">Carregando…</p>}>
        <FinancialAccountsPageContent />
      </Suspense>
    </RequireOperationalContext>
  );
}

function accountIdentification(row: FinancialAccount): string {
  if (!row.account_number) return '—';
  return `Ag. ${row.branch_number ?? '—'} / Cc ${row.account_number}${row.account_digit ? `-${row.account_digit}` : ''}`;
}

function FinancialAccountsPageContent() {
  const router = useRouter();
  const { hasFullContext } = useOperationalContext();
  const [rows, setRows] = useState<FinancialAccount[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const debouncedQ = useDebouncedValue(q);
  const activeFilterCount = [debouncedQ, status].filter(Boolean).length;
  const clearFilters = useCallback(() => { setQ(''); setStatus(''); }, []);

  const load = useCallback(async () => {
    setState('loading');
    const query = new URLSearchParams({ ...(debouncedQ ? { q: debouncedQ } : {}), ...(status ? { status } : {}) });
    const response = await api(`/financial-accounts?${query}`);
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) {
      setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar as contas financeiras.'));
      return setState('error');
    }
    setRows(await response.json());
    setState('ready');
  }, [debouncedQ, status, router]);

  useEffect(() => { if (hasFullContext) void load(); }, [load, hasFullContext]);

  const columns: DataTableColumn<FinancialAccount>[] = [
    { key: 'name', header: 'Nome', render: (row) => row.name },
    { key: 'bank', header: 'Instituição', render: (row) => row.bank_name ?? '—', hideBelow: 'sm' },
    { key: 'identification', header: 'Identificação', render: (row) => accountIdentification(row), hideBelow: 'md' },
    { key: 'balance', header: 'Saldo', align: 'right', render: (row) => formatCurrency(row.balance) },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge tone={row.status === 'active' ? 'success' : 'neutral'}>{row.status === 'active' ? 'Ativa' : 'Inativa'}</StatusBadge> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contas Financeiras"
        description="Contas bancárias e financeiras da empresa — onde o dinheiro está e como ele se movimenta."
        action={
          <Link href="/app/financial-accounts/new" className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white">
            <PlusCircle className="h-4 w-4" /> Nova conta financeira
          </Link>
        }
      >
        <SearchToolbar value={q} onChange={setQ} placeholder="Nome, banco, número da conta…">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700">
            <option value="">Todos os status</option>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>
          {activeFilterCount > 0 && (
            <button type="button" onClick={clearFilters} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
              Limpar {activeFilterCount} filtro{activeFilterCount > 1 ? 's' : ''}
            </button>
          )}
        </SearchToolbar>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        state={state}
        onRowClick={(row) => router.push(`/app/financial-accounts/${row.id}`)}
        onRetry={load}
        errorMessage={errorMessage}
        emptyState={
          activeFilterCount > 0 ? (
            <EmptyState icon={Wallet} title="Nenhuma conta encontrada" description="Nenhuma conta financeira corresponde aos filtros atuais." action={<button onClick={clearFilters} className="rounded-xl border border-slate-300 px-4 py-2 text-sm">Limpar filtros</button>} />
          ) : (
            <EmptyState icon={Wallet} title="Nenhuma conta financeira" description="Cadastre a primeira conta bancária ou financeira da empresa." action={<Link href="/app/financial-accounts/new" className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Nova conta financeira</Link>} />
          )
        }
      />
    </div>
  );
}
