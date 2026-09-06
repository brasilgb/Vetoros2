'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { DataTable, type DataTableColumn } from '../../../../components/data-table';
import { EmptyState } from '../../../../components/empty-state';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { StatusBadge, commonStatus } from '../../../../components/status-badge';
import { AsyncButton } from '../../../../components/async-button';
import { ConfirmDialog } from '../../../../components/confirm-dialog';
import { formatDate } from '../../../../lib/format';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../components/operational-context';

type Item = { id: string; part_sku: string; description: string; received_quantity: number; previously_returned_quantity: number; quantity: string; remaining_returnable_quantity: number };
type ReturnDetail = { id: string; return_number: number; purchase_order_number: number; receipt_number: number; supplier_name: string; branch_name: string; returned_at: string; reason: string | null; status: string; items: Item[] };

export default function PurchaseReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [ret, setRet] = useState<ReturnDetail>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<'confirm' | 'cancel'>();
  const [busy, setBusy] = useState(false);
  const { hasFullContext } = useOperationalContext();

  const load = useCallback(async () => {
    const response = await api(`/purchase-returns/${id}`);
    if (!response.ok) return setState('error');
    setRet(await response.json());
    setState('ready');
  }, [id]);

  useEffect(() => {
    if (!hasFullContext) return;
    void load();
  }, [load, hasFullContext]);

  useSetBreadcrumb(ret ? `Devolução ${ret.return_number}` : undefined);

  async function removeItem(itemId: string) {
    await api(`/purchase-returns/${id}/items/${itemId}`, { method: 'DELETE' });
    await load();
  }

  async function confirmAction() {
    if (!pendingAction) return;
    setBusy(true);
    const response = await api(`/purchase-returns/${id}/${pendingAction}`, { method: 'POST' });
    setBusy(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    setPendingAction(undefined);
    await load();
  }

  if (state === 'loading') return <RequireOperationalContext><p className="text-sm text-emerald-100/60">Carregando…</p></RequireOperationalContext>;
  if (state === 'error' || !ret) return <RequireOperationalContext><ErrorState message="Não foi possível carregar esta devolução." onRetry={load} /></RequireOperationalContext>;

  const { label, tone } = commonStatus(ret.status);
  const editable = ret.status === 'draft';

  const columns: DataTableColumn<Item>[] = [
    { key: 'part', header: 'Peça', render: (row) => `${row.part_sku} — ${row.description}` },
    { key: 'received', header: 'Recebido', align: 'right', render: (row) => row.received_quantity, hideBelow: 'md' },
    { key: 'before', header: 'Devolvido antes', align: 'right', render: (row) => row.previously_returned_quantity, hideBelow: 'sm' },
    { key: 'now', header: 'Nesta ocorrência', align: 'right', render: (row) => Number(row.quantity) },
    { key: 'remaining', header: 'Restante', align: 'right', render: (row) => row.remaining_returnable_quantity, hideBelow: 'md' },
    ...(editable
      ? [{ key: 'actions', header: '', align: 'right' as const, render: (row: Item) => (
          <button onClick={() => removeItem(row.id)} aria-label="Excluir item" className="rounded-lg p-1.5 text-emerald-100/50 hover:bg-red-950/40 hover:text-red-300">
            <Trash2 className="h-4 w-4" />
          </button>
        ) }]
      : []),
  ];

  return (
    <RequireOperationalContext>
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Devolução ${ret.return_number}`}
        description={`Pedido #${ret.purchase_order_number} · Recebimento #${ret.receipt_number} · Fornecedor: ${ret.supplier_name} · Filial: ${ret.branch_name} · Data: ${formatDate(ret.returned_at)}${ret.reason ? ` · Motivo: ${ret.reason}` : ''}`}
        action={<StatusBadge tone={tone}>{label}</StatusBadge>}
      />

      {editable && (
        <div className="flex flex-wrap gap-3">
          <AsyncButton tone="primary" label="Confirmar" onClick={() => setPendingAction('confirm')} />
          <AsyncButton tone="destructive" label="Cancelar devolução" onClick={() => setPendingAction('cancel')} />
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold text-emerald-100">Itens</h2>
        <DataTable columns={columns} rows={ret.items} rowKey={(row) => row.id} state="ready" emptyState={<EmptyState icon={Undo2} title="Nenhum item nesta devolução" />} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={!!pendingAction}
        title={pendingAction === 'confirm' ? 'Confirmar devolução?' : pendingAction === 'cancel' ? 'Cancelar devolução?' : ''}
        description={pendingAction === 'confirm' ? 'O estoque das peças devolvidas será baixado e a devolução não poderá mais ser editada.' : pendingAction === 'cancel' ? 'A devolução será cancelada e não poderá mais ser editada ou confirmada.' : ''}
        confirmLabel={pendingAction === 'confirm' ? 'Confirmar devolução' : pendingAction === 'cancel' ? 'Cancelar devolução' : ''}
        tone={pendingAction === 'cancel' ? 'destructive' : 'default'}
        busy={busy}
        onConfirm={confirmAction}
        onCancel={() => setPendingAction(undefined)}
      />
    </div>
    </RequireOperationalContext>
  );
}
