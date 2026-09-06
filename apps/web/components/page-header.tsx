import type { ReactNode } from 'react';

// Padrão de cabeçalho de página (seção 10 do correio.md): título, descrição opcional e ação primária.
export function PageHeader({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-emerald-50">{title}</h1>
          {description && <p className="mt-1 text-sm text-emerald-100/60">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </header>
  );
}
