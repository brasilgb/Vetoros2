'use client';
import { use, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../../lib/api';
import { SupplierForm } from '../supplier-form';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, formFieldClass } from '../../../../components/form-section';
import { friendlyError } from '../../../../components/error-state';

type SupplierAddress = { id: string; address_type: string; street: string; city: string; state: string | null; is_primary: boolean };
type SupplierContact = { id: string; contact_type: string; value: string; is_primary: boolean };
type SupplierDetail = Record<string, unknown> & { supplier_number: string; addresses: SupplierAddress[]; contacts: SupplierContact[] };

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<SupplierDetail>();
  const [error, setError] = useState('');

  async function load() {
    const response = await api(`/suppliers/${id}`);
    if (response.ok) setData(await response.json());
  }
  useEffect(() => {
    void load();
  }, [id]);

  async function addAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await api(`/suppliers/${id}/addresses`, {
      method: 'POST',
      body: JSON.stringify({ addressType: values.addressType, street: values.street, city: values.city, state: values.state || null, country: 'BR', isPrimary: Boolean(values.isPrimary) }),
    });
    if (!response.ok) return setError(friendlyError((await response.json()).error));
    setError('');
    event.currentTarget.reset();
    await load();
  }

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await api(`/suppliers/${id}/contacts`, { method: 'POST', body: JSON.stringify({ contactType: values.contactType, value: values.value, isPrimary: Boolean(values.isPrimary) }) });
    if (!response.ok) return setError(friendlyError((await response.json()).error));
    setError('');
    event.currentTarget.reset();
    await load();
  }

  if (!data) return <p className="text-sm text-emerald-100/60">Carregando…</p>;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={`Fornecedor #${data.supplier_number}`} description={String(data.legal_name ?? '')} />
      <SupplierForm supplier={data} />

      <FormSection title="Endereços" columns={1}>
        <ul className="flex flex-col gap-2 text-sm text-emerald-100">
          {data.addresses.length === 0 && <li className="text-emerald-100/50">Nenhum endereço cadastrado.</li>}
          {data.addresses.map((address) => (
            <li key={address.id} className="rounded-xl border border-emerald-900 px-3 py-2">
              {address.address_type}: {address.street}, {address.city}
              {address.state ? `/${address.state}` : ''} {address.is_primary && <span className="text-emerald-100/50">(principal)</span>}
            </li>
          ))}
        </ul>
        <form onSubmit={addAddress} className="grid gap-3 sm:grid-cols-2">
          <select name="addressType" className={formFieldClass}>
            <option value="commercial">Comercial</option>
            <option value="billing">Cobrança</option>
            <option value="shipping">Entrega</option>
            <option value="other">Outro</option>
          </select>
          <input name="street" required placeholder="Logradouro" className={formFieldClass} />
          <input name="city" required placeholder="Cidade" className={formFieldClass} />
          <input name="state" maxLength={2} placeholder="UF" className={formFieldClass} />
          <label className="flex items-center gap-2 text-sm text-emerald-100/70">
            <input name="isPrimary" type="checkbox" /> Principal
          </label>
          <button className="rounded-xl border border-emerald-800 px-4 py-2.5 text-sm font-medium text-emerald-100 hover:bg-emerald-950">Adicionar endereço</button>
        </form>
      </FormSection>

      <FormSection title="Contatos" columns={1}>
        <ul className="flex flex-col gap-2 text-sm text-emerald-100">
          {data.contacts.length === 0 && <li className="text-emerald-100/50">Nenhum contato cadastrado.</li>}
          {data.contacts.map((contact) => (
            <li key={contact.id} className="rounded-xl border border-emerald-900 px-3 py-2">
              {contact.contact_type}: {contact.value} {contact.is_primary && <span className="text-emerald-100/50">(principal)</span>}
            </li>
          ))}
        </ul>
        <form onSubmit={addContact} className="grid gap-3 sm:grid-cols-2">
          <select name="contactType" className={formFieldClass}>
            <option value="phone">Telefone</option>
            <option value="mobile">Celular</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">E-mail</option>
            <option value="other">Outro</option>
          </select>
          <input name="value" required placeholder="Contato" className={formFieldClass} />
          <label className="flex items-center gap-2 text-sm text-emerald-100/70">
            <input name="isPrimary" type="checkbox" /> Principal
          </label>
          <button className="rounded-xl border border-emerald-800 px-4 py-2.5 text-sm font-medium text-emerald-100 hover:bg-emerald-950">Adicionar contato</button>
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
