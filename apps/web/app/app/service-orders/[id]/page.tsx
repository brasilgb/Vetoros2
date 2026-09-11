'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { PlusCircle, Wrench } from 'lucide-react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { Tab, Tabs } from '../../../../components/tabs';
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

type Item = { id: string; type: 'service' | 'part' | 'non_stock'; inventory_part_id: string | null; description: string; quantity: string; unit_price: string; discount_amount: string; total_amount: string };
type FiscalDocument = { id: string; document_type: string; status: string; document_number: number | null };
type Order = {
  id: string; order_number: number; title: string; status: string; customer_name: string; asset_identifier: string | null; reported_problem: string; initial_notes: string | null;
  items: Item[]; subtotal: number; discounts: number; total: number; fiscal_documents: FiscalDocument[];
  // OS-ADV-01/OS-ADV-02: campos operacionais e de garantia sem UI até agora (seção 15 do correio.md).
  priority: 'low' | 'normal' | 'high' | 'urgent'; technician_user_profile_id: string | null; diagnosis: string | null; executed_solution: string | null; technical_notes: string | null;
  started_at: string | null; technically_completed_at: string | null; delivered_at: string | null; delivery_notes: string | null;
  warranty_enabled: boolean; warranty_started_at: string | null; warranty_ends_at: string | null; warranty_notes: string | null;
  service_order_kind: 'standard' | 'warranty_return'; original_service_order_id: string | null;
};
type Technician = { id: string; name: string };
type HistoryEntry = { id: string; previous_status: string | null; new_status: string; reason: string | null; created_at: string };
type ReturnRow = { id: string; order_number: number; status: string; created_at: string; warranty_analysis_result: string | null };
type Payment = { id: string; amount: string; payment_method_name: string; created_at: string; refunded: boolean };
type Receivable = { id: string; installment_number: number; installment_count: number; original_amount: string; paid_amount: string; balance: string; due_date: string; derived_status: string };

