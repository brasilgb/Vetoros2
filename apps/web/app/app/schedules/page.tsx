'use client';
import Link from 'next/link';
import { useCallback,useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock,PlusCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { DataTable,DataTablePagination,type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge } from '../../../components/status-badge';
import { friendlyError } from '../../../components/error-state';
import { RequireOperationalContext } from '../../../components/require-operational-context';
import { useOperationalContext } from '../../../components/operational-context';

type Schedule={id:string;starts_at:string;ends_at:string|null;customer_name:string;service_order_number:number|null;responsible_name:string|null;status:'scheduled'|'canceled'};
const PAGE_SIZE=30;
function localDay(offset=0){const d=new Date();d.setDate(d.getDate()+offset);return d.toISOString().slice(0,10);}
function formatTime(v:string){return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));}
export default function SchedulesPage(){const router=useRouter(),{hasFullContext}=useOperationalContext();const[rows,setRows]=useState<Schedule[]>([]),[state,setState]=useState<'loading'|'ready'|'error'>('loading'),[error,setError]=useState(''),[page,setPage]=useState(1),[total,setTotal]=useState(0),[from,setFrom]=useState(localDay()),[to,setTo]=useState(localDay(7)),[status,setStatus]=useState('');
 const load=useCallback(async(p=1)=>{setState('loading');const q=new URLSearchParams({page:String(p),pageSize:String(PAGE_SIZE),from:new Date(`${from}T00:00:00`).toISOString(),to:new Date(`${to}T23:59:59.999`).toISOString(),...(status?{status}:{})});const r=await api(`/schedules?${q}`);if(r.status===401)return router.replace('/login');if(!r.ok){setError(friendlyError((await r.json().catch(()=>({}))).error,'Não foi possível carregar a agenda.'));return setState('error');}const b=await r.json();setRows(b.items);setTotal(b.total);setPage(p);setState('ready');},[from,to,status,router]);
 useEffect(()=>{if(hasFullContext)void load(1);},[hasFullContext,load]);
 const columns:DataTableColumn<Schedule>[]=[{key:'when',header:'Horário',render:r=><span className="font-medium text-emerald-50">{formatTime(r.starts_at)}{r.ends_at?` — ${new Date(r.ends_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`:''}</span>},{key:'customer',header:'Cliente',render:r=>r.customer_name},{key:'os',header:'OS',render:r=>r.service_order_number?`#${r.service_order_number}`:'Sem OS'},{key:'responsible',header:'Responsável',render:r=>r.responsible_name??'Não atribuído'},{key:'status',header:'Situação',render:r=><StatusBadge tone={r.status==='scheduled'?'success':'neutral'}>{r.status==='scheduled'?'Agendado':'Cancelado'}</StatusBadge>}];
 return <RequireOperationalContext><div className="flex flex-col gap-6"><PageHeader title="Agenda operacional" description="Atendimentos programados por filial e responsável." action={<Link href="/app/schedules/new" className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950"><PlusCircle className="h-4 w-4"/>Novo agendamento</Link>}><div className="flex flex-wrap gap-3"><label className="text-xs text-emerald-100/70">De<input aria-label="Data inicial" type="date" className="ml-2 rounded-xl border border-emerald-800 bg-emerald-950 p-2 text-sm" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="text-xs text-emerald-100/70">Até<input aria-label="Data final" type="date" className="ml-2 rounded-xl border border-emerald-800 bg-emerald-950 p-2 text-sm" value={to} onChange={e=>setTo(e.target.value)}/></label><select aria-label="Situação" value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 text-sm"><option value="">Todas</option><option value="scheduled">Agendados</option><option value="canceled">Cancelados</option></select></div></PageHeader><DataTable columns={columns} rows={rows} rowKey={r=>r.id} state={state} onRowClick={r=>router.push(`/app/schedules/${r.id}`)} onRetry={()=>load(page)} errorMessage={error} emptyState={<EmptyState icon={CalendarClock} title="Nenhum atendimento no período" description="Ajuste o período ou crie o primeiro agendamento."/>}/><DataTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={load}/></div></RequireOperationalContext>;
}
