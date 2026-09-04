'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter(); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(''); const data = new FormData(event.currentTarget);
    const response = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password') }) });
    setLoading(false);
    if (!response.ok) { setError(response.status === 401 ? 'E-mail ou senha inválidos.' : 'Não foi possível entrar.'); return; }
    const result = await response.json() as { tenantSelectionRequired: boolean; hasAvailableTenant: boolean };
    if (!result.hasAvailableTenant) { setError('Sua identidade não possui tenant disponível.'); return; }
    router.push(result.tenantSelectionRequired ? '/select-tenant' : '/app'); router.refresh();
  }
  return <main className="grid min-h-screen place-items-center p-6"><form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-3xl border border-emerald-800 bg-emerald-950/40 p-8">
    <div><p className="text-sm uppercase tracking-[.2em] text-emerald-400">VetorOS 2</p><h1 className="mt-2 text-3xl font-bold">Entrar</h1></div>
    <label className="block">E-mail<input name="email" type="email" autoComplete="username" required className="mt-2 w-full rounded-xl bg-emerald-950 p-3 ring-1 ring-emerald-700"/></label>
    <label className="block">Senha<input name="password" type="password" autoComplete="current-password" required className="mt-2 w-full rounded-xl bg-emerald-950 p-3 ring-1 ring-emerald-700"/></label>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    <button disabled={loading} className="w-full rounded-xl bg-emerald-400 p-3 font-semibold text-emerald-950 disabled:opacity-50">{loading ? 'Entrando…' : 'Entrar'}</button>
  </form></main>;
}
