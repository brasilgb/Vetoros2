'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { FormSection, FormField, formFieldClass } from '../../../components/form-section';
import { FormActions } from '../../../components/form-actions';
import { friendlyError } from '../../../components/error-state';

type Customer = Record<string, string | number | null>;

export function CustomerForm({ customer }: { customer?: Customer }) {
  const router = useRouter();
  const [personType, setPersonType] = useState(String(customer?.person_type ?? 'individual'));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const payload = {
      personType,
      legalName: values.legalName,
      tradeName: values.tradeName || null,
      document: values.document || null,
      rgStateRegistration: values.rgStateRegistration || null,
      phone: values.phone || null,
      mobile: values.mobile || null,
      whatsapp: values.whatsapp || null,
      email: values.email || null,
      notes: values.notes || null,
      status: values.status,
      address: values.street
        ? {
            postalCode: values.postalCode || null,
            street: values.street,
            number: values.number || null,
            complement: values.complement || null,
            district: values.district || null,
            city: values.city,
            state: values.state || null,
            country: values.country || 'BR',
          }
        : undefined,
    };
    const response = await api(customer ? `/customers/${customer.id}` : '/customers', { method: customer ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    setSaving(false);
    if (response.status === 401) return router.replace('/login');
    if (response.status === 403) return setError('Acesso negado.');
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return setError(body.error === 'document_already_exists' ? 'CPF/CNPJ já cadastrado neste tenant.' : friendlyError(body.error, 'Confira os campos informados.'));
    }
    const saved = await response.json();
    router.push(`/app/customers/${saved.id}`);
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
          <select id="status" name="status" className={formFieldClass} defaultValue={String(customer?.status ?? 'active')}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </select>
        </FormField>
        <FormField label="Nome / razão social" htmlFor="legalName" span="full">
          <input id="legalName" className={formFieldClass} name="legalName" required maxLength={200} defaultValue={String(customer?.legal_name ?? '')} />
        </FormField>
        <FormField label="Nome fantasia" htmlFor="tradeName">
          <input id="tradeName" className={formFieldClass} name="tradeName" maxLength={200} defaultValue={String(customer?.trade_name ?? '')} />
        </FormField>
        <FormField label={personType === 'individual' ? 'CPF' : 'CNPJ'} htmlFor="document">
          <input id="document" className={formFieldClass} name="document" inputMode="numeric" defaultValue={String(customer?.document_normalized ?? '')} />
        </FormField>
        <FormField label="RG / inscrição estadual" htmlFor="rgStateRegistration">
          <input id="rgStateRegistration" className={formFieldClass} name="rgStateRegistration" defaultValue={String(customer?.rg_state_registration ?? '')} />
        </FormField>
      </FormSection>

      <FormSection title="Contato">
        <FormField label="E-mail" htmlFor="email">
          <input id="email" className={formFieldClass} name="email" type="email" defaultValue={String(customer?.email ?? '')} />
        </FormField>
        <FormField label="Telefone" htmlFor="phone">
          <input id="phone" className={formFieldClass} name="phone" defaultValue={String(customer?.phone ?? '')} />
        </FormField>
        <FormField label="Celular" htmlFor="mobile">
          <input id="mobile" className={formFieldClass} name="mobile" defaultValue={String(customer?.mobile ?? '')} />
        </FormField>
        <FormField label="WhatsApp" htmlFor="whatsapp">
          <input id="whatsapp" className={formFieldClass} name="whatsapp" defaultValue={String(customer?.whatsapp ?? '')} />
        </FormField>
      </FormSection>

      <FormSection title="Endereço principal">
        <FormField label="CEP" htmlFor="postalCode">
          <input id="postalCode" className={formFieldClass} name="postalCode" defaultValue={String(customer?.postal_code ?? '')} />
        </FormField>
        <FormField label="Logradouro" htmlFor="street">
          <input id="street" className={formFieldClass} name="street" defaultValue={String(customer?.street ?? '')} />
        </FormField>
        <FormField label="Número" htmlFor="number">
          <input id="number" className={formFieldClass} name="number" defaultValue={String(customer?.number ?? '')} />
        </FormField>
        <FormField label="Complemento" htmlFor="complement">
          <input id="complement" className={formFieldClass} name="complement" defaultValue={String(customer?.complement ?? '')} />
        </FormField>
        <FormField label="Bairro" htmlFor="district">
          <input id="district" className={formFieldClass} name="district" defaultValue={String(customer?.district ?? '')} />
        </FormField>
        <FormField label="Cidade" htmlFor="city">
          <input id="city" className={formFieldClass} name="city" defaultValue={String(customer?.city ?? '')} />
        </FormField>
        <FormField label="UF" htmlFor="state">
          <input id="state" className={formFieldClass} name="state" maxLength={2} defaultValue={String(customer?.state ?? '')} />
        </FormField>
        <FormField label="País" htmlFor="country">
          <input id="country" className={formFieldClass} name="country" maxLength={2} defaultValue={String(customer?.country ?? 'BR')} />
        </FormField>
      </FormSection>

      <FormSection title="Observações" columns={1}>
        <FormField label="Notas internas" htmlFor="notes">
          <textarea id="notes" className={`${formFieldClass} min-h-28`} name="notes" maxLength={4000} defaultValue={String(customer?.notes ?? '')} />
        </FormField>
      </FormSection>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <FormActions saving={saving} saveLabel="Salvar cliente" cancelHref="/app/customers" />
    </form>
  );
}
