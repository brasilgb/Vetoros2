'use client';
import { use, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { PlusCircle, Wrench } from 'lucide-react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { DataTable, type DataTableColumn } from '../../../../components/data-table';
import { EmptyState } from '../../../../components/empty-state';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { StatusBadge, commonStatus } from '../../../../components/status-badge';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormDialog } from '../../../../components/form-dialog';
import { formatCurrency } from '../../../../lib/format';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../components/operational-context';
import { EntityCombobox } from '../../../../components/entity-combobox';
import { PartOptionRow, partLabel } from '../../../../components/entity-option-rows';
import { searchParts, type PartOption } from '../../../../lib/entity-search';

type Item = { id: string; type: 'service' | 'part'; inventory_part_id: string | null; description: string; quantity: string; unit_price: string; discount_amount: string; total_amount: string };
type Order = {
  order_number: number; title: string; status: string; customer_name: string; asset_identifier: string | null; reported_problem: string; initial_notes: string | null;
  items: Item[]; subtotal: number; discounts: number; total: number;
};
type Stock = { sku: string; description: string; physical_balance: number; total_reserved: number; item_reserved: number; consumed: number; returned: number; status: string; available: number };

const stockActionLabel: Record<'reserve' | 'release' | 'consume' | 'return', string> = { reserve: 'Reservar', release: 'Liberar', consume: 'Consumir', return: 'Devolver' };

