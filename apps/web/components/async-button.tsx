'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';

type Tone = 'primary' | 'secondary' | 'destructive';
const toneClass: Record<Tone, string> = {
  primary: 'bg-emerald-600 text-emerald-950 hover:bg-emerald-500',
  secondary: 'border border-emerald-800 text-emerald-100 hover:bg-emerald-950',
  destructive: 'border border-red-800 text-red-300 hover:bg-red-950/40',
};

// Estados de operação padronizados (seção 8 do correio.md UX-02): todo botão de ação
// assíncrona (Salvar, Aprovar, Reservar, Consumir…) troca de rótulo durante o processamento e
// trava contra dupla execução, em vez de cada página reimplementar seu próprio `saving`/`busy`.
// Para ações destrutivas/irreversíveis (cancelar, confirmar, aprovar), o clique deve abrir um
// `ConfirmDialog` — este botão fica para o "Salvar" comum e para o `onConfirm` de dentro do
// diálogo, não para disparar a ação sem confirmação.
export function AsyncButton({
  onClick,
  label,
  busyLabel,
  tone = 'secondary',
  disabled,
  className,
}: {
  onClick: () => Promise<void> | void;
  label: ReactNode;
  busyLabel?: ReactNode;
  tone?: Tone;
  disabled?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      await onClick();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={() => void handleClick()} disabled={busy || disabled} className={`rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${toneClass[tone]} ${className ?? ''}`}>
      {busy ? (busyLabel ?? label) : label}
    </button>
  );
}
