'use client';
import { use, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { PlusCircle, ShoppingCart, Trash2 } from 'lucide-react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { DataTable, type DataTableColumn } from '../../../../components/data-table';
import { EmptyState } from '../../../../components/empty-state';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { StatusBadge, commonStatus } from '../../../../components/status-badge';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { AsyncButton } from '../../../../components/async-button';
import { ConfirmDialog } from '../../../../components/confirm-dialog';
import { formatCurrency } from '../../../../lib/format';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../components/operational-context';
import { EntityCombobox } from '../../../../components/entity-combobox';
import { PartOptionRow, partLabel } from '../../../../components/entity-option-rows';
import { searchParts, type PartOption } from '../../../../lib/entity-search';

type Item = { id: string; type: string; part_sku: string | null; description: string; quantity: string; unit_price: string; discount_amount: string; total: string };
type Sale = { id: string; sale_number: number; customer_name: string | null; status: string; notes: string | null; items: Item[]; subtotal: number; discount_total: number; total: number };

export default function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [sale, setSale] = useState<Sale>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notes, setNotes] = useState('');
  const [part, setPart] = useState<PartOption | null>(null);
  const [item, setItem] = useState({ type: 'part', description: '', quantity: '1', unitPrice: '0', discountAmount: '0' });
  const [addingItem, setAddingItem] = useState(false);
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<'confirm' | 'cancel'>();
  const [busy, setBusy] = useState(false);
  const { hasFullContext } = useOperationalContext();

  const load = useCallback(async () => {
    const response = await api(`/sales/${id}`);
    if (!response.ok) return setState('error');
    const data: Sale = await response.json();
    setSale(data);
    setNotes(data.notes ?? '');
    setState('ready');
  }, [id]);

  useEffect(() => {
    if (!hasFullContext) return;
    void load();
  }, [load, hasFullContext]);

  useSetBreadcrumb(sale ? `Venda ${sale.sale_number}` : undefined);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddingItem(true);
    setError('');
    const response = await api(`/sales/${id}/items`, { method: 'POST', body: JSON.stringify({ ...item, inventoryPartId: item.type === 'part' ? (part?.id ?? null) : null }) });
    setAddingItem(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    setItem({ ...item, description: '' });
    setPart(null);
    await load();
  }

  async function removeItem(itemId: string) {
    await api(`/sales/${id}/items/${itemId}`, { method: 'DELETE' });
    await load();
  }

  async function confirmAction() {
    if (!pendingAction) return;
    setBusy(true);
    const response = await api(`/sales/${id}/${pendingAction}`, { method: 'POST' });
    setBusy(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    setPendingAction(undefined);
    await load();
  }

  if (state === 'loading') return <RequireOperationalContext><p className="text-sm text-emerald-100/60">Carregando…</p></RequireOperationalContext>;
  if (state === 'error' || !sale) return <RequireOperationalContext><ErrorState message="Não foi possível carregar esta venda." onRetry={load} /></RequireOperationalContext>;

  const { label, tone } = commonStatus(sale.status);
  const editable = sale.status === 'draft';
  const cancellable = sale.status === 'draft' || sale.status === 'confirmed';

  const columns: DataTableColumn<Item>[] = [
    { key: 'type', header: 'Tipo', render: (row) => (row.type === 'part' ? 'Peça' : 'Serviço') },
    { key: 'description', header: 'Descrição', render: (row) => `${row.part_sku ? `${row.part_sku} — ` : ''}${row.description}` },
    { key: 'quantity', header: 'Qtd.', align: 'right', render: (row) => Number(row.quantity), hideBelow: 'sm' },
    { key: 'unit_price', header: 'Unitário', align: 'right', render: (row) => formatCurrency(row.unit_price), hideBelow: 'md' },
    { key: 'total', header: 'Total', align: 'right', render: (row) => formatCurrency(row.total) },
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
      <PageHeader title={`Venda ${sale.sale_number}`} description={`Cliente: ${sale.customer_name ?? 'Consumidor não identificado'}`} action={<StatusBadge tone={tone}>{label}</StatusBadge>} />

      {editable && (
        <FormSection title="Observações" columns={1}>
          <div className="flex gap-3">
            <input className={formFieldClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <AsyncButton
              tone="secondary"
              label="Salvar"
              busyLabel="Salvando…"
              onClick={async () => {
                const response = await api(`/sales/${id}`, { method: 'PATCH', body: JSON.stringify({ notes: notes || null }) });
                if (!response.ok) setError(friendlyError((await response.json().catch(() => ({}))).error));
                else await load();
              }}
            />
          </div>
        </FormSection>
      )}

      <div className="flex flex-wrap gap-3">
        {editable && <AsyncButton tone="primary" label="Confirmar" onClick={() => setPendingAction('confirm')} />}
        {cancellable && <AsyncButton tone="destructive" label="Cancelar venda" onClick={() => setPendingAction('cancel')} />}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-emerald-100">Itens</h2>
        <DataTable columns={columns} rows={sale.items} rowKey={(row) => row.id} state="ready" emptyState={<EmptyState icon={ShoppingCart} title="Nenhum item adicionado" description="Adicione peças ou serviços a esta venda." />} />
      </div>

      {editable && (
        <FormSection title="Adicionar item">
          <form onSubmit={addItem} className="contents">
            <FormField label="Tipo" htmlFor="item-type">
              <select id="item-type" className={formFieldClass} value={item.type} onChange={(e) => setItem({ ...item, type: e.target.value })}>
                <option value="part">Peça</option>
                <option value="service">Serviço</option>
              </select>
            </FormField>
            {item.type === 'part' && (
              <FormField label="Peça (opcional)" htmlFor="item-part">
                <EntityCombobox
                  id="item-part"
                  value={part}
                  onChange={setPart}
                  search={searchParts}
                  getId={(entry) => entry.id}
                  getLabel={partLabel}
                  renderOption={(entry) => <PartOptionRow item={entry} />}
                  placeholder="Buscar por SKU ou descrição…"
                />
              </FormField>
            )}
            <FormField label="Descrição" htmlFor="item-description" span="full">
              <input id="item-description" required className={formFieldClass} value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} />
            </FormField>
            <FormField label="Quantidade" htmlFor="item-quantity">
              <input id="item-quantity" type="number" min="0.001" step="0.001" className={formFieldClass} value={item.quantity} onChange={(e) => setItem({ ...item, quantity: e.target.value })} />
            </FormField>
            <FormField label="Preço unitário" htmlFor="item-price">
              <input id="item-price" type="number" min="0" step="0.01" className={formFieldClass} value={item.unitPrice} onChange={(e) => setItem({ ...item, unitPrice: e.target.value })} />
            </FormField>
            <FormField label="Desconto" htmlFor="item-discount">
              <input id="item-discount" type="number" min="0" step="0.01" className={formFieldClass} value={item.discountAmount} onChange={(e) => setItem({ ...item, discountAmount: e.target.value })} />
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
        Subtotal: {formatCurrency(sale.subtotal)} · Descontos: {formatCurrency(sale.discount_total)} · <span className="font-semibold text-emerald-50">Total: {formatCurrency(sale.total)}</span>
      </p>

      <ConfirmDialog
        open={!!pendingAction}
        title={pendingAction === 'confirm' ? 'Confirmar venda?' : pendingAction === 'cancel' ? 'Cancelar venda?' : ''}
        description={
          pendingAction === 'confirm'
            ? 'O estoque das peças vendidas será baixado e a venda não poderá mais ser editada.'
            : pendingAction === 'cancel'
              ? sale.status === 'confirmed'
                ? 'O estoque das peças vendidas será estornado e a venda será cancelada.'
                : 'A venda será cancelada.'
              : ''
        }
        confirmLabel={pendingAction === 'confirm' ? 'Confirmar venda' : pendingAction === 'cancel' ? 'Cancelar venda' : ''}
        tone={pendingAction === 'cancel' ? 'destructive' : 'default'}
        busy={busy}
        onConfirm={confirmAction}
        onCancel={() => setPendingAction(undefined)}
      />
    </div>
    </RequireOperationalContext>
  );
}
