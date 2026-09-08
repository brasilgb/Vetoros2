import type { ReactNode } from 'react';

// Agrupamento de formulários longos por significado (seção 22 do correio.md; largura/grid
// responsivo — "Adendo obrigatório" do correio.md: em telas largas, campos relacionados podem
// ocupar 2 ou 3 colunas, reduzindo para 1 coluna em telas menores).
export function FormSection({ title, description, children, columns = 2 }: { title: string; description?: string; children: ReactNode; columns?: 1 | 2 | 3 }) {
  const gridClass = columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
  return (
    <fieldset className="w-full rounded-2xl border border-slate-200 bg-white p-5">
      <legend className="px-1 text-sm font-semibold text-slate-900">{title}</legend>
      {description && <p className="-mt-1 mb-3 text-xs text-slate-500">{description}</p>}
      <div className={`grid w-full gap-4 ${gridClass}`}>{children}</div>
    </fieldset>
  );
}

export const formFieldClass =
  'mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-blue-500';

// Campo com label visível + mensagem de erro junto ao campo (seção 21 do UX-01 / seção 14 do
// UX-03: ajuda quando necessária, erro junto ao campo). Placeholder nunca substitui o label.
// `span: 'full'` ocupa a linha inteira independentemente de quantas colunas o FormSection tem
// (campos longos — nome, razão social, descrição, endereço, observações — "Adendo obrigatório").
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
    <div className={span === 'full' ? 'w-full sm:col-span-2 lg:col-span-3' : 'w-full'}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {helperText && !error && <p className="mt-1 text-xs text-slate-500">{helperText}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
