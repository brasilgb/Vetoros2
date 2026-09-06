'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormActions } from '../../../../components/form-actions';
import { friendlyError } from '../../../../components/error-state';
import { EntityCombobox } from '../../../../components/entity-combobox';
import { CustomerOptionRow, customerLabel } from '../../../../components/entity-option-rows';
import { searchCustomers, type CustomerOption } from '../../../../lib/entity-search';

export default function NewAssetPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [form, setForm] = useState({ internalIdentifier: '', category: '', brand: '', model: '', serialNumber: '', imei: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer) return setError('Selecione um cliente.');
    setSaving(true);
    setError('');
    const response = await api('/assets', {
      method: 'POST',
      body: JSON.stringify({ customerId: customer.id, internalIdentifier: form.internalIdentifier, category: form.category, brand: form.brand || null, model: form.model || null, serialNumber: form.serialNumber || null, imei: form.imei || null }),
    });
    setSaving(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível cadastrar o equipamento.'));
    router.push(`/app/assets/${(await response.json()).id}`);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Novo equipamento" />
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FormSection title="Cliente e identificação">
          <FormField label="Cliente" htmlFor="customerId" span="full">
            <EntityCombobox
              id="customerId"
              value={customer}
              onChange={(next) => { setCustomer(next); if (next) setError(''); }}
              search={searchCustomers}
              getId={(item) => item.id}
              getLabel={customerLabel}
              renderOption={(item) => <CustomerOptionRow item={item} />}
              placeholder="Buscar por nome, CPF/CNPJ, telefone…"
              hasError={!customer && Boolean(error)}
            />
          </FormField>
          <FormField label="Identificação interna" htmlFor="internalIdentifier">
            <input id="internalIdentifier" required className={formFieldClass} value={form.internalIdentifier} onChange={(e) => setForm({ ...form, internalIdentifier: e.target.value })} />
          </FormField>
          <FormField label="Categoria" htmlFor="category">
            <input id="category" required placeholder="Notebook, impressora…" className={formFieldClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </FormField>
        </FormSection>
        <FormSection title="Detalhes">
          <FormField label="Marca" htmlFor="brand">
            <input id="brand" className={formFieldClass} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          </FormField>
          <FormField label="Modelo" htmlFor="model">
            <input id="model" className={formFieldClass} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </FormField>
          <FormField label="Número de série" htmlFor="serialNumber">
            <input id="serialNumber" className={formFieldClass} value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
          </FormField>
          <FormField label="IMEI" htmlFor="imei">
            <input id="imei" className={formFieldClass} value={form.imei} onChange={(e) => setForm({ ...form, imei: e.target.value })} />
          </FormField>
        </FormSection>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <FormActions saving={saving} saveLabel="Cadastrar equipamento" cancelHref="/app/assets" />
      </form>
    </div>
  );
}
