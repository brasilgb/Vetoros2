import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export type Crumb = { label: string; href?: string };

// Padrão de breadcrumbs da seção 9 do correio.md: enxuto, sem "Home / Aplicação / ...".
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Trilha de navegação" className="flex min-w-0 items-center gap-1 text-sm text-emerald-100/60">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-emerald-100/30" aria-hidden />}
            {item.href && !isLast ? (
              <Link href={item.href} className="truncate rounded focus-visible:outline-2 focus-visible:outline-emerald-500 hover:text-emerald-100">
                {item.label}
              </Link>
            ) : (
              <span className={`truncate ${isLast ? 'font-medium text-emerald-100' : ''}`} aria-current={isLast ? 'page' : undefined}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
