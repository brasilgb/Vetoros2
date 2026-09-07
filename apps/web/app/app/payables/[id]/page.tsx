'use client';
import { use, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { StatusBadge, type StatusTone } from '../../../../components/status-badge';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormDialog } from '../../../../components/form-dialog';
import { formatCurrency, formatDate, formatDateTime } from '../../../../lib/format';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../components/operational-context';

type PaymentMethod = { id: string; code: string; name: string };
type Installment = {
  id: string; installment_number: number; installment_count: number; original_amount: string; due_date: string;
  paid_amount: string; balance: string; overdue: boolean;
};
type Payment = {
  id: string; type: 'payment' | 'reversal'; amount: string; paid_at: string; payment_method_id: string | null; payment_method_name: string | null;
  notes: string | null; payable_installment_id: string; installment_number: number; reverses_payment_id: string | null; reversed: boolean;
  created_by_name: string | null; created_at: string;
};
type Payable = {
  id: string; description: string; document_number: string | null; issue_date: string;
  supplier_id: string | null; supplier_display_name: string | null; purchase_order_id: string | null; purchase_order_number: number | null;
  origin: 'purchase_order' | 'manual'; original_amount: string; paid_amount: string; balance: string;
  derived_status: 'open' | 'partial' | 'paid' | 'overdue' | 'canceled'; status: 'active' | 'canceled'; cancel_reason: string | null;
  branch_name: string; installments: Installment[]; payments: Payment[];
};

const statusLabels: Record<Payable['derived_status'], { label: string; tone: StatusTone }> = {
  open: { label: 'Em aberto', tone: 'info' }, partial: { label: 'Parcial', tone: 'warning' }, paid: { label: 'Pago', tone: 'success' },
  overdue: { label: 'Atrasado', tone: 'danger' }, canceled: { label: 'Cancelado', tone: 'neutral' },
};

