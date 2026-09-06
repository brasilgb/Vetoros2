'use client';
import { use, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { StatusBadge } from '../../../../components/status-badge';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormDialog } from '../../../../components/form-dialog';
import { formatCurrency, formatDateTime } from '../../../../lib/format';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../components/operational-context';

type Payment = {
  id: string; created_at: string; amount: string; payment_method_name: string; notes: string | null;
  origin: 'sale' | 'service_order' | 'none'; sale_number: number | null; service_order_number: number | null; customer_name: string | null;
  refunded: boolean; created_by_name: string | null; cash_session_id: string;
};
type Register = { id: string; name: string; current_session_id: string | null };

export default function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { hasFullContext } = useOperationalContext();
  const [payment, setPayment] = useState<Payment>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [refundDialog, setRefundDialog] = useState(false);
  const [registers, setRegisters] = useState<Register[]>([]);
  const [cashSessionId, setCashSessionId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    const response = await api(`/payments/${id}`);
    if (!response.ok) {
      setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar o recebimento.'));
      return setState('error');
    }
    setPayment(await response.json());
    setState('ready');
  }, [id]);

  useEffect(() => { if (hasFullContext) void load(); }, [load, hasFullContext]);

  const title = payment ? (payment.origin === 'sale' ? `Recebimento — Venda #${payment.sale_number}` : payment.origin === 'service_order' ? `Recebimento — OS #${payment.service_order_number}` : 'Recebimento avulso') : undefined;
  useSetBreadcrumb(title);

  async function openRefundDialog() {
    setDialogError(''); setReason('');
    const response = await api('/cash-registers');
    const items: Register[] = response.ok ? await response.json() : [];
    setRegisters(items);
    // seção 9 do correio.md: por padrão, o estorno sai do MESMO caixa onde o recebimento entrou,
    // se esse caixa ainda estiver aberto — só cai para "qualquer caixa aberto" se a sessão
    // original já tiver sido fechada (refund_payment aceita explicitamente uma sessão diferente
    // para esse caso, mas isso não deveria ser o padrão silencioso quando a original ainda serve).
    const ownSessionStillOpen = items.some((r) => r.current_session_id === payment?.cash_session_id);
    setCashSessionId(ownSessionStillOpen ? payment!.cash_session_id : (items.find((r) => r.current_session_id)?.current_session_id ?? ''));
    setRefundDialog(true);
  }
  async function handleRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cashSessionId) return setDialogError('Selecione um caixa aberto para receber o estorno.');
    setBusy(true); setDialogError('');
    const response = await api(`/payments/${id}/refund`, { method: 'POST', body: JSON.stringify({ cashSessionId, reason: reason || null }) });
    setBusy(false);
    if (!response.ok) return setDialogError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível estornar este recebimento.'));
    setRefundDialog(false);
    void load();
  }

  if (state === 'error') return <ErrorState message={errorMessage} onRetry={load} />;
  if (!payment) return null;

  const openSessions = registers.filter((r) => r.current_session_id);

  return (
    <RequireOperationalContext>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={title!}
          description={formatDateTime(payment.created_at)}
          action={!payment.refunded ? <button onClick={() => void openRefundDialog()} className="rounded-xl border border-red-800 px-4 py-2.5 text-sm text-red-300 hover:bg-red-950/40">Estornar</button> : undefined}
        >
          <StatusBadge tone={payment.refunded ? 'warning' : 'success'}>{payment.refunded ? 'Estornado' : 'Ativo'}</StatusBadge>
        </PageHeader>

        <FormSection title="Detalhes">
          <FormField label="Valor" htmlFor="d-amount"><p id="d-amount" className="mt-1 text-lg font-semibold text-emerald-50">{formatCurrency(payment.amount)}</p></FormField>
          <FormField label="Forma de pagamento" htmlFor="d-method"><p id="d-method" className={formFieldClass}>{payment.payment_method_name}</p></FormField>
          <FormField label="Cliente" htmlFor="d-customer"><p id="d-customer" className={formFieldClass}>{payment.customer_name ?? '—'}</p></FormField>
          <FormField label="Operador" htmlFor="d-operator"><p id="d-operator" className={formFieldClass}>{payment.created_by_name ?? '—'}</p></FormField>
          <FormField label="Observação" htmlFor="d-notes" span="full"><p id="d-notes" className={formFieldClass}>{payment.notes ?? '—'}</p></FormField>
        </FormSection>

        <FormDialog open={refundDialog} title="Estornar recebimento" description="O valor é debitado do caixa aberto selecionado, como uma movimentação de estorno." submitLabel="Estornar" busy={busy} error={dialogError} onSubmit={handleRefund} onCancel={() => setRefundDialog(false)}>
          {openSessions.length === 0 ? (
            <p className="text-sm text-amber-200">Nenhum caixa aberto nesta filial. Abra um caixa antes de estornar.</p>
          ) : (
            <FormField label="Caixa" htmlFor="refund-session">
              <select id="refund-session" required value={cashSessionId} onChange={(e) => setCashSessionId(e.target.value)} className={formFieldClass}>
                {openSessions.map((r) => <option key={r.id} value={r.current_session_id!}>{r.name}</option>)}
              </select>
            </FormField>
          )}
          <FormField label="Motivo (opcional)" htmlFor="refund-reason">
            <input id="refund-reason" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className={formFieldClass} />
          </FormField>
        </FormDialog>
      </div>
    </RequireOperationalContext>
  );
}
