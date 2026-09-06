'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building, PlusCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { DataTable, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge, commonStatus } from '../../../components/status-badge';
import { friendlyError } from '../../../components/error-state';

// A API não pagina nem filtra /companies — devolve todas as empresas que o usuário enxerga de
// uma vez (seção 9/11 do correio.md UX-03: um tenant tem poucas empresas, não é um domínio que
// cresce sem limite como Clientes/Peças). Por isso a listagem não tem busca nem paginação.
type Company = { id: string; legal_name: string; trade_name: string | null; tax_id_type: string; tax_id_normalized: string; status: string };

export default function CompaniesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Company[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    const response = await api('/companies');
    if (response.status === 401) return router.replace('/login');
    if (response.status === 403) return setState('denied');
    if (!response.ok) {
      setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar as empresas.'));
      return setState('error');
    }
    setRows(await response.json());
    setState('ready');
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: DataTableColumn<Company>[] = [
    { key: 'name', header: 'Empresa', render: (row) => <span className="font-medium text-emerald-50">{row.trade_name || row.legal_name}</span> },
    { key: 'document', header: 'CNPJ/CPF', render: (row) => row.tax_id_normalized, hideBelow: 'sm' },
    { key: 'status', header: 'Status', render: (row) => { const { label, tone } = commonStatus(row.status); return <StatusBadge tone={tone}>{label}</StatusBadge>; } },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Empresas"
        description="Empresas (pessoas jurídicas) deste tenant."
        action={
          <Link href="/app/companies/new" className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
            <PlusCircle className="h-4 w-4" /> Nova empresa
          </Link>
        }
      />

      {state === 'denied' ? (
        <EmptyState icon={Building} title="Acesso negado" description="Você não tem permissão para visualizar empresas." />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          state={state === 'ready' || state === 'loading' ? state : 'error'}
          onRowClick={(row) => router.push(`/app/companies/${row.id}`)}
          onRetry={load}
          errorMessage={errorMessage}
          emptyState={
            <EmptyState
              icon={Building}
              title="Nenhuma empresa cadastrada"
              description="Cadastre a primeira empresa para começar a operar."
              action={
                <Link href="/app/companies/new" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">
                  Nova empresa
                </Link>
              }
            />
          }
        />
      )}
    </div>
  );
}
