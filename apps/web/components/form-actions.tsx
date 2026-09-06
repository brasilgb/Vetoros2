import Link from 'next/link';

// Hierarquia padronizada de botões (seção 24 do correio.md): primário para salvar, secundário para cancelar/voltar.
export function FormActions({ saving, saveLabel = 'Salvar', savingLabel = 'Salvando…', cancelHref }: { saving: boolean; saveLabel?: string; savingLabel?: string; cancelHref: string }) {
  return (
    <div className="flex items-center justify-end gap-3 sm:col-span-2">
      <Link href={cancelHref} className="rounded-xl border border-emerald-800 px-5 py-2.5 text-sm font-medium text-emerald-100 hover:bg-emerald-950">
        Cancelar
      </Link>
      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-emerald-950 disabled:opacity-50"
      >
        {saving ? savingLabel : saveLabel}
      </button>
    </div>
  );
}
