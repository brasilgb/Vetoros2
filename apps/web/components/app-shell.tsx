'use client';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AppHeader } from './app-header';
import { AppSidebar } from './app-sidebar';
import { OperationalContextProvider, useOperationalContext } from './operational-context';
import { BreadcrumbProvider } from './breadcrumb-context';

const COLLAPSE_KEY = 'vetoros2:sidebar-collapsed';

// Estrutura geral da aplicação (seção 4 do correio.md): sidebar + header/breadcrumb estáveis,
// conteúdo trocando por baixo. Usado pelo layout de "/app" inteiro, então toda página existente
// já ganha a mesma moldura, migrada ou não.
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // localStorage indisponível (ex.: navegação privada) — mantém expandida.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // ignora falha de persistência; estado ainda funciona na sessão atual.
      }
      return next;
    });
  }

  return (
    <OperationalContextProvider>
      <BreadcrumbProvider>
        <ShellBody collapsed={collapsed} onToggleCollapsed={toggleCollapsed} mobileOpen={mobileOpen} onOpenMobile={() => setMobileOpen(true)} onCloseMobile={() => setMobileOpen(false)}>
          {children}
        </ShellBody>
      </BreadcrumbProvider>
    </OperationalContextProvider>
  );
}

// Precisa estar dentro do OperationalContextProvider para registrar `onOpenMobile` nele (seção
// 12 do correio.md UX-03) — por isso não fica direto dentro de AppShell, que renderiza o
// provider e ficaria por fora dele.
function ShellBody({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onOpenMobile,
  onCloseMobile,
  children,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onOpenMobile: () => void;
  onCloseMobile: () => void;
  children: ReactNode;
}) {
  const { registerMobileMenuOpener } = useOperationalContext();

  useEffect(() => {
    registerMobileMenuOpener(onOpenMobile);
  }, [registerMobileMenuOpener, onOpenMobile]);

  return (
    <div className="min-h-screen md:flex">
      <AppSidebar collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} mobileOpen={mobileOpen} onCloseMobile={onCloseMobile} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader onOpenMobileMenu={onOpenMobile} />
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
