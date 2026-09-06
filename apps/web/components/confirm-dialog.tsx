'use client';
import { useEffect, useId, useRef } from 'react';

// Modal pequeno para confirmação (seção 11 do correio.md UX-01: "confirmação; mudança simples de
// status" são exemplos explícitos de uso apropriado de modal). Usa <dialog> nativo para
// Escape/backdrop de graça. UX-02 seção 7 revisou: foco inicial previsível (Cancelar, para não
// confirmar sem querer com um Enter apressado em ações destrutivas), foco volta para quem abriu
// o diálogo ao fechar, e uma trava local contra clique duplo que não depende do estado do
// componente pai já ter re-renderizado.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  tone = 'default',
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: 'default' | 'destructive';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const submittedRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      cancelRef.current?.focus();
    }
    if (!open && dialog.open) {
      dialog.close();
      restoreFocusRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!busy) submittedRef.current = false;
  }, [busy]);

  function handleConfirm() {
    if (busy || submittedRef.current) return;
    submittedRef.current = true;
    onConfirm();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onCancel();
      }}
      className="rounded-2xl border border-emerald-800 bg-emerald-950 p-0 text-emerald-50 backdrop:bg-black/60"
    >
      <div className="w-80 p-5 sm:w-96">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm text-emerald-100/70">
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button ref={cancelRef} onClick={onCancel} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className={`rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
              tone === 'destructive' ? 'bg-red-600 text-red-50' : 'bg-emerald-600 text-emerald-950'
            }`}
          >
            {busy ? 'Aguarde…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