const priorityLabel: Record<string, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
// Espelha a máquina de estados validada pelo banco (migration 0033) — só para oferecer os
// próximos passos possíveis; a validação real continua sendo feita pelo trigger no Postgres.
const nextStatuses: Record<string, string[]> = {
  open: ['awaiting_diagnosis', 'in_progress'],
  awaiting_diagnosis: ['awaiting_approval', 'in_progress'],
  awaiting_approval: ['approved'],
  approved: ['in_progress'],
  in_progress: ['awaiting_parts', 'ready', 'completed'],
  awaiting_parts: ['in_progress'],
  ready: ['completed', 'delivered'],
  completed: ['delivered'],
  delivered: [],
  canceled: [],
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

  if (item.type !== 'part') return <span className="text-slate-400">—</span>;

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
        <button onClick={() => { setLinking(true); setSelectedPart(null); setError(''); }} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
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
      <p className="text-xs text-slate-500">
        {stock?.sku} · disponível {stock?.available ?? '—'}
      </p>
      <div className="flex flex-wrap gap-1">
        {(['reserve', 'release', 'consume', 'return'] as const).map((candidate) => (
          <button key={candidate} onClick={() => { setAction(candidate); setQuantity('1'); setError(''); }} className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
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
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') ?? 'general');
  const [order, setOrder] = useState<Order>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [itemForm, setItemForm] = useState({ type: 'service', description: '', quantity: '1', unitPrice: '0', discountAmount: '0' });
  const [part, setPart] = useState<PartOption | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [itemError, setItemError] = useState('');
  const { hasFullContext } = useOperationalContext();

  // OS-ADV-02, seção 15: campos operacionais, transição de status, cancelamento, garantia e
  // histórico — nenhum tinha UI até este marco, embora a API já existisse desde OS-ADV-01.
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [opForm, setOpForm] = useState({ priority: 'normal', technicianUserProfileId: '', diagnosis: '', executedSolution: '', technicalNotes: '', deliveryNotes: '' });
  const [opSaving, setOpSaving] = useState(false);
  const [opError, setOpError] = useState('');
  const [statusTarget, setStatusTarget] = useState<string | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusError, setStatusError] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [warrantyForm, setWarrantyForm] = useState({ enabled: false, startedAt: '', endsAt: '', notes: '' });
  const [warrantySaving, setWarrantySaving] = useState(false);
  const [warrantyError, setWarrantyError] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);

  const load = useCallback(async () => {
    const response = await api(`/service-orders/${id}`);
    if (!response.ok) return setState('error');
    const data: Order = await response.json();
    setOrder(data);
    setOpForm({ priority: data.priority, technicianUserProfileId: data.technician_user_profile_id ?? '', diagnosis: data.diagnosis ?? '', executedSolution: data.executed_solution ?? '', technicalNotes: data.technical_notes ?? '', deliveryNotes: data.delivery_notes ?? '' });
    setWarrantyForm({ enabled: data.warranty_enabled, startedAt: data.warranty_started_at ?? '', endsAt: data.warranty_ends_at ?? '', notes: data.warranty_notes ?? '' });
    const [historyResponse, returnsResponse, paymentsResponse, receivablesResponse] = await Promise.all([api(`/service-orders/${id}/history`), api(`/service-orders/${id}/returns`), api(`/payments?serviceOrderId=${id}&pageSize=100`), api(`/receivables?serviceOrderId=${id}&pageSize=100`)]);
    if (historyResponse.ok) setHistory(await historyResponse.json());
    if (returnsResponse.ok) setReturns(await returnsResponse.json());
    if (paymentsResponse.ok) setPayments((await paymentsResponse.json()).items);
    if (receivablesResponse.ok) setReceivables((await receivablesResponse.json()).items);
    setState('ready');
  }, [id]);

  useEffect(() => {
    if (!hasFullContext) return;
    void load();
    void (async () => {
      const response = await api('/service-orders/technicians');
      if (response.ok) setTechnicians(await response.json());
    })();
  }, [load, hasFullContext]);

  async function saveOperational(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOpSaving(true);
    setOpError('');
    const response = await api(`/service-orders/${id}/operational`, {
      method: 'PATCH',
      body: JSON.stringify({ priority: opForm.priority, technicianUserProfileId: opForm.technicianUserProfileId || null, diagnosis: opForm.diagnosis || null, executedSolution: opForm.executedSolution || null, technicalNotes: opForm.technicalNotes || null, deliveryNotes: opForm.deliveryNotes || null }),
    });
    setOpSaving(false);
    if (!response.ok) return setOpError(friendlyError((await response.json().catch(() => ({}))).error));
    await load();
  }

  async function submitStatusChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusTarget) return;
    setStatusError('');
    const isDeliver = statusTarget === 'delivered';
    const response = await api(`/service-orders/${id}/operational`, {
      method: 'PATCH',
      body: JSON.stringify({ status: statusTarget, reason: statusReason || null, ...(isDeliver ? { deliveredAt: new Date().toISOString() } : {}) }),
    });
    if (!response.ok) return setStatusError(friendlyError((await response.json().catch(() => ({}))).error));
    setStatusTarget(null);
    setStatusReason('');
    await load();
  }

  async function submitCancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCancelError('');
    const response = await api(`/service-orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: cancelReason || null }) });
    if (!response.ok) return setCancelError(friendlyError((await response.json().catch(() => ({}))).error));
    setCanceling(false);
    setCancelReason('');
    await load();
  }

  async function saveWarranty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWarrantySaving(true);
    setWarrantyError('');
    const response = await api(`/service-orders/${id}/warranty`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: warrantyForm.enabled, startedAt: warrantyForm.startedAt || null, endsAt: warrantyForm.endsAt || null, notes: warrantyForm.notes || null }),
    });
    setWarrantySaving(false);
    if (!response.ok) return setWarrantyError(friendlyError((await response.json().catch(() => ({}))).error));
    await load();
  }

  useSetBreadcrumb(order ? `OS ${order.order_number}` : undefined);

  function selectTab(tab: string) {
    setActiveTab(tab);
    const query = new URLSearchParams(window.location.search);
    if (tab === 'general') query.delete('tab'); else query.set('tab', tab);
    window.history.replaceState({}, '', `${window.location.pathname}${query.toString() ? `?${query}` : ''}`);
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddingItem(true);
    setItemError('');
    if (itemForm.type === 'part' && !part) { setAddingItem(false); return setItemError('Selecione uma peça de estoque.'); }
    const response = await api(`/service-orders/${id}/items`, { method: 'POST', body: JSON.stringify({ ...itemForm, inventoryPartId: itemForm.type === 'part' ? part!.id : null }) });
    setAddingItem(false);
    if (!response.ok) return setItemError(friendlyError((await response.json().catch(() => ({}))).error));
    setItemForm({ ...itemForm, description: '', quantity: '1', unitPrice: '0', discountAmount: '0' });
    setPart(null);
    await load();
  }

  if (state === 'loading') return <RequireOperationalContext><p className="text-sm text-slate-500">Carregando…</p></RequireOperationalContext>;
  if (state === 'error' || !order) return <RequireOperationalContext><ErrorState message="Não foi possível carregar esta ordem de serviço." onRetry={load} /></RequireOperationalContext>;

  const { label, tone } = commonStatus(order.status);
  const fiscalDocument = order.fiscal_documents?.[0];
  const columns: DataTableColumn<Item>[] = [
    { key: 'type', header: 'Tipo', render: (row) => row.type === 'part' ? 'Peça' : row.type === 'non_stock' ? 'Material sem estoque' : 'Serviço' },
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
      <Tabs label="Seções da ordem de serviço">
        {([['general', 'Geral'], ['attendance', 'Atendimento'], ['items', 'Itens'], ['financial', 'Financeiro'], ['history', 'Histórico']] as const).map(([value, label]) => <Tab key={value} value={value} active={activeTab === value} onSelect={selectTab}>{label}</Tab>)}
      </Tabs>

      <div hidden={activeTab !== 'general'}>
      <FormSection title="Descrição" columns={1}>
        <p className="text-sm text-slate-700">
          <span className="text-slate-500">Problema relatado: </span>
          {order.reported_problem}
        </p>
        {order.initial_notes && (
          <p className="text-sm text-slate-700">
            <span className="text-slate-500">Observações: </span>
            {order.initial_notes}
          </p>
        )}
      </FormSection>

      <FormSection title="Situação" description="Avançar segue o fluxo operacional da OS; cancelamento é uma ação separada e exige motivo." columns={1}>
        <div className="flex flex-wrap items-center gap-2">
          {(nextStatuses[order.status] ?? []).map((next) => (
            <button key={next} onClick={() => { setStatusTarget(next); setStatusReason(''); setStatusError(''); }} className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">
              {commonStatus(next).label}
            </button>
          ))}
          {order.status !== 'canceled' && (
            <button onClick={() => { setCanceling(true); setCancelReason(''); setCancelError(''); }} className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">
              Cancelar OS
            </button>
          )}
          {(nextStatuses[order.status] ?? []).length === 0 && order.status === 'canceled' && <span className="text-xs text-slate-500">OS cancelada — estado terminal.</span>}
          {(nextStatuses[order.status] ?? []).length === 0 && order.status === 'delivered' && <span className="text-xs text-slate-500">OS entregue — estado terminal (só pode ser cancelada).</span>}
        </div>
        <FormDialog open={statusTarget !== null} title={statusTarget ? `Mover para "${commonStatus(statusTarget).label}"` : ''} submitLabel="Confirmar" error={statusError} onCancel={() => setStatusTarget(null)} onSubmit={submitStatusChange}>
          <FormField label="Motivo (opcional)" htmlFor="status-reason" span="full">
            <input id="status-reason" className={formFieldClass} value={statusReason} onChange={(e) => setStatusReason(e.target.value)} />
          </FormField>
        </FormDialog>
        <FormDialog open={canceling} title="Cancelar ordem de serviço" description="Bloqueado se houver reserva de estoque ativa, pagamento sem estorno ou título a receber ativo." submitLabel="Cancelar OS" error={cancelError} onCancel={() => setCanceling(false)} onSubmit={submitCancel}>
          <FormField label="Motivo do cancelamento" htmlFor="cancel-reason" span="full">
            <input id="cancel-reason" className={formFieldClass} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </FormField>
        </FormDialog>
      </FormSection>
      <div className="flex flex-wrap gap-2"><Link href={`/app/service-orders/${id}/print`} className="inline-flex rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Imprimir comprovante não fiscal</Link>{(['completed', 'delivered'].includes(order.status)) && <Link href={fiscalDocument ? `/app/fiscal/${fiscalDocument.id}` : `/app/fiscal?origin=service_order&serviceOrderId=${id}`} className="inline-flex rounded-xl border border-blue-300 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50">{fiscalDocument ? 'Ver documento fiscal' : 'Emitir documento fiscal'}</Link>}</div>
      </div>

      {(() => {
        const received = payments.filter((payment) => !payment.refunded).reduce((sum, payment) => sum + Number(payment.amount), 0);
        const pending = receivables.reduce((sum, receivable) => sum + Number(receivable.balance), 0);
        const financialStatus = receivables.length === 0 ? 'Sem parcelamento' : pending <= 0.005 ? 'Quitado' : received > 0 ? 'Parcial' : 'Em aberto';
        return <div hidden={activeTab !== 'financial'}><FormSection title="Financeiro" description="Recebimentos e parcelas desta OS, sem alterar o fluxo operacional ou o estoque.">
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Link href={`/app/payments?new=1&serviceOrderId=${id}`} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Registrar recebimento</Link>
          <Link href={`/app/receivables?new=1&serviceOrderId=${id}`} className="rounded-xl border border-blue-300 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50">Gerar parcelamento</Link>
        </div>
        <div className="grid gap-2 text-sm text-slate-600 sm:col-span-2 sm:grid-cols-4">
          <p>Total da OS: <strong className="text-slate-900">{formatCurrency(order.total)}</strong></p>
          <p>Recebido: <strong className="text-slate-900">{formatCurrency(received)}</strong></p>
          <p>Pendente: <strong className="text-slate-900">{formatCurrency(pending || Math.max(order.total - received, 0))}</strong></p>
          <p>Situação: <strong className="text-slate-900">{financialStatus}</strong></p>
        </div>
        {payments.length > 0 && <div className="sm:col-span-2"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recebimentos</h3><ul className="flex flex-col gap-1">{payments.map((payment) => <li key={payment.id}><Link href={`/app/payments/${payment.id}`} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"><span>{payment.payment_method_name} · {formatCurrency(payment.amount)}</span><span className="text-xs text-slate-500">{payment.refunded ? 'Estornado' : 'Ativo'}</span></Link></li>)}</ul></div>}
        {receivables.length > 0 && <div className="sm:col-span-2"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Parcelas</h3><ul className="flex flex-col gap-1">{receivables.map((receivable) => <li key={receivable.id}><Link href={`/app/receivables/${receivable.id}`} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"><span>Parcela {receivable.installment_number}/{receivable.installment_count}</span><span>{formatCurrency(receivable.original_amount)} · {receivable.derived_status}</span></Link></li>)}</ul></div>}
        </FormSection></div>;
      })()}

      <div hidden={activeTab !== 'attendance'}><FormSection title="Técnico e diagnóstico">
        <form onSubmit={saveOperational} className="contents">
          <FormField label="Prioridade" htmlFor="op-priority">
            <select id="op-priority" className={formFieldClass} value={opForm.priority} onChange={(e) => setOpForm({ ...opForm, priority: e.target.value })}>
              {Object.entries(priorityLabel).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </FormField>
          <FormField label="Técnico responsável" htmlFor="op-technician">
            <select id="op-technician" className={formFieldClass} value={opForm.technicianUserProfileId} onChange={(e) => setOpForm({ ...opForm, technicianUserProfileId: e.target.value })}>
              <option value="">Não atribuído</option>
              {technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
            </select>
          </FormField>
          <FormField label="Diagnóstico técnico" htmlFor="op-diagnosis" span="full">
            <textarea id="op-diagnosis" rows={3} className={formFieldClass} value={opForm.diagnosis} onChange={(e) => setOpForm({ ...opForm, diagnosis: e.target.value })} />
          </FormField>
          <FormField label="Solução executada" htmlFor="op-solution" span="full">
            <textarea id="op-solution" rows={3} className={formFieldClass} value={opForm.executedSolution} onChange={(e) => setOpForm({ ...opForm, executedSolution: e.target.value })} />
          </FormField>
          <FormField label="Notas técnicas" htmlFor="op-notes" span="full">
            <textarea id="op-notes" rows={2} className={formFieldClass} value={opForm.technicalNotes} onChange={(e) => setOpForm({ ...opForm, technicalNotes: e.target.value })} />
          </FormField>
          <FormField label="Observações de entrega" htmlFor="op-delivery-notes" span="full">
            <textarea id="op-delivery-notes" rows={2} className={formFieldClass} value={opForm.deliveryNotes} onChange={(e) => setOpForm({ ...opForm, deliveryNotes: e.target.value })} />
          </FormField>
          {opError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{opError}</p>}
          <div className="sm:col-span-2">
            <button type="submit" disabled={opSaving} className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {opSaving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </FormSection>

      <FormSection title="Garantia">
        <form onSubmit={saveWarranty} className="contents">
          <FormField label="Garantia habilitada" htmlFor="warranty-enabled">
            <label className="mt-1 flex items-center gap-2 text-sm text-slate-700">
              <input id="warranty-enabled" type="checkbox" checked={warrantyForm.enabled} onChange={(e) => setWarrantyForm({ ...warrantyForm, enabled: e.target.checked })} />
              Esta OS tem garantia
            </label>
          </FormField>
          <div />
          <FormField label="Início da garantia" htmlFor="warranty-started">
            <input id="warranty-started" type="date" className={formFieldClass} value={warrantyForm.startedAt} onChange={(e) => setWarrantyForm({ ...warrantyForm, startedAt: e.target.value })} />
          </FormField>
          <FormField label="Fim da garantia" htmlFor="warranty-ends">
            <input id="warranty-ends" type="date" className={formFieldClass} value={warrantyForm.endsAt} onChange={(e) => setWarrantyForm({ ...warrantyForm, endsAt: e.target.value })} />
          </FormField>
          <FormField label="Notas da garantia" htmlFor="warranty-notes" span="full">
            <textarea id="warranty-notes" rows={2} className={formFieldClass} value={warrantyForm.notes} onChange={(e) => setWarrantyForm({ ...warrantyForm, notes: e.target.value })} />
          </FormField>
          {warrantyError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{warrantyError}</p>}
          <div className="sm:col-span-2">
            <button type="submit" disabled={warrantySaving} className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {warrantySaving ? 'Salvando…' : 'Salvar garantia'}
            </button>
          </div>
        </form>
        {returns.length > 0 && (
          <div className="sm:col-span-2">
            <h3 className="mb-2 text-xs font-semibold text-slate-500">Retornos em garantia desta OS</h3>
            <ul className="flex flex-col gap-1">
              {returns.map((r) => {
                const returnStatus = commonStatus(r.status);
                return (
                  <li key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <span>OS {r.order_number}</span>
                    <StatusBadge tone={returnStatus.tone}>{returnStatus.label}</StatusBadge>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </FormSection></div>

      {history.length > 0 && activeTab === 'history' && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Histórico</h2>
          <ul className="flex flex-col gap-1.5">
            {history.map((entry) => {
              const from = entry.previous_status ? commonStatus(entry.previous_status).label : null;
              const to = commonStatus(entry.new_status).label;
              return (
                <li key={entry.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600">
                  <span className="font-medium text-slate-800">{from ? `${from} → ${to}` : to}</span>
                  {entry.reason && <span> · {entry.reason}</span>}
                  <span className="text-slate-400"> · {new Date(entry.created_at).toLocaleString('pt-BR')}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div hidden={activeTab !== 'items'}>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Itens da OS</h2>
        <DataTable
          columns={columns}
          rows={order.items}
          rowKey={(row) => row.id}
          state="ready"
          emptyState={<EmptyState icon={Wrench} title="Nenhum item adicionado" description="Adicione serviços ou peças usados nesta OS." />}
        />
      </div>

      <div hidden={activeTab !== 'items'}><FormSection title="Adicionar item">
        <form onSubmit={addItem} className="contents">
          <FormField label="Tipo" htmlFor="item-type">
            <select id="item-type" className={formFieldClass} value={itemForm.type} onChange={(e) => setItemForm({ ...itemForm, type: e.target.value })}>
              <option value="service">Serviço</option>
              <option value="part">Peça</option>
              <option value="non_stock">Material sem estoque</option>
            </select>
          </FormField>
          {itemForm.type === 'part' && (
            <FormField label="Peça de estoque" htmlFor="os-item-part">
              <EntityCombobox id="os-item-part" value={part} onChange={setPart} search={searchParts} getId={(entry) => entry.id} getLabel={partLabel} renderOption={(entry) => <PartOptionRow item={entry} />} placeholder="Buscar por SKU ou descrição…" />
            </FormField>
          )}
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
            <p role="alert" className="text-sm text-red-700 sm:col-span-2">
              {itemError}
            </p>
          )}
          <div className="sm:col-span-2">
            <button type="submit" disabled={addingItem} className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              <PlusCircle className="h-4 w-4" /> {addingItem ? 'Adicionando…' : 'Adicionar item'}
            </button>
          </div>
        </form>
      </FormSection></div>

      <p className="text-right text-sm text-slate-600">
        Subtotal: {formatCurrency(order.subtotal)} · Descontos: {formatCurrency(order.discounts)} · <span className="font-semibold text-slate-900">Total: {formatCurrency(order.total)}</span>
      </p>
    </div>
    </RequireOperationalContext>
  );
}
