'use client';
import type { ReactNode } from 'react';
import { ErrorState } from './error-state';

export type DataTableColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Prioridade responsiva (seção 6 do correio.md UX-02): colunas sem prioridade são a
   * identificação/status/ação principal e ficam sempre visíveis; 'sm'/'md' escondem a coluna
   * progressivamente em telas menores que esse breakpoint. O scroll horizontal continua
   * existindo como reforço, não como única estratégia. */
  hideBelow?: 'sm' | 'md';
};

const hideBelowClass = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell' } as const;

// Padrão único de tabela administrativa (seção 13 do correio.md): cabeçalho legível, densidade
// adequada, hover discreto, loading/empty/error tratados no mesmo lugar. Filtros e regras
// específicas continuam no módulo (seção 32) — este componente só resolve a moldura.
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  state,
  onRowClick,
  emptyState,
  errorMessage,
  onRetry,
  skeletonRows = 6,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  state: 'loading' | 'ready' | 'error';
  onRowClick?: (row: T) => void;
  emptyState: ReactNode;
  errorMessage?: string;
  onRetry?: () => void;
  skeletonRows?: number;
}) {
  if (state === 'error') return <ErrorState message={errorMessage ?? 'Não foi possível carregar os dados.'} onRetry={onRetry} />;
  if (state === 'ready' && rows.length === 0) return <>{emptyState}</>;

  const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

  return (
    <div className="overflow-x-auto rounded-2xl border border-emerald-900">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-emerald-900 bg-emerald-950/60 text-xs uppercase tracking-wide text-emerald-100/50">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-4 py-3 font-medium ${alignClass[column.align ?? 'left']} ${column.hideBelow ? hideBelowClass[column.hideBelow] : ''} ${column.className ?? ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state === 'loading'
            ? Array.from({ length: skeletonRows }).map((_, index) => (
                <tr key={index} className="border-b border-emerald-900/60 last:border-0">
                  {columns.map((column) => (
                    <td key={column.key} className={`px-4 py-3.5 ${column.hideBelow ? hideBelowClass[column.hideBelow] : ''}`}>
                      <div className="h-4 animate-pulse rounded bg-emerald-900/50" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-emerald-900/60 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-emerald-950/60' : ''}`}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-3.5 text-emerald-100 ${alignClass[column.align ?? 'left']} ${column.hideBelow ? hideBelowClass[column.hideBelow] : ''} ${column.className ?? ''}`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

// Paginação simples e previsível (usada junto ao DataTable nas listagens).
export function DataTablePagination({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  if (total <= pageSize) return null;
  const lastPage = Math.ceil(total / pageSize);
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-3 text-sm text-emerald-100/70">
      <p>
        Página {page} de {lastPage} · {total} registros
      </p>
      <div className="flex gap-2">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-lg border border-emerald-800 px-3 py-1.5 disabled:opacity-40"
        >
          Anterior
        </button>
        <button
          disabled={page >= lastPage}
          onClick={() => onPageChange(page + 1)}
          className="rounded-lg border border-emerald-800 px-3 py-1.5 disabled:opacity-40"
        >
          Próxima
        </button>
      </div>
    </nav>
  );
}
