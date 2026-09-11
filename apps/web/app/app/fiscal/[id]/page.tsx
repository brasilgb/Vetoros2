'use client';
import { use, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { StatusBadge, commonStatus } from '../../../../components/status-badge';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormDialog } from '../../../../components/form-dialog';
import { AsyncButton } from '../../../../components/async-button';
import { formatCurrency, formatDateTime } from '../../../../lib/format';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../components/operational-context';

type Item = { id: string; description: string; quantity: string; unit_price: string; total: string; ncm: string | null; cfop: string | null };
type Address = { street: string; number: string | null; district: string | null; city: string; state: string | null } | null;
type FiscalDocument = {
  id: string; document_type: 'nfce' | 'nfe' | 'nfse'; status: string; environment: 'homologacao' | 'producao';
  series: string | null; document_number: number | null; access_key: string | null; protocol: string | null;
  recipient_legal_name: string; recipient_document: string | null; recipient_address: Address;
  subtotal: string; discount_total: string; total: string; rejection_reason: string | null;
  xml_url: string | null; pdf_url: string | null; sale_number: number | null; service_order_number: number | null;
  origin_sale_id: string | null; origin_service_order_id: string | null;
  requested_at: string | null; authorized_at: string | null; rejected_at: string | null; cancellation_requested_at: string | null; cancelled_at: string | null;
  items: Item[];
};

const documentTypeLabel: Record<FiscalDocument['document_type'], string> = { nfce: 'NFC-e', nfe: 'NF-e', nfse: 'NFS-e' };

