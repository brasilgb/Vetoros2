'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';

type Session = {
  activeTenantId: string;
  activeCompanyId: string | null;
  activeBranchId: string | null;
  profile: { companies: Array<{ id: string; legal_name: string }>; branches: Array<{ id: string; company_id: string; name: string }> };
};

type OperationalContextValue = {
  loading: boolean;
  session: Session | undefined;
  hasFullContext: boolean;
  companySelectRef: React.RefObject<HTMLSelectElement | null>;
  branchSelectRef: React.RefObject<HTMLSelectElement | null>;
  sidebarCompanySelectRef: React.RefObject<HTMLSelectElement | null>;
  sidebarBranchSelectRef: React.RefObject<HTMLSelectElement | null>;
  selectContext: (companyId: string, branchId?: string) => Promise<void>;
  logout: () => Promise<void>;
  focusContextSelectors: () => void;
  registerMobileMenuOpener: (opener: () => void) => void;
};

const OperationalContextCtx = createContext<OperationalContextValue | null>(null);

// Fonte única do contexto Empresa/Filial (seção 4 do correio.md UX-02): antes cada página que
// precisava dele (incluindo o próprio AppHeader) fazia seu próprio GET /auth/session. Agora só
// o provider busca, e tanto o header quanto qualquer página migrada leem daqui — o que também
// permite a `focusContextSelectors` "puxar o foco" para os seletores certos em qualquer
// breakpoint (seção 12 do correio.md UX-03: no mobile os seletores vivem no drawer, então focar
// precisa primeiro abrir o drawer — `registerMobileMenuOpener` é como o `AppShell`, que é quem
// controla esse estado, empresta essa ação para cá sem duplicar a lógica de abrir/fechar).
export function OperationalContextProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(true);
  const companySelectRef = useRef<HTMLSelectElement>(null);
  const branchSelectRef = useRef<HTMLSelectElement>(null);
  const sidebarCompanySelectRef = useRef<HTMLSelectElement>(null);
  const sidebarBranchSelectRef = useRef<HTMLSelectElement>(null);
  const mobileMenuOpenerRef = useRef<() => void>(() => {});

  useEffect(() => {
    void api('/auth/session').then(async (response) => {
      if (!response.ok) return router.replace('/login');
      const value: Session = await response.json();
      if (!value.activeTenantId) return router.replace('/select-tenant');
      setSession(value);
      setLoading(false);
    });
  }, [router]);

  const selectContext = useCallback(
    async (companyId: string, branchId?: string) => {
      const response = await api('/auth/operational-context', { method: 'POST', body: JSON.stringify({ companyId, ...(branchId ? { branchId } : {}) }) });
      if (response.status === 401) return router.replace('/login');
      if (!response.ok) return;
      router.refresh();
      setSession((current) => (current ? { ...current, activeCompanyId: companyId, activeBranchId: branchId ?? null } : current));
    },
    [router],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }, [router]);

  const registerMobileMenuOpener = useCallback((opener: () => void) => {
    mobileMenuOpenerRef.current = opener;
  }, []);

  const focusContextSelectors = useCallback(() => {
    const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
    if (isDesktop) {
      const target = !session?.activeCompanyId ? companySelectRef.current : branchSelectRef.current;
      target?.focus();
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    mobileMenuOpenerRef.current();
    // o drawer entra por transição CSS; espera um tique antes de focar/rolar até o seletor,
    // senão scrollIntoView roda com o elemento ainda fora da posição final.
    window.setTimeout(() => {
      const target = !session?.activeCompanyId ? sidebarCompanySelectRef.current : sidebarBranchSelectRef.current;
      target?.focus();
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }, [session?.activeCompanyId]);

  const hasFullContext = Boolean(session?.activeCompanyId && session?.activeBranchId);

  return (
    <OperationalContextCtx.Provider
      value={{ loading, session, hasFullContext, companySelectRef, branchSelectRef, sidebarCompanySelectRef, sidebarBranchSelectRef, selectContext, logout, focusContextSelectors, registerMobileMenuOpener }}
    >
      {children}
    </OperationalContextCtx.Provider>
  );
}

export function useOperationalContext(): OperationalContextValue {
  const value = useContext(OperationalContextCtx);
  if (!value) throw new Error('useOperationalContext must be used within OperationalContextProvider');
  return value;
}
