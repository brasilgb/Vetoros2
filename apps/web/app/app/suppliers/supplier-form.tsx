'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { FormSection, FormField, formFieldClass } from '../../../components/form-section';
import { FormActions } from '../../../components/form-actions';
import { friendlyError } from '../../../components/error-state';

export function SupplierForm({ supplier }: { supplier?: Record<string, unknown> }) {
  const router = useRouter();
  const [personType, setPersonType] = useState(String(supplier?.person_type ?? 'company'));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await api(supplier ? `/suppliers/${supplier.id}` : '/suppliers', {
      method: supplier ? 'PATCH' : 'POST',
      body: JSON.stringify({
        personType,
        legalName: values.legalName,
        tradeName: values.tradeName || null,
        document: values.document || null,
        stateRegistration: values.stateRegistration || null,
        municipalRegistration: values.municipalRegistration || null,
        notes: values.notes || null,
        status: values.status,
      }),
    });
    setSaving(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error === 'invalid_document' ? 'CPF/CNPJ inválido.' : body.error === 'document_already_exists' ? 'CPF/CNPJ já cadastrado.' : friendlyError(body.error, 'Confira os campos informados.'));
      return;
    }
    const saved = await response.json();
    router.push(`/app/suppliers/${saved.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <FormSection title="Dados principais">
        <FormField label="Tipo" htmlFor="personType">
          <select id="personType" className={formFieldClass} value={personType} onChange={(e) => setPersonType(e.target.value)}>
            <option value="individual">Pessoa física</option>
            <option value="company">Pessoa jurídica</option>
          </select>
        </FormField>
        <FormField label="Status" htmlFor="status">
          <select id="status" name="status" className={formFieldClass} defaultValue={String(supplier?.status ?? 'active')}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </select>
        </FormField>
        <FormField label="Nome / razão social" htmlFor="legalName" span="full">
          <input id="legalName" className={formFieldClass} name="legalName" required defaultValue={String(supplier?.legal_name ?? '')} />
        </FormField>
        <FormField label="Nome fantasia" htmlFor="tradeName">
          <input id="tradeName" className={formFieldClass} name="tradeName" defaultValue={String(supplier?.trade_name ?? '')} />
        </FormField>
        <FormField label={personType === 'individual' ? 'CPF' : 'CNPJ'} htmlFor="document">
          <input id="document" className={formFieldClass} name="document" defaultValue={String(supplier?.document_normalized ?? '')} />
        </FormField>
        <FormField label="Inscrição estadual" htmlFor="stateRegistration">
          <input id="stateRegistration" className={formFieldClass} name="stateRegistration" defaultValue={String(supplier?.state_registration ?? '')} />
        </FormField>
        <FormField label="Inscrição municipal" htmlFor="municipalRegistration">
          <input id="municipalRegistration" className={formFieldClass} name="municipalRegistration" defaultValue={String(supplier?.municipal_registration ?? '')} />
        </FormField>
      </FormSection>

      <FormSection title="Observações" columns={1}>
        <FormField label="Notas internas" htmlFor="notes">
          <textarea id="notes" className={`${formFieldClass} min-h-28`} name="notes" defaultValue={String(supplier?.notes ?? '')} />
        </FormField>
      </FormSection>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <FormActions saving={saving} saveLabel="Salvar fornecedor" cancelHref="/app/suppliers" />
    </form>
  );
}
