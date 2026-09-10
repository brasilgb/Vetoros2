'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { AsyncButton } from '../../../../components/async-button';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';

type Company = {
  id: string; legal_name: string; trade_name: string | null; tax_id_type: string; tax_id_normalized: string;
  state_registration: string | null; municipal_registration: string | null; status: string;
  phone: string | null; email: string | null; postal_code: string | null; street: string | null; address_number: string | null; address_complement: string | null; district: string | null; city: string | null; state: string | null; country: string; logo_url: string | null;
};

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [company, setCompany] = useState<Company>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [fields, setFields] = useState({ legalName: '', tradeName: '', stateRegistration: '', municipalRegistration: '', status: 'active', phone: '', email: '', postalCode: '', street: '', addressNumber: '', addressComplement: '', district: '', city: '', state: '', country: 'BR', logoUrl: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await api(`/companies/${id}`);
    if (!response.ok) return setState('error');
    const data: Company = await response.json();
    setCompany(data);
    setFields({ legalName: data.legal_name, tradeName: data.trade_name ?? '', stateRegistration: data.state_registration ?? '', municipalRegistration: data.municipal_registration ?? '', status: data.status, phone: data.phone ?? '', email: data.email ?? '', postalCode: data.postal_code ?? '', street: data.street ?? '', addressNumber: data.address_number ?? '', addressComplement: data.address_complement ?? '', district: data.district ?? '', city: data.city ?? '', state: data.state ?? '', country: data.country, logoUrl: data.logo_url ?? '' });
    setState('ready');
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useSetBreadcrumb(company ? company.trade_name || company.legal_name : undefined);

  if (state === 'loading') return <p className="text-sm text-slate-500">Carregando…</p>;
  if (state === 'error' || !company) return <ErrorState message="Não foi possível carregar esta empresa." onRetry={load} />;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title={company.trade_name || company.legal_name} description={`${company.tax_id_type === 'cpf' ? 'CPF' : company.tax_id_type === 'cnpj' ? 'CNPJ' : 'Documento'}: ${company.tax_id_normalized}`} />

      <FormSection title="Identificação">
        <FormField label="Razão social" htmlFor="legalName" span="full">
          <input id="legalName" className={formFieldClass} value={fields.legalName} onChange={(e) => setFields({ ...fields, legalName: e.target.value })} />
        </FormField>
        <FormField label="Nome fantasia" htmlFor="tradeName" span="full">
          <input id="tradeName" className={formFieldClass} value={fields.tradeName} onChange={(e) => setFields({ ...fields, tradeName: e.target.value })} />
        </FormField>
        <FormField label="Status" htmlFor="status">
          <select id="status" className={formFieldClass} value={fields.status} onChange={(e) => setFields({ ...fields, status: e.target.value })}>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>
        </FormField>
      </FormSection>

      <FormSection title="Contato e endereço">
        {([['phone','Telefone'],['email','E-mail'],['postalCode','CEP'],['street','Logradouro'],['addressNumber','Número'],['addressComplement','Complemento'],['district','Bairro'],['city','Cidade'],['state','UF'],['logoUrl','URL do logotipo']] as const).map(([key,label]) => <FormField key={key} label={label} htmlFor={key}><input id={key} type={key==='email'?'email':'text'} className={formFieldClass} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} /></FormField>)}
      </FormSection>

      <FormSection title="Inscrições">
        <FormField label="Inscrição estadual" htmlFor="stateRegistration">
          <input id="stateRegistration" className={formFieldClass} value={fields.stateRegistration} onChange={(e) => setFields({ ...fields, stateRegistration: e.target.value })} />
        </FormField>
        <FormField label="Inscrição municipal" htmlFor="municipalRegistration">
          <input id="municipalRegistration" className={formFieldClass} value={fields.municipalRegistration} onChange={(e) => setFields({ ...fields, municipalRegistration: e.target.value })} />
        </FormField>
        <div className="sm:col-span-2">
          <AsyncButton
            tone="secondary"
            label="Salvar"
            busyLabel="Salvando…"
            onClick={async () => {
              const response = await api(`/companies/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ ...fields, tradeName: fields.tradeName || null, stateRegistration: fields.stateRegistration || null, municipalRegistration: fields.municipalRegistration || null, phone: fields.phone || null, email: fields.email || null, postalCode: fields.postalCode || null, street: fields.street || null, addressNumber: fields.addressNumber || null, addressComplement: fields.addressComplement || null, district: fields.district || null, city: fields.city || null, state: fields.state || null, logoUrl: fields.logoUrl || null }),
              });
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
