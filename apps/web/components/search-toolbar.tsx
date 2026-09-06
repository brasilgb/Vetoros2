'use client';
import { Search, X } from 'lucide-react';
import type { ReactNode } from 'react';

// Posição padronizada de busca/filtros (seção 15 do correio.md).
export function SearchToolbar({
  value,
  onChange,
  placeholder = 'Buscar…',
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative grow sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-100/40" aria-hidden />
        <input
          type="search"
          aria-label={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-emerald-800 bg-emerald-950 py-2.5 pl-9 pr-9 text-sm text-emerald-50 placeholder:text-emerald-100/40 focus-visible:outline-2 focus-visible:outline-emerald-500"
        />
        {value && (
          <button
            type="button"
            aria-label="Limpar busca"
            onClick={() => onChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-emerald-100/40 hover:text-emerald-100"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
