'use client';
import { Suspense, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { EmptyState } from '../../../../components/empty-state';
import { friendlyError } from '../../../../components/error-state';
import { formFieldClass } from '../../../../components/form-section';
import { RequireOperationalContext } from '../../../../components/require-operational-context';

type ReceiptItem = { id: string; part_sku: string; description: string; quantity: string; returned_quantity: number; returnable_quantity: number };
type Receipt = { receipt_number: number; purchase_order_number: number; supplier_name: string; branch_name: string; items: ReceiptItem[] };

function NewPurchaseReturnForm() {
  const router = useRouter();
  const purchaseReceiptId = useSearchParams().get('purchaseReceiptId') ?? '';
  const [receipt, setReceipt] = useState<Receipt>();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!purchaseReceiptId) return;
    void api(`/purchase-receipts/${purchaseReceiptId}`).then(async (response) => {
      if (response.ok) setReceipt(await response.json());
    });
  }, [purchaseReceiptId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const toReturn = Object.entries(quantities).filter(([, value]) => Number(value) > 0);
    if (!toReturn.length) return setError('Informe ao menos uma quantidade a devolver.');
    setSaving(true);
    setError('');
    const created = await api('/purchase-returns', { method: 'POST', body: JSON.stringify({ purchaseReceiptId, reason: reason || null }) });
    if (!created.ok) {
      setSaving(false);
      return setError(friendlyError((await created.json().catch(() => ({}))).error, 'Não foi possível criar a devolução.'));
    }
    const returnId = (await created.json()).id;
    for (const [purchaseReceiptItemId, quantity] of toReturn) {
      const response = await api(`/purchase-returns/${returnId}/items`, { method: 'POST', body: JSON.stringify({ purchaseReceiptItemId, quantity: Number(quantity) }) });
      if (!response.ok) {
        setSaving(false);
        return setError(friendlyError((await response.json().catch(() => ({}))).error));
      }
    }
    router.push(`/app/purchase-returns/${returnId}`);
  }

  if (!purchaseReceiptId) return <EmptyState icon={Undo2} title="Nenhum recebimento informado" description="Inicie uma devolução a partir da tela de um recebimento confirmado." />;
  if (!receipt) return <p className="text-sm text-emerald-100/60">Carregando…</p>;
  const returnable = receipt.items.filter((item) => item.returnable_quantity > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Devolver mercadorias — Recebimento #${receipt.receipt_number}`} description={`Pedido #${receipt.purchase_order_number} · Fornecedor: ${receipt.supplier_name} · Filial: ${receipt.branch_name}`} />
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="overflow-x-auto rounded-2xl border border-emerald-900">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-emerald-900 bg-emerald-950/60 text-xs uppercase tracking-wide text-emerald-100/50">
                <th className="px-4 py-3 text-left font-medium">Peça</th>
                <th className="px-4 py-3 text-right font-medium">Recebido</th>
                <th className="px-4 py-3 text-right font-medium">Já devolvido</th>
                <th className="px-4 py-3 text-right font-medium">Devolvível</th>
                <th className="px-4 py-3 text-right font-medium">Devolver agora</th>
              </tr>
            </thead>
            <tbody>
              {returnable.map((item) => (
                <tr key={item.id} className="border-b border-emerald-900/60 last:border-0">
                  <td className="px-4 py-3 text-emerald-100">{item.part_sku} — {item.description}</td>
                  <td className="px-4 py-3 text-right text-emerald-100">{Number(item.quantity)}</td>
                  <td className="px-4 py-3 text-right text-emerald-100">{item.returned_quantity}</td>
                  <td className="px-4 py-3 text-right text-emerald-100">{item.returnable_quantity}</td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      min="0"
                      max={item.returnable_quantity}
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
          Motivo da devolução
          <textarea className={`${formFieldClass} min-h-24`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-emerald-950 disabled:opacity-50">
            {saving ? 'Criando…' : 'Criar devolução'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewPurchaseReturnPage() {
  return (
    <RequireOperationalContext>
      <Suspense fallback={<p className="text-sm text-emerald-100/60">Carregando…</p>}>
        <NewPurchaseReturnForm />
      </Suspense>
    </RequireOperationalContext>
  );
}
