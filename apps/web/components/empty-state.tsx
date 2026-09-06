import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// Estados vazios orientativos (seção 16 do correio.md): nunca só "Nenhum registro encontrado.".
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-emerald-900 px-6 py-14 text-center">
      <Icon className="h-9 w-9 text-emerald-100/30" aria-hidden />
      <p className="text-base font-medium text-emerald-100">{title}</p>
      {description && <p className="max-w-sm text-sm text-emerald-100/60">{description}</p>}
      {action}
    </div>
  );
}
