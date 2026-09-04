export default function Home() {
  return <main className="grid min-h-screen place-items-center p-8"><section className="max-w-xl rounded-3xl border border-emerald-800 bg-emerald-950/40 p-10 shadow-2xl">
    <p className="mb-3 text-sm font-semibold uppercase tracking-[.25em] text-emerald-400">Fundação operacional</p>
    <h1 className="text-5xl font-bold tracking-tight">VetorOS 2</h1>
    <p className="mt-5 text-lg text-emerald-100/70">API, banco multitenant e infraestrutura prontos para evoluir com segurança.</p>
    <div className="mt-8 flex items-center gap-3 text-sm"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden="true"/><span>Status da aplicação: operacional</span></div>
  </section></main>;
}
