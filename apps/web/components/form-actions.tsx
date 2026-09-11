import Link from 'next/link';
import { Button } from './button';

// Hierarquia padronizada de botões (seção 24 do correio.md): primário para salvar, secundário para cancelar/voltar.
export function FormActions({ saving, saveLabel = 'Salvar', savingLabel = 'Salvando…', cancelHref }: { saving: boolean; saveLabel?: string; savingLabel?: string; cancelHref: string }) {
  return (
    <div className="flex items-center justify-end gap-3 sm:col-span-2">
      <Link href={cancelHref} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
        Cancelar
      </Link>
      <Button
        type="submit"
        disabled={saving}
        variant="primary"
        className="px-5 font-semibold"
      >
        {saving ? savingLabel : saveLabel}
      </Button>
    </div>
  );
}
