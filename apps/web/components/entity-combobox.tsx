'use client';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Loader2, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useDebouncedValue } from '../lib/use-debounced-value';

// Seleção de entidade por busca (seção 3 do correio.md UX-03): substitui os campos "Cliente
// (ID)"/"Fornecedor (ID)"/"Peça (ID)" que pediam UUID cru. Não é acoplado a nenhum domínio —
// quem chama fornece `search`, `getId`, `getLabel` e `renderOption`; o componente só resolve
// busca com debounce, teclado (setas/Enter/Escape), foco e os estados de loading/erro/vazio.
//
// A posição/clique-fora/Escape do dropdown vêm do Radix Popover (seção 4: "se reproduzir esse
// comportamento manualmente começar a reproduzir um combobox do zero, Radix está autorizado") —
// só o comportamento de digitação/realce por teclado é escrito à mão, porque isso é específico
// de cada instância (a lista de resultados muda a cada tecla).
//
// Combina com <FormField label htmlFor>: este componente não renderiza label/erro/ajuda — quem
// chama já tem esse componente pronto do UX-01 e não deveria ser duplicado aqui.
export function EntityCombobox<T>({
  id,
  placeholder = 'Buscar…',
  disabled,
  allowClear = true,
  hasError,
  value,
  onChange,
  search,
  getId,
  getLabel,
  renderOption,
  emptyMessage = 'Nenhum resultado encontrado.',
}: {
  id: string;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  hasError?: boolean;
  value: T | null;
  onChange: (item: T | null) => void;
  search: (term: string) => Promise<T[]>;
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  renderOption: (item: T) => ReactNode;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [highlighted, setHighlighted] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 300);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  // Guarda contra respostas fora de ordem: focar o campo já dispara uma busca (query vazia) e,
  // se o usuário digitar rápido demais, a busca da query vazia pode responder DEPOIS da busca
  // já filtrada (a rede não garante a ordem de chegada na ordem de saída). O `cancelled` de um
  // cleanup de efeito só protege contra o efeito ter sido re-executado — não contra isso. Um
  // número de sequência aplicado só se ainda for o mais recente resolve os dois casos.
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const requestId = ++requestIdRef.current;
    setStatus('loading');
    search(debouncedQuery)
      .then((items) => {
        if (requestIdRef.current !== requestId) return;
        setResults(items);
        setHighlighted(0);
        setStatus('ready');
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setStatus('error');
      });
  }, [debouncedQuery, open]);

  function selectItem(item: T) {
    onChange(item);
    setQuery('');
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = results[highlighted];
      if (item) selectItem(item);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const displayValue = open ? query : (value ? getLabel(value) : query);
  const highlightedItem = results[highlighted];

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-100/40" aria-hidden />
          <input
            id={id}
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && highlightedItem ? `${listId}-${getId(highlightedItem)}` : undefined}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete="off"
            value={displayValue}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              if (value) onChange(null);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            className={`w-full rounded-xl border bg-emerald-950 py-2.5 pl-9 text-sm text-emerald-50 placeholder:text-emerald-100/40 disabled:opacity-50 ${
              allowClear && value ? 'pr-9' : 'pr-3'
            } ${hasError ? 'border-red-700' : 'border-emerald-800'}`}
          />
          {allowClear && value && !open && (
            <button
              type="button"
              aria-label="Limpar seleção"
              onClick={() => {
                onChange(null);
                setQuery('');
                inputRef.current?.focus();
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-emerald-100/40 hover:text-emerald-100"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width,20rem)] overflow-hidden rounded-xl border border-emerald-800 bg-emerald-950 shadow-xl"
        >
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {status === 'loading' && (
              <li className="flex items-center gap-2 px-3 py-2 text-sm text-emerald-100/50">
                <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
              </li>
            )}
            {status === 'error' && <li className="px-3 py-2 text-sm text-red-300">Não foi possível buscar. Tente novamente.</li>}
            {status === 'ready' && results.length === 0 && <li className="px-3 py-2 text-sm text-emerald-100/50">{emptyMessage}</li>}
            {status === 'ready' &&
              results.map((item, index) => (
                <li key={getId(item)} id={`${listId}-${getId(item)}`} role="option" aria-selected={index === highlighted}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => selectItem(item)}
                    className={`block w-full px-3 py-2 text-left text-sm ${index === highlighted ? 'bg-emerald-900/60 text-emerald-100' : 'text-emerald-100/80'}`}
                  >
                    {renderOption(item)}
                  </button>
                </li>
              ))}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
