'use client';
import { MoreVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { Menu, MenuItem } from './menu';

// Ações secundárias por linha (seção 14 do correio.md UX-01). Reescrito no UX-02 sobre o
// primitivo Radix de `menu.tsx` — ver seção 7 do correio.md UX-02 (fechar após seleção, ao
// clicar fora, com Escape, mantendo navegação por teclado).
export function RowActionsMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div onClick={(event) => event.stopPropagation()}>
      <Menu trigger={<MoreVertical className="h-4 w-4" />} triggerLabel={label} triggerClassName="h-8 w-8 hover:bg-emerald-900/60">
        {children}
      </Menu>
    </div>
  );
}

export function RowActionItem({ onClick, destructive, children }: { onClick: () => void; destructive?: boolean; children: ReactNode }) {
  return (
    <MenuItem onSelect={onClick} destructive={destructive}>
      {children}
    </MenuItem>
  );
}
