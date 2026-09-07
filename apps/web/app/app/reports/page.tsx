'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader } from '../../../components/page-header';
import { api } from '../../../lib/api';

type Report = { period: { from: string; to: string }; serviceOrders: { total: number; completed: number; canceled: number; amount: string | number; byStatus: Array<{ status: string; total: number }> }; sales: { total: number; canceled: number; amount: string | number }; customers: { total: number; individuals: number; companies: number }; stockMovements: Array<{ type: string; quantity: string | number; movements: number }> };

export default function ReportsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const query = () => new URLSearchParams(Object.fromEntries(Object.entries({ from, to }).filter(([, value]) => value))).toString();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams(Object.fromEntries(Object.entries({ from, to }).filter(([, value]) => value))).toString();
      const response = await api(`/reports/summary${params ? `?${params}` : ''}`);
      if (!response.ok) throw new Error('Não foi possível carregar os relatórios.');
      setReport(await response.json() as Report);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro inesperado.'); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  async function exportCsv() {
    setExporting(true); setError(null);
    try {
      const params = query();
      const response = await api(`/reports/export.csv${params ? `?${params}` : ''}`);
      if (!response.ok) throw new Error('Não foi possível exportar o CSV.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'vetoros-relatorio.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro inesperado.'); }
    finally { setExporting(false); }
  }

  return <div className="flex flex-col gap-6">
    <PageHeader title="Relatórios" description="Indicadores operacionais derivados dos dados canônicos." action={<button type="button" disabled={exporting || loading} onClick={() => void exportCsv()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 disabled:opacity-50"><Download className="h-4 w-4" />{exporting ? 'Exportando…' : 'Exportar CSV'}</button>} />
    <form onSubmit={(event) => { event.preventDefault(); void load(); }} className="flex flex-wrap items-end gap-3 rounded-2xl border border-emerald-900 p-4">
      <label className="text-sm text-emerald-100/70">De<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block rounded-lg border border-emerald-800 bg-emerald-950 px-3 py-2 text-emerald-50" /></label>
      <label className="text-sm text-emerald-100/70">Até (exclusivo)<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 block rounded-lg border border-emerald-800 bg-emerald-950 px-3 py-2 text-emerald-50" /></label>
      <button type="submit" disabled={loading} className="rounded-lg border border-emerald-700 px-4 py-2 text-sm text-emerald-50 disabled:opacity-50">{loading ? 'Carregando…' : 'Aplicar filtros'}</button>
    </form>
    {error && <p className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">{error}</p>}
    {report && <><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['OS', report.serviceOrders.total], ['Concluídas', report.serviceOrders.completed], ['Vendas confirmadas', report.sales.total], ['Clientes novos', report.customers.total]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-emerald-900 p-5"><p className="text-sm text-emerald-100/60">{label}</p><p className="mt-2 text-3xl font-semibold text-emerald-50">{value}</p></div>)}</div><section className="rounded-2xl border border-emerald-900 p-5"><h2 className="font-semibold text-emerald-50">Distribuição de OS por status</h2><div className="mt-4 grid gap-2 sm:grid-cols-2">{report.serviceOrders.byStatus.map((item) => <div key={item.status} className="flex justify-between border-b border-emerald-950 py-2 text-sm"><span>{item.status}</span><strong>{item.total}</strong></div>)}</div></section></>}
  </div>;
}
