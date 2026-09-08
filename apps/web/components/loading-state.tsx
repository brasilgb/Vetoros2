import { LoaderCircle } from 'lucide-react';

/** Estado de carregamento compartilhado para páginas que ainda não possuem dados para montar o conteúdo. */
export function LoadingState({ label = 'Carregando…', error = false }: { label?: string; error?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-3 rounded-xl border px-6 py-14 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-500'}`} role={error ? 'alert' : 'status'}>
      {!error && <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />}
      <span>{label}</span>
    </div>
  );
}
