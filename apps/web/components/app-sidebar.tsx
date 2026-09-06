'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { isNavItemActive, navGroups } from './nav-config';
import { useOperationalContext } from './operational-context';

// Sidebar retrátil (seção 5 do correio.md). No mobile ela vira drawer (translate-x); no
// desktop ela recolhe para somente ícones, com tooltip via CSS (hover E foco, sem JS extra).
export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const { session, selectContext, sidebarCompanySelectRef, sidebarBranchSelectRef } = useOperationalContext();
  const branchOptions = session?.profile.branches.filter((branch) => branch.company_id === session.activeCompanyId) ?? [];

  return (
    <>
      {mobileOpen && <div data-testid="mobile-backdrop" className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={onCloseMobile} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-emerald-900 bg-emerald-950 transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'md:w-[72px]' : 'md:w-64'}`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-emerald-900 px-4">
          <Link href="/app" className="flex items-center gap-2 overflow-hidden font-bold text-emerald-50" onClick={onCloseMobile}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-600 text-sm text-emerald-950">V2</span>
            <span className={collapsed ? 'md:hidden' : ''}>VetorOS</span>
          </Link>
          <button aria-label="Fechar menu" onClick={onCloseMobile} className="rounded-lg p-1.5 text-emerald-100/60 hover:bg-emerald-900 md:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        {session && (
          <div className="flex shrink-0 flex-col gap-2 border-b border-emerald-900 px-4 py-3 md:hidden">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/40">Contexto</p>
            <select
              ref={sidebarCompanySelectRef}
              aria-label="Empresa ativa (menu)"
              value={session.activeCompanyId ?? ''}
              onChange={(event) => void selectContext(event.target.value)}
              className="w-full rounded-lg border border-emerald-800 bg-emerald-950 px-2.5 py-1.5 text-sm text-emerald-100"
            >
              <option value="">Empresa</option>
              {session.profile.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.legal_name}
                </option>
              ))}
            </select>
            <select
              ref={sidebarBranchSelectRef}
              aria-label="Filial ativa (menu)"
              value={session.activeBranchId ?? ''}
              disabled={!session.activeCompanyId}
              onChange={(event) => void selectContext(session.activeCompanyId!, event.target.value)}
              className="w-full rounded-lg border border-emerald-800 bg-emerald-950 px-2.5 py-1.5 text-sm text-emerald-100 disabled:opacity-40"
            >
              <option value="">Filial</option>
              {branchOptions.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav aria-label="Navegação principal" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className={`px-2.5 pb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-100/40 ${collapsed ? 'md:hidden' : ''}`}>
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isNavItemActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href} className="group relative">
                      <Link
                        href={item.href}
                        onClick={onCloseMobile}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-emerald-500 ${
                          active ? 'bg-emerald-600/15 font-medium text-emerald-100' : 'text-emerald-100/70 hover:bg-emerald-900/60 hover:text-emerald-100'
                        }`}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                        <span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>{item.label}</span>
                      </Link>
                      {collapsed && (
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-lg border border-emerald-800 bg-emerald-950 px-2.5 py-1.5 text-xs text-emerald-100 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 md:group-hover:block md:group-focus-within:block"
                        >
                          {item.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="hidden shrink-0 border-t border-emerald-900 p-3 md:flex">
          <button
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-pressed={collapsed}
            className="flex w-full items-center justify-center gap-2 rounded-xl p-2 text-emerald-100/60 hover:bg-emerald-900/60 hover:text-emerald-100"
          >
            {collapsed ? <ChevronsRight className="h-[18px] w-[18px]" /> : <ChevronsLeft className="h-[18px] w-[18px]" />}
            {!collapsed && <span className="text-sm">Recolher</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
