'use client';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, formFieldClass } from '../../../../components/form-section';
import { friendlyError } from '../../../../components/error-state';
import { RequireOperationalContext } from '../../../../components/require-operational-context';

type CatalogEntry={id:string;name:string;status:'active'|'inactive'};
export default function InventoryCatalogsPage(){
 const [categories,setCategories]=useState<CatalogEntry[]>([]),[brands,setBrands]=useState<CatalogEntry[]>([]),[error,setError]=useState('');
 const load=useCallback(async()=>{const [c,b]=await Promise.all([api('/inventory/categories'),api('/inventory/brands')]);if(c.ok)setCategories(await c.json());if(b.ok)setBrands(await b.json());},[]);
 useEffect(()=>{void load();},[load]);
 async function add(event:FormEvent<HTMLFormElement>,path:'categories'|'brands'){event.preventDefault();const form=event.currentTarget,name=String(new FormData(form).get('name')??'');const response=await api(`/inventory/${path}`,{method:'POST',body:JSON.stringify({name})});if(!response.ok)return setError(friendlyError((await response.json().catch(()=>({}))).error));form.reset();setError('');await load();}
 async function toggle(path:'categories'|'brands',entry:CatalogEntry){const response=await api(`/inventory/${path}/${entry.id}`,{method:'PATCH',body:JSON.stringify({status:entry.status==='active'?'inactive':'active'})});if(!response.ok)return setError(friendlyError((await response.json().catch(()=>({}))).error));await load();}
 const section=(title:string,path:'categories'|'brands',entries:CatalogEntry[])=><FormSection title={title} columns={1}><ul className="space-y-2 text-sm">{entries.map(entry=><li key={entry.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2"><span>{entry.name} <span className="text-slate-500">({entry.status==='active'?'ativo':'inativo'})</span></span><button onClick={()=>void toggle(path,entry)} className="rounded-lg border border-slate-300 px-2 py-1">{entry.status==='active'?'Inativar':'Ativar'}</button></li>)}</ul><form onSubmit={(event)=>add(event,path)} className="flex gap-2"><input name="name" required className={formFieldClass} placeholder={`Nova ${title.toLowerCase().replace(/s$/,'')}`} /><button className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Adicionar</button></form></FormSection>;
 return <RequireOperationalContext><div className="mx-auto flex w-full max-w-5xl flex-col gap-6"><PageHeader title="Categorias e marcas" description="Catálogos relacionais dos produtos." />{section('Categorias','categories',categories)}{section('Marcas','brands',brands)}{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}</div></RequireOperationalContext>;
}
