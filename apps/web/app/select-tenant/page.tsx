'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';

type Tenant = { tenantId: string; name: string };
export default function SelectTenantPage() {
  const router = useRouter(); const [tenants, setTenants] = useState<Tenant[]>([]); const [error, setError] = useState('');
  useEffect(() => { void api('/auth/tenants').then(async (response) => { if (response.status === 401) return router.replace('/login'); if (!response.ok) return setError('Não foi possível carregar seus tenants.'); setTenants((await response.json() as { tenants: Tenant[] }).tenants); }); }, [router]);
  async function select(tenantId: string) { const response = await api('/auth/select-tenant', { method: 'POST', body: JSON.stringify({ tenantId }) }); if (response.status === 401) return router.replace('/login'); if (!response.ok) return setError('Tenant indisponível.'); router.push('/app'); router.refresh(); }
  return <main className="grid min-h-screen place-items-center p-6"><section className="w-full max-w-lg rounded-3xl border border-emerald-800 bg-emerald-950/40 p-8"><h1 className="text-3xl font-bold">Selecione o tenant</h1><div className="mt-6 grid gap-3">{tenants.map((tenant) => <button key={tenant.tenantId} onClick={() => select(tenant.tenantId)} className="rounded-xl border border-emerald-700 p-4 text-left hover:bg-emerald-900">{tenant.name}</button>)}</div>{error && <p role="alert" className="mt-4 text-rose-300">{error}</p>}</section></main>;
}
