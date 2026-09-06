'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, PlusCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { DataTable, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge, commonStatus } from '../../../components/status-badge';
import { friendlyError } from '../../../components/error-state';

// Mesma observação de /companies: a API devolve todas as filiais que o usuário enxerga de uma
// vez, sem busca nem paginação — coerente com um domínio pequeno (seção 11 do correio.md).
type Branch = { id: string; name: string; code: string; company_id: string; status: string };
type Company = { id: string; legal_name: string; trade_name: string | null };

export default function BranchesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Branch[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    const [branchesResponse, companiesResponse] = await Promise.all([api('/branches'), api('/companies')]);
    if (branchesResponse.status === 401) return router.replace('/login');
    if (branchesResponse.status === 403) return setState('denied');
    if (!branchesResponse.ok) {
      setErrorMessage(friendlyError((await branchesResponse.json().catch(() => ({}))).error, 'Não foi possível carregar as filiais.'));
      return setState('error');
    }
    if (companiesResponse.ok) {
      const companyList: Company[] = await companiesResponse.json();
      setCompanies(Object.fromEntries(companyList.map((company) => [company.id, company.trade_name || company.legal_name])));
    }
    setRows(await branchesResponse.json());
    setState('ready');
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: DataTableColumn<Branch>[] = [
    { key: 'name', header: 'Filial', render: (row) => <span className="font-medium text-emerald-50">{row.name}</span> },
    { key: 'code', header: 'Código', render: (row) => row.code, hideBelow: 'sm' },
    { key: 'company', header: 'Empresa', render: (row) => companies[row.company_id] ?? '—' },
    { key: 'status', header: 'Status', render: (row) => { const { label, tone } = commonStatus(row.status); return <StatusBadge tone={tone}>{label}</StatusBadge>; } },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Filiais"
        description="Filiais das empresas deste tenant."
        action={
          <Link href="/app/branches/new" className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
            <PlusCircle className="h-4 w-4" /> Nova filial
          </Link>
        }
      />

      {state === 'denied' ? (
        <EmptyState icon={Building2} title="Acesso negado" description="Você não tem permissão para visualizar filiais." />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          state={state === 'ready' || state === 'loading' ? state : 'error'}
          onRowClick={(row) => router.push(`/app/branches/${row.id}`)}
          onRetry={load}
          errorMessage={errorMessage}
          emptyState={
            <EmptyState
              icon={Building2}
              title="Nenhuma filial cadastrada"
              description="Cadastre a primeira filial para começar a operar."
              action={
                <Link href="/app/branches/new" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">
                  Nova filial
                </Link>
              }
            />
          }
        />
      )}
    </div>
  );
}
