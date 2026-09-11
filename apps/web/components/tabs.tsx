'use client';

import type { ReactNode } from 'react';

export function Tabs({ children, label = 'Navegação interna' }: { children: ReactNode; label?: string }) {
  return <div role="tablist" aria-label={label} className="flex max-w-full gap-1 overflow-x-auto border-b border-slate-200 pb-px">{children}</div>;
}

export function Tab({ value, active, onSelect, children, disabled }: { value: string; active: boolean; onSelect: (value: string) => void; children: ReactNode; disabled?: boolean }) {
  return <button type="button" role="tab" id={`tab-${value}`} aria-selected={active} aria-controls={`panel-${value}`} tabIndex={active ? 0 : -1} disabled={disabled} onClick={() => onSelect(value)} className={`relative shrink-0 whitespace-nowrap rounded-t-lg px-3.5 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'text-blue-700 after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-blue-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>{children}</button>;
}
