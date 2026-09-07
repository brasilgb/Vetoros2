'use client';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormActions } from '../../../../components/form-actions';
import { friendlyError } from '../../../../components/error-state';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { EntityCombobox } from '../../../../components/entity-combobox';
import { SupplierOptionRow, supplierLabel } from '../../../../components/entity-option-rows';
import { formatCurrency } from '../../../../lib/format';
import { searchSuppliers, searchApprovedPurchaseOrders, type SupplierOption, type PurchaseOrderOption } from '../../../../lib/entity-search';

type OriginType = 'manual' | 'purchase_order';
type InstallmentRow = { amount: string; dueDate: string };

// FIN-03, seção 17.2 do correio.md: "como Contas a Pagar pode possuir parcelamento e múltiplos
// campos, preferir página dedicada... não usar modal para fluxo complexo" — diferente de FIN-02
// (Recebíveis), cuja geração de parcelamento cabia num diálogo simples.
export default function NewPayablePage() {
  const router = useRouter();
  const [originType, setOriginType] = useState<OriginType>('manual');
  const [supplier, setSupplier] = useState<SupplierOption | null>(null);
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrderOption | null>(null);
  const [description, setDescription] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [installments, setInstallments] = useState<InstallmentRow[]>([{ amount: '', dueDate: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setSupplier(null); setPurchaseOrder(null); }, [originType]);

  const poTotal = purchaseOrder ? Number(purchaseOrder.total) : null;
  const installmentsTotal = installments.reduce((n, i) => n + (Number(i.amount) || 0), 0);
  const sumMatches = originType === 'purchase_order' ? poTotal !== null && Math.abs(installmentsTotal - poTotal) < 0.005 : installmentsTotal > 0;

  function addInstallment() { setInstallments((prev) => [...prev, { amount: '', dueDate: '' }]); }
  function removeInstallment(index: number) { setInstallments((prev) => prev.filter((_, i) => i !== index)); }
  function updateInstallment(index: number, field: keyof InstallmentRow, value: string) {
    setInstallments((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (originType === 'purchase_order' && !purchaseOrder) return setError('Selecione um pedido de compra aprovado.');
    if (!sumMatches) return setError(originType === 'purchase_order' ? 'A soma das parcelas precisa fechar exatamente com o total do pedido.' : 'Informe ao menos uma parcela com valor maior que zero.');
    setSaving(true); setError('');
    const response = await api('/payables', { method: 'POST', body: JSON.stringify({
      supplierId: originType === 'manual' ? (supplier?.id ?? null) : null,
      purchaseOrderId: originType === 'purchase_order' ? purchaseOrder?.id : null,
      description, documentNumber: documentNumber || null, issueDate: issueDate || null,
      installments: installments.map((i) => ({ amount: Number(i.amount), dueDate: i.dueDate })),
    }) });
    setSaving(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível criar a conta a pagar.'));
    router.push(`/app/payables/${(await response.json()).id}`);
  }

  return (
    <RequireOperationalContext>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageHeader title="Nova conta a pagar" description="Origem manual ou a partir de um pedido de compra aprovado." />
        <form onSubmit={submit} className="flex flex-col gap-5">
          <FormSection title="Origem">
            <FormField label="Tipo" htmlFor="origin-type">
              <select id="origin-type" value={originType} onChange={(e) => setOriginType(e.target.value as OriginType)} className={formFieldClass}>
                <option value="manual">Manual (despesa administrativa ou fornecedor sem pedido)</option>
                <option value="purchase_order">Pedido de compra aprovado</option>
              </select>
            </FormField>
            {originType === 'manual' ? (
              <FormField label="Fornecedor (opcional)" htmlFor="supplier">
                <EntityCombobox id="supplier" value={supplier} onChange={setSupplier} search={searchSuppliers} getId={(s) => s.id} getLabel={supplierLabel} renderOption={(s) => <SupplierOptionRow item={s} />} placeholder="Buscar por nome, CPF/CNPJ…" />
              </FormField>
            ) : (
              <FormField label="Pedido de compra" htmlFor="purchase-order">
                <EntityCombobox id="purchase-order" value={purchaseOrder} onChange={setPurchaseOrder} search={searchApprovedPurchaseOrders} getId={(o) => o.id} getLabel={(o) => `Pedido #${o.purchase_order_number}`} renderOption={(o) => <span>Pedido #{o.purchase_order_number} {o.supplier_name ? `— ${o.supplier_name}` : ''} ({formatCurrency(o.total)})</span>} placeholder="Buscar pedido aprovado…" />
              </FormField>
            )}
            {originType === 'purchase_order' && purchaseOrder && (
              <FormField label="Resumo" htmlFor="po-summary" span="full">
                <p id="po-summary" className="mt-1 rounded-xl border border-emerald-800 bg-emerald-950 p-3 text-sm text-emerald-100/80">
                  Fornecedor: <strong className="text-emerald-50">{purchaseOrder.supplier_name}</strong> · Total do pedido: <strong className="text-emerald-50">{formatCurrency(purchaseOrder.total)}</strong>
                </p>
              </FormField>
            )}
          </FormSection>

          <FormSection title="Identificação">
            <FormField label="Descrição" htmlFor="description" span="full">
              <input id="description" required maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} className={formFieldClass} placeholder="Ex.: Compra de peças, aluguel, energia…" />
            </FormField>
            <FormField label="Documento (opcional)" htmlFor="document-number">
              <input id="document-number" maxLength={100} value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} className={formFieldClass} placeholder="Nº da nota fiscal, boleto…" />
            </FormField>
            <FormField label="Data de emissão" htmlFor="issue-date">
              <input id="issue-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={formFieldClass} />
            </FormField>
          </FormSection>

          <FormSection title="Parcelamento" description={originType === 'purchase_order' ? 'A soma das parcelas precisa fechar exatamente com o total do pedido.' : 'Uma parcela única ou várias — a soma define o valor total do título.'}>
            <div className="sm:col-span-2 flex flex-col gap-2">
              {installments.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input type="number" min="0.01" step="0.01" required placeholder="Valor (R$)" value={row.amount} onChange={(e) => updateInstallment(index, 'amount', e.target.value)} className={formFieldClass} />
                  <input type="date" required value={row.dueDate} onChange={(e) => updateInstallment(index, 'dueDate', e.target.value)} className={formFieldClass} />
                  <button type="button" onClick={() => removeInstallment(index)} disabled={installments.length === 1} className="rounded-lg p-2 text-red-300 hover:bg-red-950/40 disabled:opacity-30" aria-label="Remover parcela">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addInstallment} className="self-start rounded-xl border border-emerald-800 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-950">+ Parcela</button>
              <p className="text-xs text-emerald-100/50">
                Soma atual: {formatCurrency(installmentsTotal)}{originType === 'purchase_order' && poTotal !== null ? ` de ${formatCurrency(poTotal)}` : ''}
              </p>
            </div>
          </FormSection>

          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          <FormActions saving={saving} saveLabel="Criar conta a pagar" cancelHref="/app/payables" />
        </form>
      </div>
    </RequireOperationalContext>
  );
}
