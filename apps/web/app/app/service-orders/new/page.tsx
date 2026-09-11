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
import { FormDialog } from '../../../../components/form-dialog';
import { CustomerOptionRow, AssetOptionRow, customerLabel, assetLabel } from '../../../../components/entity-option-rows';
import { searchCustomers, searchAssetsForCustomer, type CustomerOption, type AssetOption } from '../../../../lib/entity-search';

export default function NewServiceOrderPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [asset, setAsset] = useState<AssetOption | null>(null);
  const [form, setForm] = useState({ title: '', reportedProblem: '', initialNotes: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [quickAssetOpen, setQuickAssetOpen] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState('');
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

  async function createQuickCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuickSaving(true); setQuickError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await api('/customers', { method: 'POST', body: JSON.stringify({ personType: 'individual', legalName: values.legalName, mobile: values.mobile || null, status: 'active' }) });
    setQuickSaving(false);
    if (!response.ok) return setQuickError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível cadastrar o cliente.'));
    const created = await response.json();
    setCustomer({ id: created.id, legal_name: created.legal_name, trade_name: created.trade_name ?? null, document_normalized: created.document_normalized ?? null, mobile: created.mobile ?? null, email: created.email ?? null });
    setAsset(null); setQuickCustomerOpen(false);
  }

  async function createQuickAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer) return;
    setQuickSaving(true); setQuickError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await api('/assets', { method: 'POST', body: JSON.stringify({ customerId: customer.id, internalIdentifier: values.internalIdentifier, category: values.category, brand: values.brand || null, model: values.model || null }) });
    setQuickSaving(false);
    if (!response.ok) return setQuickError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível cadastrar o equipamento.'));
    const created = await response.json();
    setAsset({ id: created.id, internal_identifier: created.internal_identifier, category: created.category, brand: created.brand ?? null, model: created.model ?? null });
    setQuickAssetOpen(false);
  }

  return (
    <RequireOperationalContext>
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Nova ordem de serviço" />
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FormSection title="Identificação">
          <FormField label="Cliente" htmlFor="customerId" span="full">
            <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><EntityCombobox
              id="customerId"
              value={customer}
              onChange={selectCustomer}
              search={searchCustomers}
              getId={(item) => item.id}
              getLabel={customerLabel}
              renderOption={(item) => <CustomerOptionRow item={item} />}
              placeholder="Buscar por nome, CPF/CNPJ, telefone…"
              hasError={!customer && Boolean(error)}
            /></div><button type="button" onClick={() => { setQuickError(''); setQuickCustomerOpen(true); }} className="mt-1 shrink-0 rounded-lg border border-blue-300 px-2.5 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50">+ Novo cliente</button></div>
          </FormField>
          <FormField label="Equipamento (opcional)" htmlFor="assetId" span="full" helperText={!customer ? 'Selecione um cliente para ver os equipamentos dele.' : undefined}>
            <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><EntityCombobox
              id="assetId"
              value={asset}
              onChange={setAsset}
              search={searchAssets}
              getId={(item) => item.id}
              getLabel={assetLabel}
              renderOption={(item) => <AssetOptionRow item={item} />}
              placeholder={customer ? 'Buscar equipamento deste cliente…' : 'Selecione um cliente primeiro'}
              disabled={!customer}
            /></div>{customer && <button type="button" onClick={() => { setQuickError(''); setQuickAssetOpen(true); }} className="mt-1 shrink-0 rounded-lg border border-blue-300 px-2.5 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50">+ Novo equipamento</button>}</div>
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
      <FormDialog open={quickCustomerOpen} title="Novo cliente" description="Cadastro rápido; os demais dados podem ser completados depois." submitLabel={quickSaving ? 'Salvando…' : 'Cadastrar cliente'} busy={quickSaving} error={quickError} onCancel={() => setQuickCustomerOpen(false)} onSubmit={createQuickCustomer}>
        <FormField label="Nome / razão social" htmlFor="quick-customer-name"><input id="quick-customer-name" name="legalName" required className={formFieldClass} /></FormField>
        <FormField label="Celular" htmlFor="quick-customer-mobile"><input id="quick-customer-mobile" name="mobile" className={formFieldClass} /></FormField>
      </FormDialog>
      <FormDialog open={quickAssetOpen} title="Novo equipamento" description={`Cliente: ${customer?.legal_name ?? ''}`} submitLabel={quickSaving ? 'Salvando…' : 'Cadastrar equipamento'} busy={quickSaving} error={quickError} onCancel={() => setQuickAssetOpen(false)} onSubmit={createQuickAsset}>
        <FormField label="Identificação interna" htmlFor="quick-asset-id"><input id="quick-asset-id" name="internalIdentifier" required className={formFieldClass} /></FormField>
        <FormField label="Categoria" htmlFor="quick-asset-category"><input id="quick-asset-category" name="category" required placeholder="Notebook, impressora…" className={formFieldClass} /></FormField>
        <FormField label="Marca" htmlFor="quick-asset-brand"><input id="quick-asset-brand" name="brand" className={formFieldClass} /></FormField>
        <FormField label="Modelo" htmlFor="quick-asset-model"><input id="quick-asset-model" name="model" className={formFieldClass} /></FormField>
      </FormDialog>
    </div>
    </RequireOperationalContext>
  );
}
