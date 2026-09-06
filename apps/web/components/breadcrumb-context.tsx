'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { usePathname } from 'next/navigation';

type BreadcrumbState = { path: string; label: string } | null;
const BreadcrumbCtx = createContext<{ state: BreadcrumbState; setState: Dispatch<SetStateAction<BreadcrumbState>> } | null>(null);

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BreadcrumbState>(null);
  return <BreadcrumbCtx.Provider value={{ state, setState }}>{children}</BreadcrumbCtx.Provider>;
}

/** Lê o rótulo do registro atual definido por `useSetBreadcrumb`, só quando ele foi definido para a rota atual (evita vazar o rótulo de uma página para outra durante a navegação). */
export function useBreadcrumbState(pathname: string): string | undefined {
  const ctx = useContext(BreadcrumbCtx);
  return ctx?.state?.path === pathname ? ctx.state.label : undefined;
}

// Seção 5 do correio.md UX-02: o breadcrumb deve poder mostrar o nome do registro (ex. "OS
// 000123", "João da Silva") sem um novo fetch — a própria página, que já carregou o registro,
// chama este hook assim que tiver o nome disponível. `undefined`/`''` limpa (mantém o fallback
// genérico do header enquanto a página ainda está carregando).
export function useSetBreadcrumb(label: string | undefined): void {
  const ctx = useContext(BreadcrumbCtx);
  const pathname = usePathname();
  useEffect(() => {
    if (!ctx) return;
    if (label) ctx.setState({ path: pathname, label });
    return () => {
      // só limpa se ninguém mais assumiu o crumb desta rota entretanto (evita apagar o de uma navegação mais nova)
      ctx.setState((current) => (current?.path === pathname ? null : current) as BreadcrumbState);
    };
  }, [label, pathname]);
}
