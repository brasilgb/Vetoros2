'use client';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { StatusBadge, type StatusTone } from '../../../../components/status-badge';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormDialog } from '../../../../components/form-dialog';
import { EntityCombobox } from '../../../../components/entity-combobox';
import { formatCurrency, formatDate, formatDateTime } from '../../../../lib/format';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../components/operational-context';
import { searchPaymentsForOrigin, type PaymentOption } from '../../../../lib/entity-search';

type Sibling = { id: string; installment_number: number; installment_count: number; original_amount: string; due_date: string; derived_status: string };
type Allocation = { id: string; amount: string; created_at: string; payment_id: string; payment_amount: string; payment_created_at: string; payment_method_name: string; payment_refunded: boolean; created_by_name: string | null };
type Receivable = {
  id: string; due_date: string; installment_number: number; installment_count: number; customer_name: string; branch_name: string;
  origin: 'sale' | 'service_order'; sale_number: number | null; service_order_number: number | null; sale_id: string | null; service_order_id: string | null;
  original_amount: string; paid_amount: string; balance: string; derived_status: 'open' | 'partial' | 'paid' | 'overdue' | 'canceled';
  status: 'active' | 'canceled'; cancel_reason: string | null; siblings: Sibling[]; allocations: Allocation[];
};

const statusLabels: Record<Receivable['derived_status'], { label: string; tone: StatusTone }> = {
  open: { label: 'Em aberto', tone: 'info' }, partial: { label: 'Parcial', tone: 'warning' }, paid: { label: 'Quitado', tone: 'success' },
  overdue: { label: 'Atrasado', tone: 'danger' }, canceled: { label: 'Cancelado', tone: 'neutral' },
};

