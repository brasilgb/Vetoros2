import { LoaderCircle } from 'lucide-react';

/** Estado de carregamento compartilhado para páginas que ainda não possuem dados para montar o conteúdo. */
export function LoadingState({ label = 'Carregando…', error = false }: { label?: string; error?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-3 rounded-2xl border px-6 py-14 text-sm ${error ? 'border-red-900/60 bg-red-950/20 text-red-200' : 'border-emerald-900 text-emerald-100/70'}`} role={error ? 'alert' : 'status'}>
      {!error && <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />}
      <span>{label}</span>
    </div>
  );
}
