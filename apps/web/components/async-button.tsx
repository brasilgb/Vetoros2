'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './button';

type Tone = 'primary' | 'secondary' | 'destructive';

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
    <Button onClick={() => void handleClick()} disabled={busy || disabled} variant={tone === 'destructive' ? 'danger' : tone} className={className}>
      {busy ? (busyLabel ?? label) : label}
    </Button>
  );
}
