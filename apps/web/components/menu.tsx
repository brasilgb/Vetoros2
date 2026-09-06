'use client';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// Primitivo de menu suspenso (seção 7 do correio.md UX-02): fecha ao selecionar uma opção, ao
// clicar fora e com Escape, mantendo navegação por teclado (setas/Home/End) — tudo herdado do
// Radix. UX-01 tinha isso como `<details>`, que não fechava sozinho após a seleção nem tinha
// navegação por teclado real; reproduzir esse comportamento à mão exigiria overlay + listener de
// clique fora + trap de foco, o que a seção 7 do correio.md autoriza resolver com Radix pontual.
// Base tanto do `RowActionsMenu` quanto do menu do usuário no header.
export function Menu({
  trigger,
  triggerLabel,
  triggerClassName,
  align = 'end',
  children,
}: {
  trigger: ReactNode;
  triggerLabel: string;
  triggerClassName?: string;
  align?: 'start' | 'end';
  children: ReactNode;
}) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          aria-label={triggerLabel}
          className={`inline-flex cursor-pointer items-center justify-center rounded-lg text-emerald-100/60 outline-none hover:text-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-500 data-[state=open]:bg-emerald-900/60 data-[state=open]:text-emerald-100 ${triggerClassName ?? ''}`}
        >
          {trigger}
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align={align}
          sideOffset={6}
          className="z-50 w-48 overflow-hidden rounded-xl border border-emerald-800 bg-emerald-950 py-1 shadow-xl outline-none"
        >
          {children}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

export function MenuItem({ onSelect, icon: Icon, destructive, children }: { onSelect: () => void; icon?: LucideIcon; destructive?: boolean | undefined; children: ReactNode }) {
  return (
    <DropdownMenuPrimitive.Item
      onSelect={onSelect}
      className={`flex cursor-pointer items-center gap-2 px-3.5 py-2 text-sm outline-none data-[highlighted]:bg-emerald-900/60 ${
        destructive ? 'text-red-300 data-[highlighted]:text-red-200' : 'text-emerald-100'
      }`}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </DropdownMenuPrimitive.Item>
  );
}
