'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormActions } from '../../../../components/form-actions';
import { friendlyError } from '../../../../components/error-state';

export default function NewCompanyPage() {
  const router = useRouter();
  const [form, setForm] = useState({ legalName: '', tradeName: '', taxIdType: 'cnpj', taxIdNormalized: '', stateRegistration: '', municipalRegistration: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const response = await api('/companies', {
      method: 'POST',
      body: JSON.stringify({
        legalName: form.legalName, tradeName: form.tradeName || null, taxIdType: form.taxIdType, taxIdNormalized: form.taxIdNormalized,
        stateRegistration: form.stateRegistration || null, municipalRegistration: form.municipalRegistration || null, currencyCode: 'BRL',
      }),
    });
    setSaving(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível criar a empresa.'));
    router.push(`/app/companies/${(await response.json()).id}`);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Nova empresa" />
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FormSection title="Identificação">
          <FormField label="Tipo de documento" htmlFor="taxIdType">
            <select id="taxIdType" className={formFieldClass} value={form.taxIdType} onChange={(e) => setForm({ ...form, taxIdType: e.target.value })}>
              <option value="cnpj">CNPJ</option>
              <option value="cpf">CPF</option>
              <option value="other">Outro</option>
            </select>
          </FormField>
          <FormField label={form.taxIdType === 'cpf' ? 'CPF' : form.taxIdType === 'cnpj' ? 'CNPJ' : 'Documento'} htmlFor="taxIdNormalized">
            <input id="taxIdNormalized" required className={formFieldClass} value={form.taxIdNormalized} onChange={(e) => setForm({ ...form, taxIdNormalized: e.target.value })} />
          </FormField>
          <FormField label="Razão social" htmlFor="legalName" span="full">
            <input id="legalName" required className={formFieldClass} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
          </FormField>
          <FormField label="Nome fantasia" htmlFor="tradeName" span="full">
            <input id="tradeName" className={formFieldClass} value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />
          </FormField>
        </FormSection>
        <FormSection title="Inscrições">
          <FormField label="Inscrição estadual" htmlFor="stateRegistration">
            <input id="stateRegistration" className={formFieldClass} value={form.stateRegistration} onChange={(e) => setForm({ ...form, stateRegistration: e.target.value })} />
          </FormField>
          <FormField label="Inscrição municipal" htmlFor="municipalRegistration">
            <input id="municipalRegistration" className={formFieldClass} value={form.municipalRegistration} onChange={(e) => setForm({ ...form, municipalRegistration: e.target.value })} />
          </FormField>
        </FormSection>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <FormActions saving={saving} saveLabel="Criar empresa" cancelHref="/app/companies" />
      </form>
    </div>
  );
}
