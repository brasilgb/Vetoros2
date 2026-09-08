export default function Home() {
  return <main className="grid min-h-screen place-items-center bg-slate-50 p-8"><section className="max-w-xl rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">
    <p className="mb-3 text-sm font-semibold uppercase tracking-[.25em] text-blue-600">Fundação operacional</p>
    <h1 className="text-5xl font-bold tracking-tight text-slate-900">VetorOS 2</h1>
    <p className="mt-5 text-lg text-slate-500">API, banco multitenant e infraestrutura prontos para evoluir com segurança.</p>
    <div className="mt-8 flex items-center gap-3 text-sm text-slate-700"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true"/><span>Status da aplicação: operacional</span></div>
  </section></main>;
}
