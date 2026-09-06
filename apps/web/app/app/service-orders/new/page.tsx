'use client';
import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormActions } from '../../../../components/form-actions';
import { friendlyError } from '../../../../components/error-state';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { EntityCombobox } from '../../../../components/entity-combobox';
import { CustomerOptionRow, AssetOptionRow, customerLabel, assetLabel } from '../../../../components/entity-option-rows';
import { searchCustomers, searchAssetsForCustomer, type CustomerOption, type AssetOption } from '../../../../lib/entity-search';

export default function NewServiceOrderPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [asset, setAsset] = useState<AssetOption | null>(null);
  const [form, setForm] = useState({ title: '', reportedProblem: '', initialNotes: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const searchAssets = useMemo(() => (customer ? searchAssetsForCustomer(customer.id) : async () => []), [customer]);

  const selectCustomer = useCallback((next: CustomerOption | null) => {
    setCustomer(next);
    setAsset(null); // seção 6: trocar de cliente invalida o equipamento já escolhido, que pertencia ao cliente anterior
    if (next) setError('');
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer) return setError('Selecione um cliente.');
    setSaving(true);
    setError('');
    const response = await api('/service-orders', { method: 'POST', body: JSON.stringify({ ...form, customerId: customer.id, assetId: asset?.id ?? null }) });
    setSaving(false);
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível criar a OS.'));
    router.push(`/app/service-orders/${(await response.json()).id}`);
  }

  return (
    <RequireOperationalContext>
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Nova ordem de serviço" />
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FormSection title="Identificação">
          <FormField label="Cliente" htmlFor="customerId" span="full">
            <EntityCombobox
              id="customerId"
              value={customer}
              onChange={selectCustomer}
              search={searchCustomers}
              getId={(item) => item.id}
              getLabel={customerLabel}
              renderOption={(item) => <CustomerOptionRow item={item} />}
              placeholder="Buscar por nome, CPF/CNPJ, telefone…"
              hasError={!customer && Boolean(error)}
            />
          </FormField>
          <FormField label="Equipamento (opcional)" htmlFor="assetId" span="full" helperText={!customer ? 'Selecione um cliente para ver os equipamentos dele.' : undefined}>
            <EntityCombobox
              id="assetId"
              value={asset}
              onChange={setAsset}
              search={searchAssets}
              getId={(item) => item.id}
              getLabel={assetLabel}
              renderOption={(item) => <AssetOptionRow item={item} />}
              placeholder={customer ? 'Buscar equipamento deste cliente…' : 'Selecione um cliente primeiro'}
              disabled={!customer}
            />
          </FormField>
          <FormField label="Título" htmlFor="title" span="full">
            <input id="title" required className={formFieldClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </FormField>
        </FormSection>
        <FormSection title="Detalhes" columns={1}>
          <FormField label="Problema relatado" htmlFor="reportedProblem">
            <textarea id="reportedProblem" required className={`${formFieldClass} min-h-24`} value={form.reportedProblem} onChange={(e) => setForm({ ...form, reportedProblem: e.target.value })} />
          </FormField>
          <FormField label="Observações" htmlFor="initialNotes">
            <textarea id="initialNotes" className={`${formFieldClass} min-h-24`} value={form.initialNotes} onChange={(e) => setForm({ ...form, initialNotes: e.target.value })} />
          </FormField>
        </FormSection>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <FormActions saving={saving} saveLabel="Abrir OS" cancelHref="/app/service-orders" />
      </form>
    </div>
    </RequireOperationalContext>
  );
}