export default function ReceivableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { hasFullContext } = useOperationalContext();
  const [receivable, setReceivable] = useState<Receivable>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const [allocateDialog, setAllocateDialog] = useState(false);
  const [payment, setPayment] = useState<PaymentOption | null>(null);
  const [amount, setAmount] = useState('');
  const [allocateBusy, setAllocateBusy] = useState(false);
  const [allocateError, setAllocateError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    const response = await api(`/receivables/${id}`);
    if (!response.ok) {
      setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar o título.'));
      return setState('error');
    }
    setReceivable(await response.json());
    setState('ready');
  }, [id]);

  useEffect(() => { if (hasFullContext) void load(); }, [load, hasFullContext]);

  const title = receivable ? `Título ${receivable.installment_number}/${receivable.installment_count} — ${receivable.origin === 'sale' ? `Venda #${receivable.sale_number}` : `OS #${receivable.service_order_number}`}` : undefined;
  useSetBreadcrumb(title);

  function openCancelDialog() { setCancelError(''); setCancelReason(''); setCancelDialog(true); }
  async function handleCancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCancelBusy(true); setCancelError('');
    const response = await api(`/receivables/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: cancelReason || null }) });
    setCancelBusy(false);
    if (!response.ok) return setCancelError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível cancelar este título.'));
    setCancelDialog(false);
    void load();
  }

  function openAllocateDialog() { setAllocateError(''); setPayment(null); setAmount(receivable ? receivable.balance : ''); setAllocateDialog(true); }
  async function handleAllocate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payment) return setAllocateError('Selecione um recebimento.');
    setAllocateBusy(true); setAllocateError('');
    const response = await api(`/receivables/${id}/allocate`, { method: 'POST', body: JSON.stringify({ paymentId: payment.id, amount: Number(amount), idempotencyKey: crypto.randomUUID() }) });
    setAllocateBusy(false);
    if (!response.ok) return setAllocateError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível alocar este pagamento.'));
    setAllocateDialog(false);
    void load();
  }

  // mesmo cuidado de `service-orders/new`/`quotes/new` com `searchAssetsForCustomer`: uma função
  // de busca "currificada" recriada a cada render muda de identidade a cada tecla digitada no
  // combobox (o próprio EntityCombobox re-renderiza o pai indiretamente via seu estado interno),
  // o que reinicia a lógica de sequência/debounce do combobox e faz o resultado nunca se
  // estabilizar — `useMemo` mantém a MESMA função enquanto a origem não mudar. Precisa vir ANTES
  // dos `return` condicionais abaixo (regras de hooks: nunca depois de um retorno antecipado).
  const searchPayments = useMemo(
    () => (receivable ? searchPaymentsForOrigin(receivable.origin === 'sale' ? { saleId: receivable.sale_id! } : { serviceOrderId: receivable.service_order_id! }) : async () => []),
    [receivable],
  );

  if (state === 'error') return <ErrorState message={errorMessage} onRetry={load} />;
  if (!receivable) return null;

  const canCancel = receivable.status === 'active' && Number(receivable.paid_amount) === 0;
  const canAllocate = receivable.status === 'active' && Number(receivable.balance) > 0;

  return (
    <RequireOperationalContext>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={title!}
          description={`Vencimento em ${formatDate(receivable.due_date)} · ${receivable.customer_name}`}
          action={
            <div className="flex gap-2">
              {canAllocate && <button onClick={openAllocateDialog} className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white">Alocar pagamento</button>}
              {canCancel && <button onClick={openCancelDialog} className="rounded-xl border border-red-300 px-4 py-2.5 text-sm text-red-700 hover:bg-red-100">Cancelar</button>}
            </div>
          }
        >
          <StatusBadge tone={statusLabels[receivable.derived_status].tone}>{statusLabels[receivable.derived_status].label}</StatusBadge>
        </PageHeader>

        <FormSection title="Detalhes">
          <FormField label="Cliente" htmlFor="d-customer"><p id="d-customer" className={formFieldClass}>{receivable.customer_name}</p></FormField>
          <FormField label="Origem" htmlFor="d-origin"><p id="d-origin" className={formFieldClass}>{receivable.origin === 'sale' ? `Venda #${receivable.sale_number}` : `OS #${receivable.service_order_number}`}</p></FormField>
          <FormField label="Valor original" htmlFor="d-amount"><p id="d-amount" className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(receivable.original_amount)}</p></FormField>
          <FormField label="Recebido" htmlFor="d-paid"><p id="d-paid" className={formFieldClass}>{formatCurrency(receivable.paid_amount)}</p></FormField>
          <FormField label="Saldo" htmlFor="d-balance"><p id="d-balance" className={formFieldClass}>{formatCurrency(receivable.balance)}</p></FormField>
          <FormField label="Vencimento" htmlFor="d-due"><p id="d-due" className={formFieldClass}>{formatDate(receivable.due_date)}</p></FormField>
          {receivable.status === 'canceled' && (
            <FormField label="Motivo do cancelamento" htmlFor="d-reason" span="full"><p id="d-reason" className={formFieldClass}>{receivable.cancel_reason ?? '—'}</p></FormField>
          )}
        </FormSection>

        <FormSection title="Parcelamento" description="Demais parcelas geradas para a mesma origem.">
          <div className="sm:col-span-2 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2 text-left font-medium">Parcela</th><th className="px-3 py-2 text-left font-medium">Vencimento</th><th className="px-3 py-2 text-right font-medium">Valor</th><th className="px-3 py-2 text-left font-medium">Status</th></tr></thead>
              <tbody>
                {receivable.siblings.map((sibling) => (
                  <tr key={sibling.id} className={`border-b border-slate-100 last:border-0 ${sibling.id === receivable.id ? 'bg-slate-50' : ''}`}>
                    <td className="px-3 py-2">{sibling.installment_number}/{sibling.installment_count}</td>
                    <td className="px-3 py-2">{formatDate(sibling.due_date)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(sibling.original_amount)}</td>
                    <td className="px-3 py-2"><StatusBadge tone={statusLabels[sibling.derived_status as Receivable['derived_status']].tone}>{statusLabels[sibling.derived_status as Receivable['derived_status']].label}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>

        <FormSection title="Pagamentos alocados" description="Recebimentos vinculados a este título — a apropriação é sempre explícita, nunca automática (FIN-02).">
          {receivable.allocations.length === 0 ? (
            <p className="sm:col-span-2 text-sm text-slate-500">Nenhum pagamento alocado ainda.</p>
          ) : (
            <div className="sm:col-span-2 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2 text-left font-medium">Data</th><th className="px-3 py-2 text-left font-medium">Forma</th><th className="px-3 py-2 text-right font-medium">Valor alocado</th><th className="px-3 py-2 text-left font-medium">Status</th><th className="px-3 py-2 text-left font-medium">Operador</th></tr></thead>
                <tbody>
                  {receivable.allocations.map((allocation) => (
                    <tr key={allocation.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2">{formatDateTime(allocation.created_at)}</td>
                      <td className="px-3 py-2">{allocation.payment_method_name}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(allocation.amount)}</td>
                      <td className="px-3 py-2">{allocation.payment_refunded ? <StatusBadge tone="warning">Pagamento estornado</StatusBadge> : <StatusBadge tone="success">Ativo</StatusBadge>}</td>
                      <td className="px-3 py-2">{allocation.created_by_name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </FormSection>

        <FormDialog open={cancelDialog} title="Cancelar título" description="Só é possível cancelar um título sem nenhum pagamento alocado. O histórico é mantido, não apagado." submitLabel="Cancelar título" busy={cancelBusy} error={cancelError} onSubmit={handleCancel} onCancel={() => setCancelDialog(false)}>
          <FormField label="Motivo (opcional)" htmlFor="cancel-reason">
            <input id="cancel-reason" maxLength={1000} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className={formFieldClass} />
          </FormField>
        </FormDialog>

        <FormDialog open={allocateDialog} title="Alocar pagamento" description="Vincula um recebimento já registrado (Financeiro > Recebimentos) a este título, no valor informado." submitLabel="Alocar" busy={allocateBusy} error={allocateError} onSubmit={handleAllocate} onCancel={() => setAllocateDialog(false)}>
          <FormField label="Recebimento" htmlFor="allocate-payment" span="full">
            <EntityCombobox value={payment} onChange={setPayment} search={searchPayments} getId={(item) => item.id} getLabel={(item) => `${formatCurrency(item.amount)} — ${item.payment_method_name}`} renderOption={(item) => <span>{formatCurrency(item.amount)} — {item.payment_method_name} ({formatDateTime(item.created_at)})</span>} id="allocate-payment" placeholder="Buscar recebimento desta origem…" />
          </FormField>
          <FormField label="Valor a alocar (R$)" htmlFor="allocate-amount">
            <input id="allocate-amount" type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={formFieldClass} />
          </FormField>
        </FormDialog>
      </div>
    </RequireOperationalContext>
  );
}
