'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { AsyncButton } from '../../../../components/async-button';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';

// GET /branches/:id passou a devolver os mesmos campos da listagem (correção da ADM-01, seção
// 19 do correio.md — antes só devolvia {id, company_id} e esta tela buscava a lista inteira
// para achar o registro; o workaround foi removido junto com a correção do endpoint).
type Branch = { id: string; name: string; code: string; company_id: string; timezone: string; is_default: boolean; status: string; ibge_city_code: string|null; phone:string|null;email:string|null;postal_code:string|null;street:string|null;address_number:string|null;address_complement:string|null;district:string|null;city:string|null;state:string|null;country:string };

export default function BranchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [branch, setBranch] = useState<Branch>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [fields, setFields] = useState({ name: '', status: 'active', timezone: 'America/Sao_Paulo', isDefault: false, ibgeCityCode: '', phone: '', email: '', postalCode: '', street: '', addressNumber: '', addressComplement: '', district: '', city: '', state: '', country: 'BR' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await api(`/branches/${id}`);
    if (!response.ok) return setState('error');
    const found: Branch = await response.json();
    setBranch(found);
    setFields({ name: found.name, status: found.status, timezone: found.timezone, isDefault: found.is_default, ibgeCityCode: found.ibge_city_code ?? '', phone: found.phone ?? '', email: found.email ?? '', postalCode: found.postal_code ?? '', street: found.street ?? '', addressNumber: found.address_number ?? '', addressComplement: found.address_complement ?? '', district: found.district ?? '', city: found.city ?? '', state: found.state ?? '', country: found.country });
    setState('ready');
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useSetBreadcrumb(branch ? branch.name : undefined);

  if (state === 'loading') return <p className="text-sm text-slate-500">Carregando…</p>;
  if (state === 'error' || !branch) return <ErrorState message="Não foi possível carregar esta filial." onRetry={load} />;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title={branch.name} description={`Código: ${branch.code}`} />

      <FormSection title="Identificação">
        <FormField label="Nome" htmlFor="name" span="full">
          <input id="name" className={formFieldClass} value={fields.name} onChange={(e) => setFields({ ...fields, name: e.target.value })} />
        </FormField>
        <FormField label="Fuso horário" htmlFor="timezone"><input id="timezone" className={formFieldClass} value={fields.timezone} onChange={(e) => setFields({ ...fields, timezone: e.target.value })} /></FormField>
        <FormField label="Filial padrão" htmlFor="isDefault"><label className="flex items-center gap-2 text-sm"><input id="isDefault" type="checkbox" checked={fields.isDefault} onChange={(e) => setFields({ ...fields, isDefault: e.target.checked })} /> Padrão desta empresa</label></FormField>
        {([['phone','Telefone'],['email','E-mail'],['postalCode','CEP'],['street','Logradouro'],['addressNumber','Número'],['addressComplement','Complemento'],['district','Bairro'],['city','Cidade'],['state','UF']] as const).map(([key,label]) => <FormField key={key} label={label} htmlFor={key}><input id={key} type={key==='email'?'email':'text'} className={formFieldClass} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} /></FormField>)}
        <FormField label="Status" htmlFor="status">
          <select id="status" className={formFieldClass} value={fields.status} onChange={(e) => setFields({ ...fields, status: e.target.value })}>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>
        </FormField>
        <FormField label="Código IBGE do município" htmlFor="ibgeCityCode"><input id="ibgeCityCode" maxLength={7} className={formFieldClass} value={fields.ibgeCityCode} onChange={(e) => setFields({ ...fields, ibgeCityCode: e.target.value })} /></FormField>
        <div className="sm:col-span-2">
          <AsyncButton
            tone="secondary"
            label="Salvar"
            busyLabel="Salvando…"
            onClick={async () => {
              const response = await api(`/branches/${id}`, { method: 'PATCH', body: JSON.stringify({ ...fields, phone: fields.phone || null, email: fields.email || null, postalCode: fields.postalCode || null, street: fields.street || null, addressNumber: fields.addressNumber || null, addressComplement: fields.addressComplement || null, district: fields.district || null, city: fields.city || null, state: fields.state || null }) });
              await api(`/branches/${id}/fiscal`, { method: 'PATCH', body: JSON.stringify({ ibgeCityCode: fields.ibgeCityCode || null }) });
              if (!response.ok) setError(friendlyError((await response.json().catch(() => ({}))).error));
              else await load();
            }}
          />
        </div>
      </FormSection>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
