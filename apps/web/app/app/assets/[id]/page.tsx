'use client';
import { use, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { AsyncButton } from '../../../../components/async-button';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';

type Identifier = { id: string; identifier_type: string; value: string };
type Asset = {
  id: string; internal_identifier: string; category: string; brand: string | null; model: string | null; serial_number: string | null; imei: string | null;
  asset_tag: string | null; description: string | null; notes: string | null; status: string; customer_name: string; identifiers: Identifier[];
};

export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [asset, setAsset] = useState<Asset>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [fields, setFields] = useState({ internalIdentifier: '', category: '', brand: '', model: '', serialNumber: '', imei: '', assetTag: '', description: '', notes: '', status: 'active' });
  const [identifier, setIdentifier] = useState({ identifierType: '', value: '' });
  const [addingIdentifier, setAddingIdentifier] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await api(`/assets/${id}`);
    if (!response.ok) return setState('error');
    const data: Asset = await response.json();
    setAsset(data);
    setFields({
      internalIdentifier: data.internal_identifier, category: data.category, brand: data.brand ?? '', model: data.model ?? '', serialNumber: data.serial_number ?? '',
      imei: data.imei ?? '', assetTag: data.asset_tag ?? '', description: data.description ?? '', notes: data.notes ?? '', status: data.status,
    });
    setState('ready');
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useSetBreadcrumb(asset ? asset.internal_identifier : undefined);

  async function addIdentifier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddingIdentifier(true);
    setError('');
    const response = await api(`/assets/${id}/identifiers`, { method: 'POST', body: JSON.stringify(identifier) });
    setAddingIdentifier(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    setIdentifier({ identifierType: '', value: '' });
    await load();
  }

  if (state === 'loading') return <p className="text-sm text-emerald-100/60">Carregando…</p>;
  if (state === 'error' || !asset) return <ErrorState message="Não foi possível carregar este equipamento." onRetry={load} />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={asset.internal_identifier} description={`Cliente: ${asset.customer_name}`} />

      <FormSection title="Identificação">
        <FormField label="Identificação interna" htmlFor="internalIdentifier">
          <input id="internalIdentifier" className={formFieldClass} value={fields.internalIdentifier} onChange={(e) => setFields({ ...fields, internalIdentifier: e.target.value })} />
        </FormField>
        <FormField label="Categoria" htmlFor="category">
          <input id="category" className={formFieldClass} value={fields.category} onChange={(e) => setFields({ ...fields, category: e.target.value })} />
        </FormField>
        <FormField label="Status" htmlFor="status">
          <select id="status" className={formFieldClass} value={fields.status} onChange={(e) => setFields({ ...fields, status: e.target.value })}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
            <option value="retired">Desativado</option>
          </select>
        </FormField>
      </FormSection>

      <FormSection title="Detalhes">
        <FormField label="Marca" htmlFor="brand">
          <input id="brand" className={formFieldClass} value={fields.brand} onChange={(e) => setFields({ ...fields, brand: e.target.value })} />
        </FormField>
        <FormField label="Modelo" htmlFor="model">
          <input id="model" className={formFieldClass} value={fields.model} onChange={(e) => setFields({ ...fields, model: e.target.value })} />
        </FormField>
        <FormField label="Número de série" htmlFor="serialNumber">
          <input id="serialNumber" className={formFieldClass} value={fields.serialNumber} onChange={(e) => setFields({ ...fields, serialNumber: e.target.value })} />
        </FormField>
        <FormField label="IMEI" htmlFor="imei">
          <input id="imei" className={formFieldClass} value={fields.imei} onChange={(e) => setFields({ ...fields, imei: e.target.value })} />
        </FormField>
        <FormField label="Etiqueta patrimonial" htmlFor="assetTag">
          <input id="assetTag" className={formFieldClass} value={fields.assetTag} onChange={(e) => setFields({ ...fields, assetTag: e.target.value })} />
        </FormField>
      </FormSection>

      <FormSection title="Observações" columns={1}>
        <FormField label="Descrição" htmlFor="description">
          <textarea id="description" className={`${formFieldClass} min-h-20`} value={fields.description} onChange={(e) => setFields({ ...fields, description: e.target.value })} />
        </FormField>
        <FormField label="Notas internas" htmlFor="notes">
          <textarea id="notes" className={`${formFieldClass} min-h-20`} value={fields.notes} onChange={(e) => setFields({ ...fields, notes: e.target.value })} />
        </FormField>
        <AsyncButton
          tone="secondary"
          label="Salvar"
          busyLabel="Salvando…"
          onClick={async () => {
            const response = await api(`/assets/${id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                internalIdentifier: fields.internalIdentifier, category: fields.category, brand: fields.brand || null, model: fields.model || null, serialNumber: fields.serialNumber || null,
                imei: fields.imei || null, assetTag: fields.assetTag || null, description: fields.description || null, notes: fields.notes || null, status: fields.status,
              }),
            });
            if (!response.ok) setError(friendlyError((await response.json().catch(() => ({}))).error));
            else await load();
          }}
        />
      </FormSection>

      <FormSection title="Identificadores adicionais" columns={1}>
        <ul className="flex flex-col gap-2 text-sm text-emerald-100">
          {asset.identifiers.length === 0 && <li className="text-emerald-100/50">Nenhum identificador adicional cadastrado.</li>}
          {asset.identifiers.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-emerald-900 px-3 py-2">
              {entry.identifier_type}: {entry.value}
            </li>
          ))}
        </ul>
        <form onSubmit={addIdentifier} className="grid gap-3 sm:grid-cols-2">
          <input required placeholder="Tipo (ex.: número de patrimônio)" className={formFieldClass} value={identifier.identifierType} onChange={(e) => setIdentifier({ ...identifier, identifierType: e.target.value })} />
          <input required placeholder="Valor" className={formFieldClass} value={identifier.value} onChange={(e) => setIdentifier({ ...identifier, value: e.target.value })} />
          <button type="submit" disabled={addingIdentifier} className="rounded-xl border border-emerald-800 px-4 py-2.5 text-sm font-medium text-emerald-100 hover:bg-emerald-950 sm:col-span-2">
            {addingIdentifier ? 'Adicionando…' : 'Adicionar identificador'}
          </button>
        </form>
      </FormSection>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
