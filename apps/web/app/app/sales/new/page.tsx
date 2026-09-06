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
import { CustomerOptionRow, customerLabel } from '../../../../components/entity-option-rows';
import { searchCustomers, type CustomerOption } from '../../../../lib/entity-search';

export default function NewSalePage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const response = await api('/sales', { method: 'POST', body: JSON.stringify({ customerId: customer?.id ?? null, notes: notes || null }) });
    setSaving(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível criar a venda.'));
    router.push(`/app/sales/${(await response.json()).id}`);
  }

  return (
    <RequireOperationalContext>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageHeader title="Nova venda" />
        <form onSubmit={submit} className="flex flex-col gap-5">
          <FormSection title="Identificação" columns={1}>
            <FormField label="Cliente (opcional)" htmlFor="customerId" helperText="Deixe em branco para consumidor não identificado.">
              <EntityCombobox
                id="customerId"
                value={customer}
                onChange={setCustomer}
                search={searchCustomers}
                getId={(item) => item.id}
                getLabel={customerLabel}
                renderOption={(item) => <CustomerOptionRow item={item} />}
                placeholder="Buscar por nome, CPF/CNPJ, telefone…"
              />
            </FormField>
            <FormField label="Observações" htmlFor="notes">
              <textarea id="notes" className={`${formFieldClass} min-h-24`} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </FormSection>
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          <FormActions saving={saving} saveLabel="Criar venda" cancelHref="/app/sales" />
        </form>
      </div>
    </RequireOperationalContext>
  );
}
