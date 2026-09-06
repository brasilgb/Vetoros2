'use client';
import { use, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { ClipboardList, PlusCircle, Trash2 } from 'lucide-react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { DataTable, type DataTableColumn } from '../../../../components/data-table';
import { EmptyState } from '../../../../components/empty-state';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { StatusBadge, commonStatus } from '../../../../components/status-badge';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { AsyncButton } from '../../../../components/async-button';
import { ConfirmDialog } from '../../../../components/confirm-dialog';
import { formatCurrency, formatDate } from '../../../../lib/format';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../components/operational-context';
import { EntityCombobox } from '../../../../components/entity-combobox';
import { PartOptionRow, partLabel } from '../../../../components/entity-option-rows';
import { searchParts, type PartOption } from '../../../../lib/entity-search';

type Item = { id: string; part_sku: string; description: string; quantity: string; unit_cost: string; discount: string; total: string; received_quantity: number; pending_quantity: number };
type Order = {
  id: string; purchase_order_number: number; supplier_name: string; branch_name: string; issue_date: string; expected_date: string | null; supplier_reference: string | null;
  status: string; receipt_state: string; freight_total: string; other_costs_total: string; subtotal: string; discount_total: string; total: string; items: Item[];
};

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [fields, setFields] = useState({ expectedDate: '', supplierReference: '', freightTotal: '0', otherCostsTotal: '0' });
  const [part, setPart] = useState<PartOption | null>(null);
  const [item, setItem] = useState({ description: '', quantity: '1', unitCost: '0', discount: '0' });
  const [addingItem, setAddingItem] = useState(false);
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<'approve' | 'cancel'>();
  const [busy, setBusy] = useState(false);
  const { hasFullContext } = useOperationalContext();

  const load = useCallback(async () => {
    const response = await api(`/purchase-orders/${id}`);
    if (!response.ok) return setState('error');
    const data: Order = await response.json();
    setOrder(data);
    setFields({ expectedDate: data.expected_date ?? '', supplierReference: data.supplier_reference ?? '', freightTotal: data.freight_total, otherCostsTotal: data.other_costs_total });
    setState('ready');
  }, [id]);

  useEffect(() => {
    if (!hasFullContext) return;
    void load();
  }, [load, hasFullContext]);

  useSetBreadcrumb(order ? `Pedido ${order.purchase_order_number}` : undefined);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!part) return setError('Selecione uma peça.');
    setAddingItem(true);
    setError('');
    const response = await api(`/purchase-orders/${id}/items`, { method: 'POST', body: JSON.stringify({ ...item, inventoryPartId: part.id, description: item.description || undefined }) });
    setAddingItem(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    setItem({ ...item, description: '' });
    setPart(null);
    await load();
  }

  async function removeItem(itemId: string) {
    await api(`/purchase-orders/${id}/items/${itemId}`, { method: 'DELETE' });
    await load();
  }

  async function confirmAction() {
    if (!pendingAction) return;
    setBusy(true);
    const response = await api(`/purchase-orders/${id}/${pendingAction}`, { method: 'POST' });
    setBusy(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    setPendingAction(undefined);
    await load();
  }

  if (state === 'loading') return <RequireOperationalContext><p className="text-sm text-emerald-100/60">Carregando…</p></RequireOperationalContext>;
  if (state === 'error' || !order) return <RequireOperationalContext><ErrorState message="Não foi possível carregar este pedido de compra." onRetry={load} /></RequireOperationalContext>;

  const { label, tone } = commonStatus(order.status);
  const receiptState = commonStatus(order.receipt_state);
  const editable = order.status === 'draft';
  const canReceive = order.status === 'approved' && order.receipt_state !== 'received';

  const columns: DataTableColumn<Item>[] = [
    { key: 'part', header: 'Peça', render: (row) => `${row.part_sku} — ${row.description}` },
    { key: 'quantity', header: 'Pedido', align: 'right', render: (row) => Number(row.quantity), hideBelow: 'sm' },
    { key: 'received', header: 'Recebido', align: 'right', render: (row) => row.received_quantity, hideBelow: 'md' },
    { key: 'pending', header: 'Pendente', align: 'right', render: (row) => row.pending_quantity },
    { key: 'total', header: 'Total', align: 'right', render: (row) => formatCurrency(row.total), hideBelow: 'sm' },
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
        title={`Pedido ${order.purchase_order_number} — ${order.supplier_name}`}
        description={`Filial: ${order.branch_name} · Emissão: ${formatDate(order.issue_date)}`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge tone={tone}>{label}</StatusBadge>
            <StatusBadge tone={receiptState.tone}>{receiptState.label}</StatusBadge>
          </div>
        }
      />

      <FormSection title="Prazos e custos">
        <FormField label="Previsão de entrega" htmlFor="expectedDate">
          <input id="expectedDate" type="date" disabled={!editable} className={formFieldClass} value={fields.expectedDate} onChange={(e) => setFields({ ...fields, expectedDate: e.target.value })} />
        </FormField>
        <FormField label="Referência do fornecedor" htmlFor="supplierReference">
          <input id="supplierReference" disabled={!editable} className={formFieldClass} value={fields.supplierReference} onChange={(e) => setFields({ ...fields, supplierReference: e.target.value })} />
        </FormField>
        <FormField label="Frete" htmlFor="freightTotal">
          <input id="freightTotal" type="number" min="0" step="0.01" disabled={!editable} className={formFieldClass} value={fields.freightTotal} onChange={(e) => setFields({ ...fields, freightTotal: e.target.value })} />
        </FormField>
        <FormField label="Outros custos" htmlFor="otherCostsTotal">
          <input id="otherCostsTotal" type="number" min="0" step="0.01" disabled={!editable} className={formFieldClass} value={fields.otherCostsTotal} onChange={(e) => setFields({ ...fields, otherCostsTotal: e.target.value })} />
        </FormField>
        {editable && (
          <div className="sm:col-span-2">
            <AsyncButton
              tone="secondary"
              label="Salvar"
              busyLabel="Salvando…"
              onClick={async () => {
                const response = await api(`/purchase-orders/${id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ expectedDate: fields.expectedDate || null, supplierReference: fields.supplierReference || null, freightTotal: Number(fields.freightTotal), otherCostsTotal: Number(fields.otherCostsTotal) }),
                });
                if (!response.ok) setError(friendlyError((await response.json().catch(() => ({}))).error));
                else await load();
              }}
            />
          </div>
        )}
      </FormSection>

      <div className="flex flex-wrap gap-3">
        {editable && (
          <>
            <AsyncButton tone="primary" label="Aprovar" onClick={() => setPendingAction('approve')} />
            <AsyncButton tone="destructive" label="Cancelar pedido" onClick={() => setPendingAction('cancel')} />
          </>
        )}
        {canReceive && (
          <Link href={`/app/purchase-receipts/new?purchaseOrderId=${order.id}`} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">
            Receber mercadorias
          </Link>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-emerald-100">Itens</h2>
        <DataTable columns={columns} rows={order.items} rowKey={(row) => row.id} state="ready" emptyState={<EmptyState icon={ClipboardList} title="Nenhum item adicionado" description="Adicione as peças deste pedido." />} />
      </div>

      {editable && (
        <FormSection title="Adicionar item">
          <form onSubmit={addItem} className="contents">
            <FormField label="Peça" htmlFor="item-part" span="full">
              <EntityCombobox
                id="item-part"
                value={part}
                onChange={(next) => { setPart(next); if (next) setError(''); }}
                search={searchParts}
                getId={(entry) => entry.id}
                getLabel={partLabel}
                renderOption={(entry) => <PartOptionRow item={entry} />}
                placeholder="Buscar por SKU ou descrição…"
                hasError={!part && Boolean(error)}
              />
            </FormField>
            <FormField label="Descrição (opcional)" htmlFor="item-description" span="full">
              <input id="item-description" className={formFieldClass} value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} />
            </FormField>
            <FormField label="Quantidade" htmlFor="item-quantity">
              <input id="item-quantity" type="number" min="0.001" step="0.001" className={formFieldClass} value={item.quantity} onChange={(e) => setItem({ ...item, quantity: e.target.value })} />
            </FormField>
            <FormField label="Custo unitário" htmlFor="item-cost">
              <input id="item-cost" type="number" min="0" step="0.01" className={formFieldClass} value={item.unitCost} onChange={(e) => setItem({ ...item, unitCost: e.target.value })} />
            </FormField>
            <FormField label="Desconto" htmlFor="item-discount">
              <input id="item-discount" type="number" min="0" step="0.01" className={formFieldClass} value={item.discount} onChange={(e) => setItem({ ...item, discount: e.target.value })} />
            </FormField>
            <div className="sm:col-span-2">
              <button type="submit" disabled={addingItem} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950 disabled:opacity-50">
                <PlusCircle className="h-4 w-4" /> {addingItem ? 'Adicionando…' : 'Adicionar item'}
              </button>
            </div>
          </form>
        </FormSection>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      <p className="text-right text-sm text-emerald-100/70">
        Subtotal: {formatCurrency(order.subtotal)} · Descontos: {formatCurrency(order.discount_total)} · Frete: {formatCurrency(order.freight_total)} · Outros: {formatCurrency(order.other_costs_total)} ·{' '}
        <span className="font-semibold text-emerald-50">Total: {formatCurrency(order.total)}</span>
      </p>

      <ConfirmDialog
        open={!!pendingAction}
        title={pendingAction === 'approve' ? 'Aprovar pedido de compra?' : pendingAction === 'cancel' ? 'Cancelar pedido de compra?' : ''}
        description={pendingAction === 'approve' ? 'O pedido passa a poder receber mercadorias e não poderá mais ser editado.' : pendingAction === 'cancel' ? 'O pedido será cancelado e não poderá mais ser editado ou aprovado.' : ''}
        confirmLabel={pendingAction === 'approve' ? 'Aprovar' : pendingAction === 'cancel' ? 'Cancelar pedido' : ''}
        tone={pendingAction === 'cancel' ? 'destructive' : 'default'}
        busy={busy}
        onConfirm={confirmAction}
        onCancel={() => setPendingAction(undefined)}
      />
    </div>
    </RequireOperationalContext>
  );
}
