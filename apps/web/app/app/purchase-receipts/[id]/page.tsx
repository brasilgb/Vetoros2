'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PackageCheck, Trash2 } from 'lucide-react';
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

type Item = { id: string; part_sku: string; description: string; previously_received_quantity: number; quantity: string; pending_after_quantity: number; returned_quantity: number; returnable_quantity: number };
type Return = { id: string; return_number: number; status: string; returned_at: string };
type Receipt = { id: string; receipt_number: number; purchase_order_number: number; supplier_name: string; branch_name: string; received_at: string; status: string; order_receipt_state: string; items: Item[]; returns: Return[] };

export default function PurchaseReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [receipt, setReceipt] = useState<Receipt>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<'confirm' | 'cancel'>();
  const [busy, setBusy] = useState(false);
  const { hasFullContext } = useOperationalContext();

  const load = useCallback(async () => {
    const response = await api(`/purchase-receipts/${id}`);
    if (!response.ok) return setState('error');
    setReceipt(await response.json());
    setState('ready');
  }, [id]);

  useEffect(() => {
    if (!hasFullContext) return;
    void load();
  }, [load, hasFullContext]);

  useSetBreadcrumb(receipt ? `Recebimento ${receipt.receipt_number}` : undefined);

  async function removeItem(itemId: string) {
    await api(`/purchase-receipts/${id}/items/${itemId}`, { method: 'DELETE' });
    await load();
  }

  async function confirmAction() {
    if (!pendingAction) return;
    setBusy(true);
    const response = await api(`/purchase-receipts/${id}/${pendingAction}`, { method: 'POST' });
    setBusy(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    setPendingAction(undefined);
    await load();
  }

  if (state === 'loading') return <RequireOperationalContext><p className="text-sm text-emerald-100/60">Carregando…</p></RequireOperationalContext>;
  if (state === 'error' || !receipt) return <RequireOperationalContext><ErrorState message="Não foi possível carregar este recebimento." onRetry={load} /></RequireOperationalContext>;

  const { label, tone } = commonStatus(receipt.status);
  const orderState = commonStatus(receipt.order_receipt_state);
  const editable = receipt.status === 'draft';
  const hasReturnable = receipt.status === 'confirmed' && receipt.items.some((item) => item.returnable_quantity > 0);

  const columns: DataTableColumn<Item>[] = [
    { key: 'part', header: 'Peça', render: (row) => `${row.part_sku} — ${row.description}` },
    { key: 'before', header: 'Recebido antes', align: 'right', render: (row) => row.previously_received_quantity, hideBelow: 'md' },
    { key: 'now', header: 'Nesta ocorrência', align: 'right', render: (row) => Number(row.quantity) },
    { key: 'pending', header: 'Pendente após', align: 'right', render: (row) => row.pending_after_quantity, hideBelow: 'sm' },
    { key: 'returned', header: 'Devolvido', align: 'right', render: (row) => row.returned_quantity, hideBelow: 'md' },
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
        title={`Recebimento ${receipt.receipt_number}`}
        description={`Pedido #${receipt.purchase_order_number} · Fornecedor: ${receipt.supplier_name} · Filial: ${receipt.branch_name} · Data: ${formatDate(receipt.received_at)}`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge tone={tone}>{label}</StatusBadge>
            <StatusBadge tone={orderState.tone}>{orderState.label}</StatusBadge>
          </div>
        }
      />

      <div className="flex flex-wrap gap-3">
        {editable && (
          <>
            <AsyncButton tone="primary" label="Confirmar" onClick={() => setPendingAction('confirm')} />
            <AsyncButton tone="destructive" label="Cancelar recebimento" onClick={() => setPendingAction('cancel')} />
          </>
        )}
        {hasReturnable && (
          <Link href={`/app/purchase-returns/new?purchaseReceiptId=${receipt.id}`} className="rounded-xl border border-amber-700 px-4 py-2.5 text-sm text-amber-100 hover:bg-amber-950/30">
            Devolver mercadorias
          </Link>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-emerald-100">Itens</h2>
        <DataTable columns={columns} rows={receipt.items} rowKey={(row) => row.id} state="ready" emptyState={<EmptyState icon={PackageCheck} title="Nenhum item neste recebimento" />} />
      </div>

      {receipt.returns.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-emerald-100">Devoluções relacionadas</h2>
          <ul className="flex flex-col gap-2">
            {receipt.returns.map((ret) => {
              const returnStatus = commonStatus(ret.status);
              return (
                <li key={ret.id}>
                  <Link href={`/app/purchase-returns/${ret.id}`} className="flex items-center justify-between rounded-xl border border-emerald-900 px-4 py-3 text-sm hover:bg-emerald-950/60">
                    <span>
                      #{ret.return_number} · {formatDate(ret.returned_at)}
                    </span>
                    <StatusBadge tone={returnStatus.tone}>{returnStatus.label}</StatusBadge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={!!pendingAction}
        title={pendingAction === 'confirm' ? 'Confirmar recebimento?' : pendingAction === 'cancel' ? 'Cancelar recebimento?' : ''}
        description={pendingAction === 'confirm' ? 'O estoque das peças recebidas será atualizado e o recebimento não poderá mais ser editado.' : pendingAction === 'cancel' ? 'O recebimento será cancelado e não poderá mais ser editado ou confirmado.' : ''}
        confirmLabel={pendingAction === 'confirm' ? 'Confirmar recebimento' : pendingAction === 'cancel' ? 'Cancelar recebimento' : ''}
        tone={pendingAction === 'cancel' ? 'destructive' : 'default'}
        busy={busy}
        onConfirm={confirmAction}
        onCancel={() => setPendingAction(undefined)}
      />
    </div>
    </RequireOperationalContext>
  );
}
