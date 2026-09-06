import type { ReactNode } from 'react';

// Agrupamento de formulários longos por significado (seção 22 do correio.md).
export function FormSection({ title, description, children, columns = 2 }: { title: string; description?: string; children: ReactNode; columns?: 1 | 2 }) {
  return (
    <fieldset className="rounded-2xl border border-emerald-900 p-5">
      <legend className="px-1 text-sm font-semibold text-emerald-100">{title}</legend>
      {description && <p className="-mt-1 mb-3 text-xs text-emerald-100/50">{description}</p>}
      <div className={`grid gap-4 ${columns === 2 ? 'sm:grid-cols-2' : ''}`}>{children}</div>
    </fieldset>
  );
}

export const formFieldClass =
  'mt-1 w-full rounded-xl border border-emerald-800 bg-emerald-950 p-3 text-sm text-emerald-50 placeholder:text-emerald-100/40 focus-visible:outline-2 focus-visible:outline-emerald-500';

// Campo com label visível + mensagem de erro junto ao campo (seção 21 do UX-01 / seção 14 do
// UX-03: ajuda quando necessária, erro junto ao campo). Placeholder nunca substitui o label.
export function FormField({
  label,
  htmlFor,
  helperText,
  error,
  span,
  children,
}: {
  label: string;
  htmlFor: string;
  helperText?: string | undefined;
  error?: string | undefined;
  span?: 'full';
  children: ReactNode;
}) {
  return (
    <div className={span === 'full' ? 'sm:col-span-2' : undefined}>
      <label htmlFor={htmlFor} className="text-sm text-emerald-100/80">
        {label}
      </label>
      {children}
      {helperText && !error && <p className="mt-1 text-xs text-emerald-100/50">{helperText}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
