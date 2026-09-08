import Link from 'next/link';

// Hierarquia padronizada de botões (seção 24 do correio.md): primário para salvar, secundário para cancelar/voltar.
export function FormActions({ saving, saveLabel = 'Salvar', savingLabel = 'Salvando…', cancelHref }: { saving: boolean; saveLabel?: string; savingLabel?: string; cancelHref: string }) {
  return (
    <div className="flex items-center justify-end gap-3 sm:col-span-2">
      <Link href={cancelHref} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        Cancelar
      </Link>
      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? savingLabel : saveLabel}
      </button>
    </div>
  );
}
