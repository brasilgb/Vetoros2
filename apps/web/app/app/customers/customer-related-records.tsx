'use client';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Pencil, PlusCircle, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { FormSection, FormField, formFieldClass } from '../../../components/form-section';
import { FormDialog } from '../../../components/form-dialog';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { friendlyError } from '../../../components/error-state';

type Contact={id:string;contact_type:string;label:string|null;value:string;is_primary:boolean};
type Address={id:string;address_type:string;postal_code:string|null;street:string;number:string|null;complement:string|null;district:string|null;city:string;state:string|null;country:string;is_primary:boolean};
const emptyContact={contactType:'phone',label:'',value:'',isPrimary:false};
const emptyAddress={addressType:'main',postalCode:'',street:'',number:'',complement:'',district:'',city:'',state:'',country:'BR',isPrimary:false};

export function CustomerRelatedRecords({customerId}:{customerId:string}){
 const[contacts,setContacts]=useState<Contact[]>([]),[addresses,setAddresses]=useState<Address[]>([]);
 const[contact,setContact]=useState({...emptyContact}),[address,setAddress]=useState({...emptyAddress});
 const[contactId,setContactId]=useState<string>(),[addressId,setAddressId]=useState<string>(),[deleteTarget,setDeleteTarget]=useState<{kind:'contacts'|'addresses';id:string}>();
 const[contactOpen,setContactOpen]=useState(false),[addressOpen,setAddressOpen]=useState(false);
 const[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=useCallback(async()=>{const[c,a]=await Promise.all([api(`/customers/${customerId}/contacts`),api(`/customers/${customerId}/addresses`)]);if(c.ok)setContacts(await c.json());if(a.ok)setAddresses(await a.json());},[customerId]);
 useEffect(()=>{void load();},[load]);
 function editContact(row?:Contact){setError('');setContactId(row?.id);setContact(row?{contactType:row.contact_type,label:row.label??'',value:row.value,isPrimary:row.is_primary}:{...emptyContact});setContactOpen(true);}
 function editAddress(row?:Address){setError('');setAddressId(row?.id);setAddress(row?{addressType:row.address_type,postalCode:row.postal_code??'',street:row.street,number:row.number??'',complement:row.complement??'',district:row.district??'',city:row.city,state:row.state??'',country:row.country,isPrimary:row.is_primary}:{...emptyAddress});setAddressOpen(true);}
 async function saveContact(e:FormEvent){e.preventDefault();setBusy(true);setError('');const response=await api(`/customers/${customerId}/contacts${contactId?`/${contactId}`:''}`,{method:contactId?'PATCH':'POST',body:JSON.stringify({...contact,label:contact.label||null})});setBusy(false);if(!response.ok)return setError(friendlyError((await response.json().catch(()=>({}))).error));setContactOpen(false);setContactId(undefined);setContact({...emptyContact});await load();}
 async function saveAddress(e:FormEvent){e.preventDefault();setBusy(true);setError('');const payload=Object.fromEntries(Object.entries(address).map(([k,v])=>[k,v===''?null:v]));const response=await api(`/customers/${customerId}/addresses${addressId?`/${addressId}`:''}`,{method:addressId?'PATCH':'POST',body:JSON.stringify(payload)});setBusy(false);if(!response.ok)return setError(friendlyError((await response.json().catch(()=>({}))).error));setAddressOpen(false);setAddressId(undefined);setAddress({...emptyAddress});await load();}
 async function remove(){if(!deleteTarget)return;setBusy(true);const response=await api(`/customers/${customerId}/${deleteTarget.kind}/${deleteTarget.id}`,{method:'DELETE'});setBusy(false);if(!response.ok)return setError(friendlyError((await response.json().catch(()=>({}))).error));setDeleteTarget(undefined);await load();}
 return <>
  <FormSection title="Contatos adicionais" description="Mantenha telefone, celular, WhatsApp e e-mail, com um principal por tipo." columns={1}>
   <button type="button" onClick={()=>editContact()} className="flex w-fit items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm"><PlusCircle className="h-4 w-4"/>Adicionar contato</button>
   <div className="divide-y rounded-xl border border-slate-200">{contacts.map(row=><div key={row.id} className="flex items-center justify-between gap-3 p-3 text-sm"><span><strong>{row.label||row.contact_type}</strong> · {row.value}{row.is_primary?' · Principal':''}</span><span className="flex gap-1"><button aria-label="Editar contato" onClick={()=>editContact(row)} className="p-2"><Pencil className="h-4 w-4"/></button><button aria-label="Remover contato" onClick={()=>setDeleteTarget({kind:'contacts',id:row.id})} className="p-2 text-red-700"><Trash2 className="h-4 w-4"/></button></span></div>)}{!contacts.length&&<p className="p-3 text-sm text-slate-500">Nenhum contato adicional.</p>}</div>
  </FormSection>
  <FormSection title="Endereços" description="Endereços de cadastro, cobrança, entrega ou outros." columns={1}>
   <button type="button" onClick={()=>editAddress()} className="flex w-fit items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm"><PlusCircle className="h-4 w-4"/>Adicionar endereço</button>
   <div className="divide-y rounded-xl border border-slate-200">{addresses.map(row=><div key={row.id} className="flex items-center justify-between gap-3 p-3 text-sm"><span><strong>{row.address_type}{row.is_primary?' · Principal':''}</strong><br/>{row.street}{row.number?`, ${row.number}`:''} · {row.city}/{row.state||'—'}</span><span className="flex gap-1"><button aria-label="Editar endereço" onClick={()=>editAddress(row)} className="p-2"><Pencil className="h-4 w-4"/></button><button aria-label="Remover endereço" onClick={()=>setDeleteTarget({kind:'addresses',id:row.id})} className="p-2 text-red-700"><Trash2 className="h-4 w-4"/></button></span></div>)}{!addresses.length&&<p className="p-3 text-sm text-slate-500">Nenhum endereço.</p>}</div>
  </FormSection>
  <FormDialog open={contactOpen} title={contactId?'Editar contato':'Novo contato'} submitLabel="Salvar" busy={busy} error={error} onSubmit={saveContact} onCancel={()=>{setContactOpen(false);setContactId(undefined);setContact({...emptyContact});setError('');}}>
   <FormField label="Tipo" htmlFor="contact-type"><select id="contact-type" className={formFieldClass} value={contact.contactType} onChange={e=>setContact({...contact,contactType:e.target.value})}><option value="phone">Telefone</option><option value="mobile">Celular</option><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option></select></FormField>
   <FormField label="Rótulo" htmlFor="contact-label"><input id="contact-label" className={formFieldClass} value={contact.label} onChange={e=>setContact({...contact,label:e.target.value})}/></FormField>
   <FormField label="Valor" htmlFor="contact-value"><input id="contact-value" required className={formFieldClass} value={contact.value} onChange={e=>setContact({...contact,value:e.target.value})}/></FormField>
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={contact.isPrimary} onChange={e=>setContact({...contact,isPrimary:e.target.checked})}/>Contato principal deste tipo</label>
  </FormDialog>
  <FormDialog open={addressOpen} title={addressId?'Editar endereço':'Novo endereço'} submitLabel="Salvar" busy={busy} error={error} onSubmit={saveAddress} onCancel={()=>{setAddressOpen(false);setAddressId(undefined);setAddress({...emptyAddress});setError('');}}>
   <FormField label="Tipo" htmlFor="address-type"><select id="address-type" className={formFieldClass} value={address.addressType} onChange={e=>setAddress({...address,addressType:e.target.value})}><option value="main">Principal</option><option value="billing">Cobrança</option><option value="shipping">Entrega</option><option value="other">Outro</option></select></FormField>
   <FormField label="CEP" htmlFor="address-zip"><input id="address-zip" className={formFieldClass} value={address.postalCode} onChange={e=>setAddress({...address,postalCode:e.target.value})}/></FormField>
   <FormField label="Logradouro" htmlFor="address-street"><input id="address-street" required className={formFieldClass} value={address.street} onChange={e=>setAddress({...address,street:e.target.value})}/></FormField>
   <FormField label="Número" htmlFor="address-number"><input id="address-number" className={formFieldClass} value={address.number} onChange={e=>setAddress({...address,number:e.target.value})}/></FormField>
   <FormField label="Complemento" htmlFor="address-complement"><input id="address-complement" className={formFieldClass} value={address.complement} onChange={e=>setAddress({...address,complement:e.target.value})}/></FormField>
   <FormField label="Bairro" htmlFor="address-district"><input id="address-district" className={formFieldClass} value={address.district} onChange={e=>setAddress({...address,district:e.target.value})}/></FormField>
   <FormField label="Cidade" htmlFor="address-city"><input id="address-city" required className={formFieldClass} value={address.city} onChange={e=>setAddress({...address,city:e.target.value})}/></FormField>
   <FormField label="UF" htmlFor="address-state"><input id="address-state" maxLength={2} className={formFieldClass} value={address.state} onChange={e=>setAddress({...address,state:e.target.value.toUpperCase()})}/></FormField>
   <FormField label="País" htmlFor="address-country"><input id="address-country" maxLength={2} className={formFieldClass} value={address.country} onChange={e=>setAddress({...address,country:e.target.value.toUpperCase()})}/></FormField>
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={address.isPrimary} onChange={e=>setAddress({...address,isPrimary:e.target.checked})}/>Endereço principal</label>
  </FormDialog>
  <ConfirmDialog open={!!deleteTarget} title="Remover registro?" description="Este dado auxiliar ainda não possui histórico transacional próprio." confirmLabel="Remover" tone="destructive" busy={busy} onConfirm={remove} onCancel={()=>setDeleteTarget(undefined)}/>
 </>;
}
