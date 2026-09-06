'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { SearchToolbar } from '../../../components/search-toolbar';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { friendlyError } from '../../../components/error-state';
import { useDebouncedValue } from '../../../lib/use-debounced-value';
import { actionLabel, knownActions, moduleGroups, moduleLabelForResourceType, type ModuleKey } from '../../../lib/audit-labels';

// ADM-03 — mesmo padrão de listagem do resto do VetorOS 2 (DataTable/SearchToolbar/paginação no
// backend). Seção 15/16 do correio.md: colunas Data/Hora, Usuário, Módulo, Ação, Entidade, Ações
// — nada de JSON/diff na tabela (isso fica só no detalhe); filtros numa toolbar consistente, com
// um jeito claro de ver quantos estão ativos e limpá-los de uma vez.
type AuditEvent = {
  id: string; createdAt: string; action: string; resourceType: string; resourceId: string | null;
  entityLabel: string | null; actor: { identityId: string; name: string | null; email: string | null } | null;
};

const PAGE_SIZE = 20;
const moduleOptions = (Object.entries(moduleGroups) as [ModuleKey, (typeof moduleGroups)[ModuleKey]][]).filter(([key]) => key !== 'other');
const actionOptions = [...knownActions].sort((a, b) => actionLabel(a).localeCompare(actionLabel(b), 'pt-BR'));
const formatDateTime = (value: string) => new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function AuditLogsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<'' | 'today' | '7d' | '30d' | 'custom'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [module, setModule] = useState<'' | ModuleKey>('');
  const [action, setAction] = useState('');
  const debouncedQ = useDebouncedValue(q);

  const resourceTypeParam = module ? moduleGroups[module].resourceTypes.join(',') : '';
  const activeFilterCount = [debouncedQ, period, module, action].filter(Boolean).length;

  const clearFilters = useCallback(() => { setQ(''); setPeriod(''); setFrom(''); setTo(''); setModule(''); setAction(''); }, []);

  const load = useCallback(
    async (targetPage: number) => {
      setState('loading');
      const query = new URLSearchParams({
        page: String(targetPage), pageSize: String(PAGE_SIZE),
        ...(debouncedQ ? { q: debouncedQ } : {}),
        ...(period ? { period } : {}),
        ...(period === 'custom' && from ? { from } : {}),
        ...(period === 'custom' && to ? { to } : {}),
        ...(resourceTypeParam ? { resourceType: resourceTypeParam } : {}),
        ...(action ? { action } : {}),
      });
      const response = await api(`/audit-events?${query}`);
      if (response.status === 401) return router.replace('/login');
      if (response.status === 403) return setState('denied');
      if (!response.ok) {
        setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar a auditoria.'));
        return setState('error');
      }
      const body = await response.json();
      setRows(body.items);
      setTotal(body.total);
      setPage(targetPage);
      setState('ready');
    },
    [debouncedQ, period, from, to, resourceTypeParam, action, router],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const columns: DataTableColumn<AuditEvent>[] = useMemo(
    () => [
      { key: 'when', header: 'Data/Hora', render: (row) => formatDateTime(row.createdAt) },
      { key: 'actor', header: 'Usuário', render: (row) => row.actor?.name ?? 'Sistema', hideBelow: 'sm' },
      { key: 'module', header: 'Módulo', render: (row) => moduleLabelForResourceType(row.resourceType), hideBelow: 'md' },
      { key: 'action', header: 'Ação', render: (row) => actionLabel(row.action) },
      { key: 'entity', header: 'Entidade', render: (row) => row.entityLabel ?? '—', hideBelow: 'md' },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Auditoria" description="Histórico de alterações realizadas neste tenant — consulta, sem edição." />

      <SearchToolbar value={q} onChange={setQ} placeholder="Ação, entidade, usuário…">
        <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
          <option value="">Qualquer período</option>
          <option value="today">Hoje</option>
          <option value="7d">Últimos 7 dias</option>
          <option value="30d">Últimos 30 dias</option>
          <option value="custom">Intervalo personalizado</option>
        </select>
        {period === 'custom' && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100" />
          </>
        )}
        <select value={module} onChange={(e) => setModule(e.target.value as typeof module)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
          <option value="">Todos os módulos</option>
          {moduleOptions.map(([key, group]) => (
            <option key={key} value={key}>{group.label}</option>
          ))}
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
          <option value="">Todas as ações</option>
          {actionOptions.map((code) => (
            <option key={code} value={code}>{actionLabel(code)}</option>
          ))}
        </select>
        {activeFilterCount > 0 && (
          <button type="button" onClick={clearFilters} className="rounded-xl border border-emerald-800 px-3 py-2.5 text-sm text-emerald-100 hover:bg-emerald-950">
            Limpar {activeFilterCount} filtro{activeFilterCount > 1 ? 's' : ''}
          </button>
        )}
      </SearchToolbar>

      {state === 'denied' ? (
        <EmptyState icon={History} title="Acesso negado" description="Você não tem permissão para consultar a auditoria." />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            state={state === 'ready' || state === 'loading' ? state : 'error'}
            onRowClick={(row) => router.push(`/app/audit-logs/${row.id}`)}
            onRetry={() => load(page)}
            errorMessage={errorMessage}
            emptyState={
              activeFilterCount > 0 ? (
                <EmptyState icon={History} title="Nenhum evento encontrado" description="Nenhum evento corresponde aos filtros atuais." action={<button onClick={clearFilters} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar filtros</button>} />
              ) : (
                <EmptyState icon={History} title="Nenhum evento registrado ainda" description="Alterações feitas neste tenant aparecerão aqui." />
              )
            }
          />
          <DataTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={load} />
        </>
      )}
    </div>
  );
}
