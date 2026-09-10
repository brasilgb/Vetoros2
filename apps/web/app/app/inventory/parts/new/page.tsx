'use client';
import { useEffect, useState } from 'react';
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
  const [form, setForm] = useState({ sku: '', description: '', unit: 'un', categoryId: '', brandId: '', referenceCost: '', referencePrice: '', barcodeEan: '', minimumStock: '0', defaultLocation: '', ncm: '' });
  const [categories, setCategories] = useState<Array<{id:string;name:string;status:string}>>([]);
  const [brands, setBrands] = useState<Array<{id:string;name:string;status:string}>>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { void Promise.all([api('/inventory/categories'), api('/inventory/brands')]).then(async ([categoryResponse, brandResponse]) => { if (categoryResponse.ok) setCategories(await categoryResponse.json()); if (brandResponse.ok) setBrands(await brandResponse.json()); }); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const response = await api('/inventory/parts', { method: 'POST', body: JSON.stringify({ ...form, categoryId: form.categoryId || null, brandId: form.brandId || null, referenceCost: form.referenceCost || null, referencePrice: form.referencePrice || null, barcodeEan: form.barcodeEan || null, minimumStock: Number(form.minimumStock), defaultLocation: form.defaultLocation || null, ncm: form.ncm || null }) });
    setSaving(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível criar a peça.'));
    router.push(`/app/inventory/parts/${(await response.json()).id}`);
  }

  return (
    <RequireOperationalContext>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
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
          <FormSection title="Estoque e identificação comercial">
            <FormField label="Categoria" htmlFor="categoryId"><select id="categoryId" className={formFieldClass} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">Sem categoria</option>{categories.filter((entry)=>entry.status==='active').map((entry)=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></FormField>
            <FormField label="Marca" htmlFor="brandId"><select id="brandId" className={formFieldClass} value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}><option value="">Sem marca</option>{brands.filter((entry)=>entry.status==='active').map((entry)=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></FormField>
            <FormField label="Código de barras / EAN" htmlFor="barcodeEan"><input id="barcodeEan" inputMode="numeric" className={formFieldClass} value={form.barcodeEan} onChange={(e) => setForm({ ...form, barcodeEan: e.target.value })} /></FormField>
            <FormField label="Estoque mínimo" htmlFor="minimumStock"><input id="minimumStock" type="number" min="0" step="0.001" className={formFieldClass} value={form.minimumStock} onChange={(e) => setForm({ ...form, minimumStock: e.target.value })} /></FormField>
            <FormField label="Localização padrão" htmlFor="defaultLocation"><input id="defaultLocation" className={formFieldClass} value={form.defaultLocation} onChange={(e) => setForm({ ...form, defaultLocation: e.target.value })} /></FormField>
            <FormField label="NCM" htmlFor="ncm"><input id="ncm" inputMode="numeric" maxLength={8} className={formFieldClass} value={form.ncm} onChange={(e) => setForm({ ...form, ncm: e.target.value })} /></FormField>
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
