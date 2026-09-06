'use client';
import { useEffect, useId, useRef } from 'react';
import type { FormEvent, ReactNode } from 'react';

// Dialog estruturado (seção 3.1 do correio.md UX-02): para operações que exigem quantidade,
// peça, motivo ou poucos outros campos — o substituto de `prompt()`/`confirm()` nos fluxos de
// estoque da OS. Mesma base de <dialog> nativo do ConfirmDialog (Escape/backdrop/foco de
// origem), com um `<form>` no lugar da descrição fixa.
export function FormDialog({
  open,
  title,
  description,
  submitLabel = 'Confirmar',
  busy,
  error,
  onSubmit,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  submitLabel?: string;
  busy?: boolean;
  error?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
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
    }
    if (!open && dialog.open) {
      dialog.close();
      restoreFocusRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!busy) submittedRef.current = false;
  }, [busy]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submittedRef.current) return;
    submittedRef.current = true;
    onSubmit(event);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onCancel();
      }}
      className="rounded-2xl border border-emerald-800 bg-emerald-950 p-0 text-emerald-50 backdrop:bg-black/60"
    >
      <form onSubmit={handleSubmit} className="w-80 sm:w-96">
        <div className="p-5">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-1 text-sm text-emerald-100/70">
              {description}
            </p>
          )}
          <div className="mt-4 flex flex-col gap-4">{children}</div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-300">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-emerald-900 p-4">
          <button type="button" onClick={onCancel} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50">
            {busy ? 'Aguarde…' : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
