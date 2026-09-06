'use client';
import { Suspense, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { EmptyState } from '../../../../components/empty-state';
import { friendlyError } from '../../../../components/error-state';
import { formFieldClass } from '../../../../components/form-section';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { PackageCheck } from 'lucide-react';

type OrderItem = { id: string; part_sku: string; description: string; quantity: string; received_quantity: number; pending_quantity: number };
type Order = { purchase_order_number: number; supplier_name: string; branch_name: string; items: OrderItem[] };

function NewPurchaseReceiptForm() {
  const router = useRouter();
  const purchaseOrderId = useSearchParams().get('purchaseOrderId') ?? '';
  const [order, setOrder] = useState<Order>();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!purchaseOrderId) return;
    void api(`/purchase-orders/${purchaseOrderId}`).then(async (response) => {
      if (response.ok) setOrder(await response.json());
    });
  }, [purchaseOrderId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const toReceive = Object.entries(quantities).filter(([, value]) => Number(value) > 0);
    if (!toReceive.length) return setError('Informe ao menos uma quantidade a receber.');
    setSaving(true);
    setError('');
    const created = await api('/purchase-receipts', { method: 'POST', body: JSON.stringify({ purchaseOrderId, notes: notes || null }) });
    if (!created.ok) {
      setSaving(false);
      return setError(friendlyError((await created.json().catch(() => ({}))).error, 'Não foi possível criar o recebimento.'));
    }
    const receiptId = (await created.json()).id;
    for (const [purchaseOrderItemId, quantity] of toReceive) {
      const response = await api(`/purchase-receipts/${receiptId}/items`, { method: 'POST', body: JSON.stringify({ purchaseOrderItemId, quantity: Number(quantity) }) });
      if (!response.ok) {
        setSaving(false);
        return setError(friendlyError((await response.json().catch(() => ({}))).error));
      }
    }
    router.push(`/app/purchase-receipts/${receiptId}`);
  }

  if (!purchaseOrderId) return <EmptyState icon={PackageCheck} title="Nenhum pedido informado" description="Inicie um recebimento a partir da tela do pedido de compra aprovado." />;
  if (!order) return <p className="text-sm text-emerald-100/60">Carregando…</p>;
  const pending = order.items.filter((item) => item.pending_quantity > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Receber mercadorias — Pedido #${order.purchase_order_number}`} description={`Fornecedor: ${order.supplier_name} · Filial: ${order.branch_name}`} />
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="overflow-x-auto rounded-2xl border border-emerald-900">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-emerald-900 bg-emerald-950/60 text-xs uppercase tracking-wide text-emerald-100/50">
                <th className="px-4 py-3 text-left font-medium">Peça</th>
                <th className="px-4 py-3 text-right font-medium">Pedido</th>
                <th className="px-4 py-3 text-right font-medium">Já recebido</th>
                <th className="px-4 py-3 text-right font-medium">Pendente</th>
                <th className="px-4 py-3 text-right font-medium">Receber agora</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((item) => (
                <tr key={item.id} className="border-b border-emerald-900/60 last:border-0">
                  <td className="px-4 py-3 text-emerald-100">{item.part_sku} — {item.description}</td>
                  <td className="px-4 py-3 text-right text-emerald-100">{Number(item.quantity)}</td>
                  <td className="px-4 py-3 text-right text-emerald-100">{item.received_quantity}</td>
                  <td className="px-4 py-3 text-right text-emerald-100">{item.pending_quantity}</td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      min="0"
                      max={item.pending_quantity}
                      step="0.001"
                      className={`${formFieldClass} mt-0 w-28 text-right`}
                      value={quantities[item.id] ?? ''}
                      onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="text-sm text-emerald-100/80">
          Observações
          <textarea className={`${formFieldClass} min-h-24`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-emerald-950 disabled:opacity-50">
            {saving ? 'Criando…' : 'Criar recebimento'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewPurchaseReceiptPage() {
  return (
    <RequireOperationalContext>
      <Suspense fallback={<p className="text-sm text-emerald-100/60">Carregando…</p>}>
        <NewPurchaseReceiptForm />
      </Suspense>
    </RequireOperationalContext>
  );
}
