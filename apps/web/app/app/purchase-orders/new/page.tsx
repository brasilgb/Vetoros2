'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormActions } from '../../../../components/form-actions';
import { friendlyError } from '../../../../components/error-state';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { EntityCombobox } from '../../../../components/entity-combobox';
import { SupplierOptionRow, supplierLabel } from '../../../../components/entity-option-rows';
import { searchSuppliers, type SupplierOption } from '../../../../lib/entity-search';

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [supplier, setSupplier] = useState<SupplierOption | null>(null);
  const [form, setForm] = useState({ expectedDate: '', supplierReference: '', notes: '', freightTotal: '0', otherCostsTotal: '0' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplier) return setError('Selecione um fornecedor.');
    setSaving(true);
    setError('');
    const response = await api('/purchase-orders', {
      method: 'POST',
      body: JSON.stringify({ ...form, supplierId: supplier.id, expectedDate: form.expectedDate || null, supplierReference: form.supplierReference || null, notes: form.notes || null, freightTotal: Number(form.freightTotal), otherCostsTotal: Number(form.otherCostsTotal) }),
    });
    setSaving(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível criar o pedido de compra.'));
    router.push(`/app/purchase-orders/${(await response.json()).id}`);
  }

  return (
    <RequireOperationalContext>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageHeader title="Novo pedido de compra" />
        <form onSubmit={submit} className="flex flex-col gap-5">
          <FormSection title="Fornecedor e prazos">
            <FormField label="Fornecedor" htmlFor="supplierId" span="full">
              <EntityCombobox
                id="supplierId"
                value={supplier}
                onChange={(next) => { setSupplier(next); if (next) setError(''); }}
                search={searchSuppliers}
                getId={(item) => item.id}
                getLabel={supplierLabel}
                renderOption={(item) => <SupplierOptionRow item={item} />}
                placeholder="Buscar por nome ou CNPJ…"
                hasError={!supplier && Boolean(error)}
              />
            </FormField>
            <FormField label="Previsão de entrega" htmlFor="expectedDate">
              <input id="expectedDate" type="date" className={formFieldClass} value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} />
            </FormField>
            <FormField label="Referência do fornecedor" htmlFor="supplierReference">
              <input id="supplierReference" className={formFieldClass} value={form.supplierReference} onChange={(e) => setForm({ ...form, supplierReference: e.target.value })} />
            </FormField>
          </FormSection>
          <FormSection title="Custos">
            <FormField label="Frete" htmlFor="freightTotal">
              <input id="freightTotal" type="number" min="0" step="0.01" className={formFieldClass} value={form.freightTotal} onChange={(e) => setForm({ ...form, freightTotal: e.target.value })} />
            </FormField>
            <FormField label="Outros custos" htmlFor="otherCostsTotal">
              <input id="otherCostsTotal" type="number" min="0" step="0.01" className={formFieldClass} value={form.otherCostsTotal} onChange={(e) => setForm({ ...form, otherCostsTotal: e.target.value })} />
            </FormField>
          </FormSection>
          <FormSection title="Observações" columns={1}>
            <FormField label="Notas" htmlFor="notes">
              <textarea id="notes" className={`${formFieldClass} min-h-24`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </FormField>
          </FormSection>
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          <FormActions saving={saving} saveLabel="Criar pedido" cancelHref="/app/purchase-orders" />
        </form>
      </div>
    </RequireOperationalContext>
  );
}
