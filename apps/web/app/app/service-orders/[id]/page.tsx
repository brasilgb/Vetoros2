/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect,useState } from 'react'; // eslint-disable-line @typescript-eslint/no-explicit-any
import { api } from '../../../../lib/api';
export default function Order({params}:{params:Promise<{id:string}>}){const [o,setO]=useState<any>();useEffect(()=>{params.then(p=>api(`/service-orders/${p.id}`).then(r=>r.json()).then(setO));},[params]);if(!o)return <main>Carregando...</main>;return <main><h1>OS {o.order_number}</h1><p>{o.title}</p><p>Status: {o.status}</p><p>Cliente: {o.customer_name}</p><p>Problema: {o.reported_problem}</p><p>Observações: {o.initial_notes||'—'}</p><h2>Itens da OS</h2><ul>{o.items?.map((i:any)=><li key={i.id}>{i.type} — {i.description} — {i.quantity} × R$ {i.unit_price} — total R$ {i.total_amount}</li>)}</ul><p>Subtotal: R$ {o.subtotal??0} · Descontos: R$ {o.discounts??0} · Total: R$ {o.total??0}</p></main>}
