'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/page-header';
import { FormSection, FormField, formFieldClass } from '../../../../../components/form-section';
import { FormActions } from '../../../../../components/form-actions';
import { friendlyError } from '../../../../../components/error-state';
import { RequireOperationalContext } from '../../../../../components/require-operational-context';

export default function NewInventoryPartPage() {
  const router = useRouter();
  const [form, setForm] = useState({ sku: '', description: '', unit: 'un', referenceCost: '', referencePrice: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const response = await api('/inventory/parts', { method: 'POST', body: JSON.stringify({ ...form, referenceCost: form.referenceCost || null, referencePrice: form.referencePrice || null }) });
    setSaving(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível criar a peça.'));
    router.push(`/app/inventory/parts/${(await response.json()).id}`);
  }

  return (
    <RequireOperationalContext>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageHeader title="Nova peça" />
        <form onSubmit={submit} className="flex flex-col gap-5">
          <FormSection title="Identificação">
            <FormField label="SKU / código" htmlFor="sku">
              <input id="sku" required className={formFieldClass} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </FormField>
            <FormField label="Unidade" htmlFor="unit">
              <input id="unit" required className={formFieldClass} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </FormField>
            <FormField label="Descrição" htmlFor="description" span="full">
              <input id="description" required className={formFieldClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </FormField>
          </FormSection>
          <FormSection title="Referências de valor">
            <FormField label="Custo de referência" htmlFor="referenceCost">
              <input id="referenceCost" type="number" min="0" step="0.01" className={formFieldClass} value={form.referenceCost} onChange={(e) => setForm({ ...form, referenceCost: e.target.value })} />
            </FormField>
            <FormField label="Preço de referência" htmlFor="referencePrice">
              <input id="referencePrice" type="number" min="0" step="0.01" className={formFieldClass} value={form.referencePrice} onChange={(e) => setForm({ ...form, referencePrice: e.target.value })} />
            </FormField>
          </FormSection>
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          <FormActions saving={saving} saveLabel="Criar peça" cancelHref="/app/inventory/parts" />
        </form>
      </div>
    </RequireOperationalContext>
  );
}
