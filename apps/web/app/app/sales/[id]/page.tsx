'use client';
import { use, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
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
import { formatCurrency, formatDate } from '../../../../lib/format';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../components/operational-context';
import { EntityCombobox } from '../../../../components/entity-combobox';
import { PartOptionRow, partLabel } from '../../../../components/entity-option-rows';
import { searchParts, type PartOption } from '../../../../lib/entity-search';

type Item = { id: string; type: string; part_sku: string | null; description: string; quantity: string; unit_price: string; discount_amount: string; total: string };
type Sale = { id: string; sale_number: number; sale_date: string; customer_name: string | null; branch_name: string; status: string; notes: string | null; items: Item[]; subtotal: string; discount_total: string; total: string };
// VEN-ADV-01, seção 24: a venda não tinha nenhuma visibilidade financeira — nem os pagamentos já
// recebidos, nem os recebíveis gerados a partir dela apareciam aqui (só no sentido inverso, já
// fechado no FIN-ADV-01). Mesmo padrão de lista+link já usado em payables/receivables/pedido de
// compra.
type Payment = { id: string; amount: string; payment_method_name: string; created_at: string; refunded: boolean };
type Receivable = { id: string; installment_number: number; installment_count: number; original_amount: string; derived_status: string };

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
  const [payments, setPayments] = useState<Payment[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const { hasFullContext } = useOperationalContext();

  const load = useCallback(async () => {
    const response = await api(`/sales/${id}`);
    if (!response.ok) return setState('error');
    const data: Sale = await response.json();
    setSale(data);
    setNotes(data.notes ?? '');
    const [paymentsResponse, receivablesResponse] = await Promise.all([api(`/payments?saleId=${id}&pageSize=100`), api(`/receivables?saleId=${id}&pageSize=100`)]);
    if (paymentsResponse.ok) setPayments((await paymentsResponse.json()).items);
    if (receivablesResponse.ok) setReceivables((await receivablesResponse.json()).items);
    setState('ready');
  }, [id]);

  useEffect(() => {
    if (!hasFullContext) return;
    void load();
  }, [load, hasFullContext]);

  useSetBreadcrumb(sale ? `Venda ${sale.sale_number}` : undefined);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (item.type === 'part' && !part) return setError('Selecione uma peça de estoque.');
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

  if (state === 'loading') return <RequireOperationalContext><p className="text-sm text-slate-500">Carregando…</p></RequireOperationalContext>;
  if (state === 'error' || !sale) return <RequireOperationalContext><ErrorState message="Não foi possível carregar esta venda." onRetry={load} /></RequireOperationalContext>;

  const { label, tone } = commonStatus(sale.status);
  const editable = sale.status === 'draft';
  const cancellable = sale.status === 'draft' || sale.status === 'confirmed';

  const columns: DataTableColumn<Item>[] = [
    { key: 'type', header: 'Tipo', render: (row) => row.type === 'part' ? 'Peça' : row.type === 'non_stock' ? 'Material sem estoque' : 'Serviço' },
    { key: 'description', header: 'Descrição', render: (row) => `${row.part_sku ? `${row.part_sku} — ` : ''}${row.description}` },
    { key: 'quantity', header: 'Qtd.', align: 'right', render: (row) => Number(row.quantity), hideBelow: 'sm' },
    { key: 'unit_price', header: 'Unitário', align: 'right', render: (row) => formatCurrency(row.unit_price), hideBelow: 'md' },
    { key: 'total', header: 'Total', align: 'right', render: (row) => formatCurrency(row.total) },
    ...(editable
      ? [{ key: 'actions', header: '', align: 'right' as const, render: (row: Item) => (
          <button onClick={() => removeItem(row.id)} aria-label="Excluir item" className="rounded-lg p-1.5 text-slate-500 hover:bg-red-100 hover:text-red-800">
            <Trash2 className="h-4 w-4" />
          </button>
        ) }]
      : []),
  ];

  return (
    <RequireOperationalContext>
    <div className="flex flex-col gap-6">
      <PageHeader title={`Venda ${sale.sale_number}`} description={`${formatDate(sale.sale_date)} · ${sale.branch_name} · Cliente: ${sale.customer_name ?? 'Consumidor não identificado'}`} action={<StatusBadge tone={tone}>{label}</StatusBadge>} />

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
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Itens</h2>
        <DataTable columns={columns} rows={sale.items} rowKey={(row) => row.id} state="ready" emptyState={<EmptyState icon={ShoppingCart} title="Nenhum item adicionado" description="Adicione peças ou serviços a esta venda." />} />
      </div>

      {editable && (
        <FormSection title="Adicionar item">
          <form onSubmit={addItem} className="contents">
            <FormField label="Tipo" htmlFor="item-type">
              <select id="item-type" className={formFieldClass} value={item.type} onChange={(e) => setItem({ ...item, type: e.target.value })}>
                <option value="part">Peça</option>
                <option value="service">Serviço</option>
                <option value="non_stock">Material sem estoque</option>
              </select>
            </FormField>
            {item.type === 'part' && (
              <FormField label="Peça de estoque" htmlFor="item-part">
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
              <button type="submit" disabled={addingItem} className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                <PlusCircle className="h-4 w-4" /> {addingItem ? 'Adicionando…' : 'Adicionar item'}
              </button>
            </div>
          </form>
        </FormSection>
      )}

      {(payments.length > 0 || receivables.length > 0) && (
        <div className="grid gap-6 sm:grid-cols-2">
          {payments.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Pagamentos recebidos</h2>
              <ul className="flex flex-col gap-2">
                {payments.map((payment) => (
                  <li key={payment.id}>
                    <Link href={`/app/payments/${payment.id}`} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50">
                      <span>
                        {payment.payment_method_name} · {formatDate(payment.created_at)}
                      </span>
                      <span className={payment.refunded ? 'text-red-700' : 'font-semibold text-slate-900'}>
                        {payment.refunded ? 'Estornado' : formatCurrency(payment.amount)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {receivables.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Recebíveis gerados</h2>
              <ul className="flex flex-col gap-2">
                {receivables.map((receivable) => {
                  const receivableStatus = commonStatus(receivable.derived_status);
                  return (
                    <li key={receivable.id}>
                      <Link href={`/app/receivables/${receivable.id}`} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50">
                        <span>
                          Parcela {receivable.installment_number}/{receivable.installment_count} · {formatCurrency(receivable.original_amount)}
                        </span>
                        <StatusBadge tone={receivableStatus.tone}>{receivableStatus.label}</StatusBadge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <p className="text-right text-sm text-slate-600">
        Subtotal: {formatCurrency(sale.subtotal)} · Descontos: {formatCurrency(sale.discount_total)} · <span className="font-semibold text-slate-900">Total: {formatCurrency(sale.total)}</span>
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
