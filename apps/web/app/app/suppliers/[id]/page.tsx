'use client';
import { use, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../../lib/api';
import { SupplierForm } from '../supplier-form';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, formFieldClass } from '../../../../components/form-section';
import { friendlyError } from '../../../../components/error-state';

type SupplierAddress = { id: string; address_type: string; postal_code:string|null;street: string;number:string|null;complement:string|null;district:string|null;city: string; state: string | null; country:string;is_primary: boolean };
type SupplierContact = { id: string; contact_type: string; label:string|null;value: string; is_primary: boolean };
type SupplierDetail = Record<string, unknown> & { supplier_number: string; addresses: SupplierAddress[]; contacts: SupplierContact[] };

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<SupplierDetail>();
  const [error, setError] = useState('');
  const [editingAddress,setEditingAddress]=useState<string>();
  const [editingContact,setEditingContact]=useState<string>();

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
      body: JSON.stringify({ addressType: values.addressType,postalCode:values.postalCode||null, street: values.street,number:values.number||null,complement:values.complement||null,district:values.district||null, city: values.city, state: values.state || null, country: values.country||'BR', isPrimary: Boolean(values.isPrimary) }),
    });
    if (!response.ok) return setError(friendlyError((await response.json()).error));
    setError('');
    event.currentTarget.reset();
    await load();
  }

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await api(`/suppliers/${id}/contacts`, { method: 'POST', body: JSON.stringify({ contactType: values.contactType,label:values.label||null, value: values.value, isPrimary: Boolean(values.isPrimary) }) });
    if (!response.ok) return setError(friendlyError((await response.json()).error));
    setError('');
    event.currentTarget.reset();
    await load();
  }

  async function updateAddress(event:FormEvent<HTMLFormElement>,addressId:string){event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));const response=await api(`/suppliers/${id}/addresses/${addressId}`,{method:'PATCH',body:JSON.stringify({addressType:values.addressType,postalCode:values.postalCode||null,street:values.street,number:values.number||null,complement:values.complement||null,district:values.district||null,city:values.city,state:values.state||null,country:values.country||'BR',isPrimary:Boolean(values.isPrimary)})});if(!response.ok)return setError(friendlyError((await response.json().catch(()=>({}))).error));setEditingAddress(undefined);await load();}
  async function updateContact(event:FormEvent<HTMLFormElement>,contactId:string){event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));const response=await api(`/suppliers/${id}/contacts/${contactId}`,{method:'PATCH',body:JSON.stringify({contactType:values.contactType,label:values.label||null,value:values.value,isPrimary:Boolean(values.isPrimary)})});if(!response.ok)return setError(friendlyError((await response.json().catch(()=>({}))).error));setEditingContact(undefined);await load();}

  if (!data) return <p className="text-sm text-slate-500">Carregando…</p>;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title={`Fornecedor #${data.supplier_number}`} description={String(data.legal_name ?? '')} />
      <SupplierForm supplier={data} />

      <FormSection title="Endereços" columns={1}>
        <ul className="flex flex-col gap-2 text-sm text-slate-700">
          {data.addresses.length === 0 && <li className="text-slate-500">Nenhum endereço cadastrado.</li>}
          {data.addresses.map((address) => (
            <li key={address.id} className="rounded-xl border border-slate-200 px-3 py-2">
              <span>{address.address_type}: {address.street}, {address.city}
              {address.state ? `/${address.state}` : ''} {address.is_primary && <span className="text-slate-500">(principal)</span>}
              </span><button onClick={()=>setEditingAddress(editingAddress===address.id?undefined:address.id)} className="ml-3 text-blue-700">Editar</button><button onClick={async()=>{await api(`/suppliers/${id}/addresses/${address.id}`,{method:'DELETE'});await load();}} className="ml-3 text-red-700">Excluir</button>
              {editingAddress===address.id&&<form onSubmit={(event)=>updateAddress(event,address.id)} className="mt-3 grid gap-2 sm:grid-cols-2"><input name="addressType" defaultValue={address.address_type} className={formFieldClass}/><input name="postalCode" defaultValue={address.postal_code??''} placeholder="CEP" className={formFieldClass}/><input name="street" required defaultValue={address.street} className={formFieldClass}/><input name="number" defaultValue={address.number??''} placeholder="Número" className={formFieldClass}/><input name="complement" defaultValue={address.complement??''} placeholder="Complemento" className={formFieldClass}/><input name="district" defaultValue={address.district??''} placeholder="Bairro" className={formFieldClass}/><input name="city" required defaultValue={address.city} className={formFieldClass}/><input name="state" defaultValue={address.state??''} maxLength={2} className={formFieldClass}/><input name="country" defaultValue={address.country} maxLength={2} className={formFieldClass}/><label><input name="isPrimary" type="checkbox" defaultChecked={address.is_primary}/> Principal</label><button className="rounded-xl bg-blue-600 px-3 py-2 text-white">Salvar endereço</button></form>}
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
          <input name="postalCode" placeholder="CEP" className={formFieldClass} />
          <input name="number" placeholder="Número" className={formFieldClass} />
          <input name="complement" placeholder="Complemento" className={formFieldClass} />
          <input name="district" placeholder="Bairro" className={formFieldClass} />
          <input name="city" required placeholder="Cidade" className={formFieldClass} />
          <input name="state" maxLength={2} placeholder="UF" className={formFieldClass} />
          <input name="country" maxLength={2} defaultValue="BR" placeholder="País" className={formFieldClass} />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input name="isPrimary" type="checkbox" /> Principal
          </label>
          <button className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Adicionar endereço</button>
        </form>
      </FormSection>

      <FormSection title="Contatos" columns={1}>
        <ul className="flex flex-col gap-2 text-sm text-slate-700">
          {data.contacts.length === 0 && <li className="text-slate-500">Nenhum contato cadastrado.</li>}
          {data.contacts.map((contact) => (
            <li key={contact.id} className="rounded-xl border border-slate-200 px-3 py-2">
              <span>{contact.contact_type}: {contact.value} {contact.is_primary && <span className="text-slate-500">(principal)</span>}</span>
              <button onClick={()=>setEditingContact(editingContact===contact.id?undefined:contact.id)} className="ml-3 text-blue-700">Editar</button><button onClick={async()=>{await api(`/suppliers/${id}/contacts/${contact.id}`,{method:'DELETE'});await load();}} className="ml-3 text-red-700">Excluir</button>
              {editingContact===contact.id&&<form onSubmit={(event)=>updateContact(event,contact.id)} className="mt-3 grid gap-2 sm:grid-cols-2"><select name="contactType" defaultValue={contact.contact_type} className={formFieldClass}><option value="phone">Telefone</option><option value="mobile">Celular</option><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="other">Outro</option></select><input name="value" required defaultValue={contact.value} className={formFieldClass}/><input name="label" defaultValue={contact.label??''} placeholder="Rótulo" className={formFieldClass}/><label><input name="isPrimary" type="checkbox" defaultChecked={contact.is_primary}/> Principal</label><button className="rounded-xl bg-blue-600 px-3 py-2 text-white">Salvar contato</button></form>}
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
          <input name="label" placeholder="Rótulo / responsável" className={formFieldClass} />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input name="isPrimary" type="checkbox" /> Principal
          </label>
          <button className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Adicionar contato</button>
        </form>
      </FormSection>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
