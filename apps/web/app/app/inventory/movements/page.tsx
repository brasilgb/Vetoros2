'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight } from 'lucide-react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../../components/data-table';
import { EmptyState } from '../../../../components/empty-state';
import { StatusBadge, type StatusTone } from '../../../../components/status-badge';
import { friendlyError } from '../../../../components/error-state';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../components/operational-context';
import { formatDateTime } from '../../../../lib/format';

type Movement = { id: string; created_at: string; sku: string; description: string; type: string; quantity: string; resulting_balance: string; reason: string };
const movementTypeInfo: Record<string, { label: string; tone: StatusTone }> = {
  entry: { label: 'Entrada', tone: 'success' },
  exit: { label: 'Saída', tone: 'info' },
  adjustment_in: { label: 'Ajuste (entrada)', tone: 'success' },
  adjustment_out: { label: 'Ajuste (saída)', tone: 'warning' },
};
const PAGE_SIZE = 20;

export default function InventoryMovementsPage() {
  const router = useRouter();
  const { hasFullContext } = useOperationalContext();
  const [items, setItems] = useState<Movement[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(
    async (targetPage: number) => {
      setState('loading');
      const query = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE), ...(type ? { type } : {}) });
      const response = await api(`/inventory/movements?${query}`);
      if (response.status === 401) return router.replace('/login');
      if (!response.ok) {
        setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar as movimentações.'));
        return setState('error');
      }
      const body = await response.json();
      setItems(body.items);
      setTotal(body.total);
      setPage(targetPage);
      setState('ready');
    },
    [type, router],
  );

  useEffect(() => {
    if (!hasFullContext) return;
    void load(1);
  }, [load, hasFullContext]);

  const columns: DataTableColumn<Movement>[] = [
    { key: 'date', header: 'Data', render: (row) => formatDateTime(row.created_at) },
    { key: 'part', header: 'Peça', render: (row) => `${row.sku} — ${row.description}` },
    {
      key: 'type',
      header: 'Tipo',
      render: (row) => {
        const info = movementTypeInfo[row.type] ?? { label: row.type, tone: 'neutral' as const };
        return <StatusBadge tone={info.tone}>{info.label}</StatusBadge>;
      },
    },
    { key: 'quantity', header: 'Quantidade', align: 'right', render: (row) => Number(row.quantity) },
    { key: 'balance', header: 'Saldo resultante', align: 'right', render: (row) => Number(row.resulting_balance), hideBelow: 'sm' },
    { key: 'reason', header: 'Referência', render: (row) => row.reason, hideBelow: 'md' },
  ];

  return (
    <RequireOperationalContext>
      <div className="flex flex-col gap-6">
        <PageHeader title="Movimentações" description="Histórico de entradas, saídas e ajustes de estoque na filial ativa.">
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
            <option value="">Todos os tipos</option>
            {Object.entries(movementTypeInfo).map(([value, info]) => (
              <option key={value} value={value}>
                {info.label}
              </option>
            ))}
          </select>
        </PageHeader>

        <DataTable
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          state={state}
          onRetry={() => load(page)}
          errorMessage={errorMessage}
          emptyState={
            type ? (
              <EmptyState icon={ArrowLeftRight} title="Nenhuma movimentação encontrada" description="Nenhuma movimentação corresponde ao filtro atual." action={<button onClick={() => setType('')} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Limpar filtro</button>} />
            ) : (
              <EmptyState icon={ArrowLeftRight} title="Nenhuma movimentação registrada" description="Movimentações aparecem aqui conforme peças são recebidas, vendidas ou ajustadas." />
            )
          }
        />
        <DataTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={load} />
      </div>
    </RequireOperationalContext>
  );
}
