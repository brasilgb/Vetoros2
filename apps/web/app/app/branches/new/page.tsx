'use client';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormActions } from '../../../../components/form-actions';
import { friendlyError } from '../../../../components/error-state';

type Company = { id: string; legal_name: string; trade_name: string | null };

export default function NewBranchPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState({ companyId: '', code: '', name: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api('/companies').then(async (response) => {
      if (response.ok) setCompanies(await response.json());
    });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.companyId) return setError('Selecione uma empresa.');
    setSaving(true);
    setError('');
    const response = await api('/branches', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível criar a filial.'));
    router.push(`/app/branches/${(await response.json()).id}`);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Nova filial" />
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FormSection title="Identificação">
          {/* Poucas empresas por tenant (seção 10/11 do correio.md UX-03): select simples resolve melhor que um combobox de busca aqui. */}
          <FormField label="Empresa" htmlFor="companyId" span="full">
            <select id="companyId" required className={formFieldClass} value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
              <option value="">Selecione a empresa</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.trade_name || company.legal_name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Código" htmlFor="code">
            <input id="code" required className={formFieldClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </FormField>
          <FormField label="Nome" htmlFor="name">
            <input id="name" required className={formFieldClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
        </FormSection>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <FormActions saving={saving} saveLabel="Criar filial" cancelHref="/app/branches" />
      </form>
    </div>
  );
}