// FIN-03, seção 17.3 do correio.md: dados do título, origem, fornecedor, parcelas, pagamentos e
// histórico em áreas claras; pagamento em modal (formulário pequeno); estorno pede confirmação/
// motivo; nenhuma ação crítica escondida.
export default function PayableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { hasFullContext } = useOperationalContext();
  const [payable, setPayable] = useState<Payable>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [payDialogInstallment, setPayDialogInstallment] = useState<Installment | null>(null);
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState('');

  useEffect(() => { void api('/payment-methods').then((r) => r.ok && r.json()).then((items) => items && setMethods(items)); }, []);

  const [reverseDialogPayment, setReverseDialogPayment] = useState<Payment | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseBusy, setReverseBusy] = useState(false);
  const [reverseError, setReverseError] = useState('');

  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    const response = await api(`/payables/${id}`);
    if (!response.ok) {
      setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar a conta a pagar.'));
      return setState('error');
    }
    setPayable(await response.json());
    setState('ready');
  }, [id]);

  useEffect(() => { if (hasFullContext) void load(); }, [load, hasFullContext]);
  useSetBreadcrumb(payable?.description);

  function openPayDialog(installment: Installment) {
    setPayError(''); setAmount(installment.balance); setPaidAt(new Date().toISOString().slice(0, 10)); setPaymentMethodId(''); setNotes('');
    setPayDialogInstallment(installment);
  }
  async function handlePay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payDialogInstallment) return;
    setPayBusy(true); setPayError('');
    const response = await api(`/payables/${id}/installments/${payDialogInstallment.id}/payments`, { method: 'POST', body: JSON.stringify({
      amount: Number(amount), paidAt: paidAt || null, paymentMethodId: paymentMethodId || null, notes: notes || null, idempotencyKey: crypto.randomUUID(),
    }) });
    setPayBusy(false);
    if (!response.ok) return setPayError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível registrar o pagamento.'));
    setPayDialogInstallment(null);
    void load();
  }

  function openReverseDialog(payment: Payment) { setReverseError(''); setReverseReason(''); setReverseDialogPayment(payment); }
  async function handleReverse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reverseDialogPayment) return;
    setReverseBusy(true); setReverseError('');
    const response = await api(`/payables/${id}/installments/${reverseDialogPayment.payable_installment_id}/payments/${reverseDialogPayment.id}/reverse`, { method: 'POST', body: JSON.stringify({ reason: reverseReason || null }) });
    setReverseBusy(false);
    if (!response.ok) return setReverseError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível estornar este pagamento.'));
    setReverseDialogPayment(null);
    void load();
  }

  async function handleCancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCancelBusy(true); setCancelError('');
    const response = await api(`/payables/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: cancelReason || null }) });
    setCancelBusy(false);
    if (!response.ok) return setCancelError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível cancelar esta conta.'));
    setCancelDialog(false);
    void load();
  }

  if (state === 'error') return <ErrorState message={errorMessage} onRetry={load} />;
  if (!payable) return null;

  const canCancel = payable.status === 'active' && Number(payable.paid_amount) === 0;

  return (
    <RequireOperationalContext>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={payable.description}
          description={`${payable.origin === 'purchase_order' ? `Pedido #${payable.purchase_order_number}` : 'Origem manual'} · ${payable.supplier_display_name ?? 'Sem fornecedor vinculado'}`}
          action={payable.status === 'active' ? <button onClick={() => setCancelDialog(true)} disabled={!canCancel} title={!canCancel ? 'Só é possível cancelar sem pagamento ativo' : undefined} className="rounded-xl border border-red-800 px-4 py-2.5 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-40" >Cancelar</button> : undefined}
        >
          <StatusBadge tone={statusLabels[payable.derived_status].tone}>{statusLabels[payable.derived_status].label}</StatusBadge>
        </PageHeader>

        <FormSection title="Dados do título">
          <FormField label="Valor original" htmlFor="d-amount"><p id="d-amount" className="mt-1 text-lg font-semibold text-emerald-50">{formatCurrency(payable.original_amount)}</p></FormField>
          <FormField label="Pago" htmlFor="d-paid"><p id="d-paid" className={formFieldClass}>{formatCurrency(payable.paid_amount)}</p></FormField>
          <FormField label="Saldo" htmlFor="d-balance"><p id="d-balance" className={formFieldClass}>{formatCurrency(payable.balance)}</p></FormField>
          <FormField label="Documento" htmlFor="d-doc"><p id="d-doc" className={formFieldClass}>{payable.document_number ?? '—'}</p></FormField>
          <FormField label="Emissão" htmlFor="d-issue"><p id="d-issue" className={formFieldClass}>{formatDate(payable.issue_date)}</p></FormField>
          <FormField label="Filial" htmlFor="d-branch"><p id="d-branch" className={formFieldClass}>{payable.branch_name}</p></FormField>
          {payable.status === 'canceled' && (
            <FormField label="Motivo do cancelamento" htmlFor="d-reason" span="full"><p id="d-reason" className={formFieldClass}>{payable.cancel_reason ?? '—'}</p></FormField>
          )}
        </FormSection>

        <FormSection title="Parcelas">
          <div className="sm:col-span-2 overflow-x-auto rounded-xl border border-emerald-900">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-emerald-900 text-xs uppercase tracking-wide text-emerald-100/50">
                <th className="px-3 py-2 text-left font-medium">Parcela</th><th className="px-3 py-2 text-left font-medium">Vencimento</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th><th className="px-3 py-2 text-right font-medium">Saldo</th>
                <th className="px-3 py-2 text-left font-medium">Situação</th><th className="px-3 py-2" />
              </tr></thead>
              <tbody>
                {payable.installments.map((installment) => {
                  const paid = Number(installment.balance) <= 0;
                  return (
                    <tr key={installment.id} className="border-b border-emerald-900/60 last:border-0">
                      <td className="px-3 py-2">{installment.installment_number}/{installment.installment_count}</td>
                      <td className="px-3 py-2">{formatDate(installment.due_date)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(installment.original_amount)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(installment.balance)}</td>
                      <td className="px-3 py-2">
                        {paid ? <StatusBadge tone="success">Quitada</StatusBadge> : installment.overdue ? <StatusBadge tone="danger">Atrasada</StatusBadge> : Number(installment.paid_amount) > 0 ? <StatusBadge tone="warning">Parcial</StatusBadge> : <StatusBadge tone="info">Em aberto</StatusBadge>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!paid && payable.status === 'active' && (
                          <button onClick={() => openPayDialog(installment)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-950">Pagar</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </FormSection>

        <FormSection title="Pagamentos" description="Um pagamento nunca é apagado — um estorno é sempre um novo lançamento, preservando o histórico.">
          {payable.payments.length === 0 ? (
            <p className="sm:col-span-2 text-sm text-emerald-100/60">Nenhum pagamento registrado ainda.</p>
          ) : (
            <div className="sm:col-span-2 overflow-x-auto rounded-xl border border-emerald-900">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-emerald-900 text-xs uppercase tracking-wide text-emerald-100/50">
                  <th className="px-3 py-2 text-left font-medium">Data</th><th className="px-3 py-2 text-left font-medium">Parcela</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th><th className="px-3 py-2 text-left font-medium">Tipo</th>
                  <th className="px-3 py-2 text-left font-medium">Operador</th><th className="px-3 py-2" />
                </tr></thead>
                <tbody>
                  {payable.payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-emerald-900/60 last:border-0">
                      <td className="px-3 py-2">{formatDateTime(payment.paid_at)}</td>
                      <td className="px-3 py-2">{payment.installment_number}/{payable.installments.length}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(payment.amount)}</td>
                      <td className="px-3 py-2">
                        {payment.type === 'reversal' ? <StatusBadge tone="warning">Estorno</StatusBadge> : payment.reversed ? <StatusBadge tone="neutral">Estornado</StatusBadge> : <StatusBadge tone="success">Pagamento</StatusBadge>}
                      </td>
                      <td className="px-3 py-2">{payment.created_by_name ?? '—'}</td>
                      <td className="px-3 py-2 text-right">
                        {payment.type === 'payment' && !payment.reversed && (
                          <button onClick={() => openReverseDialog(payment)} className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40">Estornar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </FormSection>

        <FormDialog open={!!payDialogInstallment} title="Registrar pagamento" description={payDialogInstallment ? `Parcela ${payDialogInstallment.installment_number}/${payDialogInstallment.installment_count} — saldo ${formatCurrency(payDialogInstallment.balance)}.` : ''} submitLabel="Registrar" busy={payBusy} error={payError} onSubmit={handlePay} onCancel={() => setPayDialogInstallment(null)}>
          <FormField label="Valor (R$)" htmlFor="pay-amount">
            <input id="pay-amount" type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={formFieldClass} />
          </FormField>
          <FormField label="Data do pagamento" htmlFor="pay-date">
            <input id="pay-date" type="date" required value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={formFieldClass} />
          </FormField>
          <FormField label="Forma de pagamento (opcional)" htmlFor="pay-method" span="full">
            <select id="pay-method" value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)} className={formFieldClass}>
              <option value="">Não informar</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </FormField>
          <FormField label="Observação (opcional)" htmlFor="pay-notes" span="full">
            <textarea id="pay-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} className={formFieldClass} />
          </FormField>
        </FormDialog>

        <FormDialog open={!!reverseDialogPayment} title="Estornar pagamento" description="O pagamento original é preservado — o estorno é um novo lançamento que reabre o saldo da parcela." submitLabel="Estornar" busy={reverseBusy} error={reverseError} onSubmit={handleReverse} onCancel={() => setReverseDialogPayment(null)}>
          <FormField label="Motivo (opcional)" htmlFor="reverse-reason">
            <input id="reverse-reason" maxLength={1000} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} className={formFieldClass} />
          </FormField>
        </FormDialog>

        <FormDialog open={cancelDialog} title="Cancelar conta a pagar" description="Só é possível cancelar uma conta sem nenhum pagamento ativo. O histórico é mantido, não apagado." submitLabel="Cancelar conta" busy={cancelBusy} error={cancelError} onSubmit={handleCancel} onCancel={() => setCancelDialog(false)}>
          <FormField label="Motivo (opcional)" htmlFor="cancel-reason">
            <input id="cancel-reason" maxLength={1000} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className={formFieldClass} />
          </FormField>
        </FormDialog>
      </div>
    </RequireOperationalContext>
  );
}
