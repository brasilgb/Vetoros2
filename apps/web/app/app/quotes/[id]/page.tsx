'use client';
import { use, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, PlusCircle, Trash2 } from 'lucide-react';
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

type Item = { id: string; type: string; description: string; quantity: string; unit_price: string; discount_amount: string; total_amount: string };
type Quote = {
  id: string; quote_number: number; title: string; status: string; customer_name: string; asset_identifier: string | null; converted_service_order_id: string | null;
  items: Item[]; subtotal: number; discounts: number; total: number;
};

const transitions: Record<string, string[]> = { draft: ['sent', 'cancelled'], sent: ['approved', 'rejected', 'expired', 'cancelled'], approved: [], rejected: [], expired: [], cancelled: [] };

export default function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [quote, setQuote] = useState<Quote>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [title, setTitle] = useState('');
  const [itemForm, setItemForm] = useState({ type: 'service', description: '', quantity: '1', unitPrice: '0', discountAmount: '0' });
  const [addingItem, setAddingItem] = useState(false);
  const [error, setError] = useState('');
  const [pendingTransition, setPendingTransition] = useState<string>();
  const [pendingConvert, setPendingConvert] = useState(false);
  const [busy, setBusy] = useState(false);
  const { hasFullContext } = useOperationalContext();

  const load = useCallback(async () => {
    const response = await api(`/quotes/${id}`);
    if (!response.ok) return setState('error');
    const data = await response.json();
    setQuote(data);
    setTitle(data.title);
    setState('ready');
  }, [id]);

  useEffect(() => {
    if (!hasFullContext) return;
    void load();
  }, [load, hasFullContext]);

  useSetBreadcrumb(quote ? `Orçamento ${quote.quote_number}` : undefined);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddingItem(true);
    setError('');
    const response = await api(`/quotes/${id}/items`, { method: 'POST', body: JSON.stringify(itemForm) });
    setAddingItem(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    setItemForm({ ...itemForm, description: '', quantity: '1', unitPrice: '0', discountAmount: '0' });
    await load();
  }

  async function removeItem(itemId: string) {
    await api(`/quotes/${id}/items/${itemId}`, { method: 'DELETE' });
    await load();
  }

  async function confirmTransition() {
    if (!pendingTransition) return;
    setBusy(true);
    const response = await api(`/quotes/${id}`, { method: 'PATCH', body: JSON.stringify({ status: pendingTransition }) });
    setBusy(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    setPendingTransition(undefined);
    await load();
  }

  async function confirmConvert() {
    setBusy(true);
    const response = await api(`/quotes/${id}/convert`, { method: 'POST' });
    setBusy(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    router.push(`/app/service-orders/${(await response.json()).id}`);
  }

  if (state === 'loading') return <RequireOperationalContext><p className="text-sm text-emerald-100/60">Carregando…</p></RequireOperationalContext>;
  if (state === 'error' || !quote) return <RequireOperationalContext><ErrorState message="Não foi possível carregar este orçamento." onRetry={load} /></RequireOperationalContext>;

  const { label, tone } = commonStatus(quote.status);
  const editable = quote.status === 'draft';
  const columns: DataTableColumn<Item>[] = [
    { key: 'type', header: 'Tipo', render: (row) => (row.type === 'part' ? 'Peça' : 'Serviço') },
    { key: 'description', header: 'Descrição', render: (row) => row.description },
    { key: 'quantity', header: 'Qtd.', align: 'right', render: (row) => Number(row.quantity), hideBelow: 'sm' },
    { key: 'unit_price', header: 'Unitário', align: 'right', render: (row) => formatCurrency(row.unit_price), hideBelow: 'md' },
    { key: 'total', header: 'Total', align: 'right', render: (row) => formatCurrency(row.total_amount) },
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
      <PageHeader title={`Orçamento ${quote.quote_number} — ${editable ? title : quote.title}`} description={`Cliente: ${quote.customer_name}${quote.asset_identifier ? ` · Equipamento: ${quote.asset_identifier}` : ''}`} action={<StatusBadge tone={tone}>{label}</StatusBadge>} />

      {editable && (
        <FormSection title="Título" columns={1}>
          <div className="flex gap-3">
            <input className={formFieldClass} value={title} onChange={(e) => setTitle(e.target.value)} />
            <AsyncButton
              tone="secondary"
              label="Salvar"
              busyLabel="Salvando…"
              onClick={async () => {
                const response = await api(`/quotes/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
                if (!response.ok) setError(friendlyError((await response.json().catch(() => ({}))).error));
                else await load();
              }}
            />
          </div>
        </FormSection>
      )}

      <div className="flex flex-wrap gap-3">
        {(transitions[quote.status] ?? []).map((next) => (
          <AsyncButton key={next} tone={next === 'cancelled' || next === 'rejected' ? 'destructive' : 'secondary'} label={`Marcar como ${commonStatus(next).label}`} onClick={() => setPendingTransition(next)} />
        ))}
        {quote.status === 'approved' && !quote.converted_service_order_id && <AsyncButton tone="primary" label="Converter em OS" onClick={() => setPendingConvert(true)} />}
        {quote.converted_service_order_id && (
          <a href={`/app/service-orders/${quote.converted_service_order_id}`} className="rounded-xl border border-emerald-800 px-4 py-2.5 text-sm text-emerald-100 hover:bg-emerald-950">
            Ver OS gerada
          </a>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-emerald-100">Itens</h2>
        <DataTable columns={columns} rows={quote.items} rowKey={(row) => row.id} state="ready" emptyState={<EmptyState icon={FileText} title="Nenhum item adicionado" description="Adicione serviços ou peças a este orçamento." />} />
      </div>

      {editable && (
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
        Subtotal: {formatCurrency(quote.subtotal)} · Descontos: {formatCurrency(quote.discounts)} · <span className="font-semibold text-emerald-50">Total: {formatCurrency(quote.total)}</span>
      </p>

      <ConfirmDialog
        open={!!pendingTransition}
        title={`Marcar orçamento como ${pendingTransition ? commonStatus(pendingTransition).label.toLowerCase() : ''}?`}
        description="Essa mudança de status pode não ser reversível, dependendo do novo status."
        confirmLabel="Confirmar"
        tone={pendingTransition === 'cancelled' || pendingTransition === 'rejected' ? 'destructive' : 'default'}
        busy={busy}
        onConfirm={confirmTransition}
        onCancel={() => setPendingTransition(undefined)}
      />
      <ConfirmDialog
        open={pendingConvert}
        title="Converter em Ordem de Serviço?"
        description="Uma nova OS será criada com os itens deste orçamento. Esta ação não pode ser desfeita."
        confirmLabel="Converter"
        busy={busy}
        onConfirm={confirmConvert}
        onCancel={() => setPendingConvert(false)}
      />
    </div>
    </RequireOperationalContext>
  );
}