// Célula de estoque de um item de peça (seção 3.1 do correio.md UX-02): substitui os antigos
// `prompt()`/`confirm()` por um `FormDialog` — a própria confirmação passa a ser "abrir o
// diálogo com a quantidade certa e clicar em Confirmar", sem diálogo nativo nenhum. Reserva,
// liberação, consumo e devolução continuam chamando exatamente `service_order_stock_action` via
// os mesmos endpoints do OS-02/EST-02 — nenhuma regra de estoque mudou.
function ItemStockCell({ orderId, item, onChanged }: { orderId: string; item: Item; onChanged: () => Promise<void> }) {
  const [stock, setStock] = useState<Stock>();
  const [action, setAction] = useState<'reserve' | 'release' | 'consume' | 'return' | null>(null);
  const [linking, setLinking] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [selectedPart, setSelectedPart] = useState<PartOption | null>(null);
  const [error, setError] = useState('');

  const loadStock = useCallback(async () => {
    const response = await api(`/service-orders/${orderId}/items/${item.id}/stock`);
    if (response.ok) setStock(await response.json());
  }, [orderId, item.id]);

  useEffect(() => {
    if (item.inventory_part_id) void loadStock();
  }, [item.inventory_part_id, loadStock]);

  if (item.type !== 'part') return <span className="text-emerald-100/30">—</span>;

  async function submitStockAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    setError('');
    const response = await api(`/service-orders/${orderId}/items/${item.id}/stock/${action}`, {
      method: 'POST',
      body: JSON.stringify({ quantity: Number(quantity), idempotencyKey: crypto.randomUUID() }),
    });
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    setAction(null);
    await loadStock();
    await onChanged();
  }

  async function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPart) return setError('Selecione uma peça.');
    setError('');
    const response = await api(`/service-orders/${orderId}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ inventoryPartId: selectedPart.id }) });
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    setLinking(false);
    await onChanged();
  }

  if (!item.inventory_part_id) {
    return (
      <>
        <button onClick={() => { setLinking(true); setSelectedPart(null); setError(''); }} className="rounded-lg border border-emerald-800 px-2.5 py-1 text-xs text-emerald-100 hover:bg-emerald-950">
          Vincular peça
        </button>
        <FormDialog open={linking} title="Vincular peça de estoque" description="Busque pelo SKU ou descrição." submitLabel="Vincular" error={error} onCancel={() => setLinking(false)} onSubmit={submitLink}>
          <FormField label="Peça" htmlFor="part-search">
            <EntityCombobox
              id="part-search"
              value={selectedPart}
              onChange={(next) => { setSelectedPart(next); if (next) setError(''); }}
              search={searchParts}
              getId={(entry) => entry.id}
              getLabel={partLabel}
              renderOption={(entry) => <PartOptionRow item={entry} />}
              placeholder="Buscar por SKU ou descrição…"
              hasError={!selectedPart && Boolean(error)}
            />
          </FormField>
        </FormDialog>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-emerald-100/60">
        {stock?.sku} · disponível {stock?.available ?? '—'}
      </p>
      <div className="flex flex-wrap gap-1">
        {(['reserve', 'release', 'consume', 'return'] as const).map((candidate) => (
          <button key={candidate} onClick={() => { setAction(candidate); setQuantity('1'); setError(''); }} className="rounded-lg border border-emerald-800 px-2 py-1 text-xs text-emerald-100 hover:bg-emerald-950">
            {stockActionLabel[candidate]}
          </button>
        ))}
      </div>
      <FormDialog
        open={action !== null}
        title={action ? `${stockActionLabel[action]} estoque` : ''}
        description={`${stock?.sku ?? ''} — ${stock?.description ?? ''}. Disponível: ${stock?.available ?? 0}.`}
        submitLabel="Confirmar"
        error={error}
        onCancel={() => setAction(null)}
        onSubmit={submitStockAction}
      >
        <FormField label="Quantidade" htmlFor="stock-quantity">
          <input id="stock-quantity" type="number" min="0.001" step="0.001" required autoFocus className={formFieldClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </FormField>
      </FormDialog>
    </div>
  );
}

export default function ServiceOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [itemForm, setItemForm] = useState({ type: 'service', description: '', quantity: '1', unitPrice: '0', discountAmount: '0' });
  const [addingItem, setAddingItem] = useState(false);
  const [itemError, setItemError] = useState('');
  const { hasFullContext } = useOperationalContext();

  const load = useCallback(async () => {
    const response = await api(`/service-orders/${id}`);
    if (!response.ok) return setState('error');
    setOrder(await response.json());
    setState('ready');
  }, [id]);

  useEffect(() => {
    if (!hasFullContext) return;
    void load();
  }, [load, hasFullContext]);

  useSetBreadcrumb(order ? `OS ${order.order_number}` : undefined);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddingItem(true);
    setItemError('');
    const response = await api(`/service-orders/${id}/items`, { method: 'POST', body: JSON.stringify(itemForm) });
    setAddingItem(false);
    if (!response.ok) return setItemError(friendlyError((await response.json().catch(() => ({}))).error));
    setItemForm({ ...itemForm, description: '', quantity: '1', unitPrice: '0', discountAmount: '0' });
    await load();
  }

  if (state === 'loading') return <RequireOperationalContext><p className="text-sm text-emerald-100/60">Carregando…</p></RequireOperationalContext>;
  if (state === 'error' || !order) return <RequireOperationalContext><ErrorState message="Não foi possível carregar esta ordem de serviço." onRetry={load} /></RequireOperationalContext>;

  const { label, tone } = commonStatus(order.status);
  const columns: DataTableColumn<Item>[] = [
    { key: 'type', header: 'Tipo', render: (row) => (row.type === 'part' ? 'Peça' : 'Serviço') },
    { key: 'description', header: 'Descrição', render: (row) => row.description },
    { key: 'quantity', header: 'Qtd.', align: 'right', render: (row) => Number(row.quantity), hideBelow: 'sm' },
    { key: 'unit_price', header: 'Unitário', align: 'right', render: (row) => formatCurrency(row.unit_price), hideBelow: 'md' },
    { key: 'total', header: 'Total', align: 'right', render: (row) => formatCurrency(row.total_amount) },
    { key: 'stock', header: 'Estoque', render: (row) => <ItemStockCell orderId={id} item={row} onChanged={load} /> },
  ];

  return (
    <RequireOperationalContext>
    <div className="flex flex-col gap-6">
      <PageHeader title={`OS ${order.order_number} — ${order.title}`} description={`Cliente: ${order.customer_name}${order.asset_identifier ? ` · Equipamento: ${order.asset_identifier}` : ''}`} action={<StatusBadge tone={tone}>{label}</StatusBadge>} />

      <FormSection title="Descrição" columns={1}>
        <p className="text-sm text-emerald-100">
          <span className="text-emerald-100/50">Problema relatado: </span>
          {order.reported_problem}
        </p>
        {order.initial_notes && (
          <p className="text-sm text-emerald-100">
            <span className="text-emerald-100/50">Observações: </span>
            {order.initial_notes}
          </p>
        )}
      </FormSection>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-emerald-100">Itens da OS</h2>
        <DataTable
          columns={columns}
          rows={order.items}
          rowKey={(row) => row.id}
          state="ready"
          emptyState={<EmptyState icon={Wrench} title="Nenhum item adicionado" description="Adicione serviços ou peças usados nesta OS." />}
        />
      </div>

      <FormSection title="Adicionar item">
        <form onSubmit={addItem} className="contents">
          <FormField label="Tipo" htmlFor="item-type">
            <select id="item-type" className={formFieldClass} value={itemForm.type} onChange={(e) => setItemForm({ ...itemForm, type: e.target.value })}>
              <option value="service">Serviço</option>
              <option value="part">Peça</option>
            </select>
          </FormField>
          <FormField label="Descrição" htmlFor="item-description" span="full">
            <input id="item-description" required className={formFieldClass} value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} />
          </FormField>
          <FormField label="Quantidade" htmlFor="item-quantity">
            <input id="item-quantity" type="number" min="0.001" step="0.001" className={formFieldClass} value={itemForm.quantity} onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })} />
          </FormField>
          <FormField label="Preço unitário" htmlFor="item-price">
            <input id="item-price" type="number" min="0" step="0.01" className={formFieldClass} value={itemForm.unitPrice} onChange={(e) => setItemForm({ ...itemForm, unitPrice: e.target.value })} />
          </FormField>
          <FormField label="Desconto" htmlFor="item-discount">
            <input id="item-discount" type="number" min="0" step="0.01" className={formFieldClass} value={itemForm.discountAmount} onChange={(e) => setItemForm({ ...itemForm, discountAmount: e.target.value })} />
          </FormField>
          {itemError && (
            <p role="alert" className="text-sm text-red-300 sm:col-span-2">
              {itemError}
            </p>
          )}
          <div className="sm:col-span-2">
            <button type="submit" disabled={addingItem} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950 disabled:opacity-50">
              <PlusCircle className="h-4 w-4" /> {addingItem ? 'Adicionando…' : 'Adicionar item'}
            </button>
          </div>
        </form>
      </FormSection>

      <p className="text-right text-sm text-emerald-100/70">
        Subtotal: {formatCurrency(order.subtotal)} · Descontos: {formatCurrency(order.discounts)} · <span className="font-semibold text-emerald-50">Total: {formatCurrency(order.total)}</span>
      </p>
    </div>
    </RequireOperationalContext>
  );
}