// FIS-ADV-01, seção 26: detalhe operacional — situação, origem (com link, seção 24), destinatário,
// itens, totais, chave/protocolo, motivo de rejeição, eventos (linha do tempo dos próprios
// timestamps do documento — sem duplicar auditoria genérica numa segunda lista). Nunca expõe o
// JSON bruto do provedor como interface principal.
export default function FiscalDocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [doc, setDoc] = useState<FiscalDocument>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const { hasFullContext } = useOperationalContext();

  const load = useCallback(async () => {
    const response = await api(`/fiscal-documents/${id}`);
    if (!response.ok) return setState('error');
    setDoc(await response.json());
    setState('ready');
  }, [id]);

  useEffect(() => { if (hasFullContext) void load(); }, [hasFullContext, load]);
  useSetBreadcrumb(doc ? `${documentTypeLabel[doc.document_type]} — ${doc.recipient_legal_name}` : undefined);

  async function issue() {
    setBusy(true); setError('');
    const response = await api(`/fiscal-documents/${id}/issue`, { method: 'POST' });
    setBusy(false);
    if (!response.ok && response.status !== 502) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    if (response.status === 502) setError('O provedor fiscal não respondeu. O documento ficou em processamento — use "Consultar" para verificar o resultado assim que possível.');
    await load();
  }
  async function consult() {
    setBusy(true); setError('');
    const response = await api(`/fiscal-documents/${id}/consult`, { method: 'POST' });
    setBusy(false);
    if (!response.ok && response.status !== 502) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    if (response.status === 502) setError('O provedor fiscal ainda não respondeu. Tente consultar novamente em instantes.');
    await load();
  }
  async function submitCancel(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setCancelError('');
    const response = await api(`/fiscal-documents/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: cancelReason }) });
    setBusy(false);
    if (!response.ok) { const body = await response.json().catch(() => ({})); return setCancelError(body.reason ? `Cancelamento rejeitado pelo provedor: ${body.reason}` : friendlyError(body.error)); }
    setCancelOpen(false); setCancelReason('');
    await load();
  }

  if (state === 'loading') return <RequireOperationalContext><p className="text-sm text-slate-500">Carregando…</p></RequireOperationalContext>;
  if (state === 'error' || !doc) return <RequireOperationalContext><ErrorState message="Não foi possível carregar este documento fiscal." onRetry={load} /></RequireOperationalContext>;

  const { label, tone } = commonStatus(doc.status);
  const canIssue = doc.status === 'draft' || doc.status === 'rejected';
  const canConsult = doc.status === 'pending';
  const canCancel = doc.status === 'authorized';

  return (
    <RequireOperationalContext>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={`${documentTypeLabel[doc.document_type]} — ${doc.recipient_legal_name}`}
          description={doc.document_number ? `${doc.series ?? ''}/${doc.document_number}` : 'Ainda não numerado'}
          action={<StatusBadge tone={tone}>{label}</StatusBadge>}
        />

        {doc.status === 'rejected' && doc.rejection_reason && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span className="font-semibold">Rejeitado: </span>{doc.rejection_reason}
          </div>
        )}
        {doc.environment === 'homologacao' && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">Ambiente de homologação — sem valor fiscal.</div>
        )}

        <div className="flex flex-wrap gap-3">
          {canIssue && <AsyncButton tone="primary" label={doc.status === 'rejected' ? 'Tentar emitir novamente' : 'Emitir'} busyLabel="Emitindo…" onClick={issue} />}
          {canConsult && <AsyncButton tone="secondary" label="Consultar" busyLabel="Consultando…" onClick={consult} />}
          {canCancel && <button onClick={() => { setCancelOpen(true); setCancelReason(''); setCancelError(''); }} className="rounded-xl border border-red-300 px-4 py-2.5 text-sm text-red-700 hover:bg-red-50">Cancelar documento</button>}
          {doc.pdf_url && <a href={doc.pdf_url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">Ver DANFE/comprovante</a>}
          {doc.xml_url && <a href={doc.xml_url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">XML</a>}
        </div>

        <FormSection title="Origem e destinatário">
          <FormField label="Origem" htmlFor="d-origin">
            {doc.origin_sale_id ? (
              <Link id="d-origin" href={`/app/sales/${doc.origin_sale_id}`} className={`${formFieldClass} block text-blue-700 hover:underline`}>Venda #{doc.sale_number}</Link>
            ) : (
              <Link id="d-origin" href={`/app/service-orders/${doc.origin_service_order_id}`} className={`${formFieldClass} block text-blue-700 hover:underline`}>OS #{doc.service_order_number}</Link>
            )}
          </FormField>
          <FormField label="Destinatário" htmlFor="d-recipient"><p id="d-recipient" className={formFieldClass}>{doc.recipient_legal_name}{doc.recipient_document ? ` — ${doc.recipient_document}` : ''}</p></FormField>
          {doc.recipient_address && (
            <FormField label="Endereço" htmlFor="d-address" span="full">
              <p id="d-address" className={formFieldClass}>{doc.recipient_address.street}{doc.recipient_address.number ? `, ${doc.recipient_address.number}` : ''} — {doc.recipient_address.district ?? ''} {doc.recipient_address.city}/{doc.recipient_address.state ?? ''}</p>
            </FormField>
          )}
          {doc.access_key && <FormField label="Chave de acesso" htmlFor="d-key"><p id="d-key" className={`${formFieldClass} font-mono text-xs`}>{doc.access_key}</p></FormField>}
          {doc.protocol && <FormField label="Protocolo" htmlFor="d-protocol"><p id="d-protocol" className={formFieldClass}>{doc.protocol}</p></FormField>}
        </FormSection>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Itens</h2>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 text-left font-medium">Descrição</th><th className="px-3 py-2 text-right font-medium">Qtd.</th>
                <th className="px-3 py-2 text-right font-medium">Unitário</th><th className="px-3 py-2 text-right font-medium">Total</th>
              </tr></thead>
              <tbody>{doc.items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2">{item.description}{item.ncm ? <span className="ml-2 text-xs text-slate-400">NCM {item.ncm}</span> : null}</td>
                  <td className="px-3 py-2 text-right">{Number(item.quantity)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.unit_price)}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatCurrency(item.total)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>

        <p className="text-right text-sm text-slate-600">
          Subtotal: {formatCurrency(doc.subtotal)} · Descontos: {formatCurrency(doc.discount_total)} · <span className="font-semibold text-slate-900">Total: {formatCurrency(doc.total)}</span>
        </p>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Eventos</h2>
          <ul className="flex flex-col gap-1.5 text-xs text-slate-600">
            {doc.requested_at && <li>Emissão solicitada em {formatDateTime(doc.requested_at)}</li>}
            {doc.authorized_at && <li>Autorizado em {formatDateTime(doc.authorized_at)}</li>}
            {doc.rejected_at && <li>Rejeitado em {formatDateTime(doc.rejected_at)}</li>}
            {doc.cancellation_requested_at && <li>Cancelamento solicitado em {formatDateTime(doc.cancellation_requested_at)}</li>}
            {doc.cancelled_at && <li>Cancelado em {formatDateTime(doc.cancelled_at)}</li>}
          </ul>
        </div>

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        <FormDialog open={cancelOpen} title="Cancelar documento fiscal" description="Uma operação externa real confirma o cancelamento — o documento fica em 'Cancelamento em andamento' até lá." submitLabel="Cancelar documento" busy={busy} error={cancelError} onCancel={() => setCancelOpen(false)} onSubmit={submitCancel}>
          <FormField label="Motivo do cancelamento" htmlFor="cancel-reason" span="full">
            <input id="cancel-reason" required className={formFieldClass} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </FormField>
        </FormDialog>
      </div>
    </RequireOperationalContext>
  );
}
