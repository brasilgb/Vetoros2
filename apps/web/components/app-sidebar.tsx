'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isNavItemActive, navGroups } from './nav-config';
import { useOperationalContext } from './operational-context';

// Sidebar retrátil (seção 5 do correio.md). No mobile ela vira drawer (translate-x); no
// desktop ela recolhe para somente ícones, com tooltip via CSS (hover E foco, sem JS extra).
// Única superfície escura do produto (seção 3 — "Sidebar / superfícies escuras opcionais:
// #0F172A"): o resto do app é claro, então a sidebar usa seu próprio conjunto de tons (slate
// escuro + acento azul), independente da paleta clara usada no restante dos componentes.
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
  const capabilities = session?.profile.capabilities ?? [];
  const visibleGroups = navGroups.map((group) => ({ ...group, items: group.items.filter((item) => !item.permission || capabilities.includes(item.permission)) })).filter((group) => group.items.length > 0);
  const activeGroup = visibleGroups.find((group) => group.items.some((item) => isNavItemActive(pathname, item.href)))?.label ?? visibleGroups[0]?.label;
  const [expandedGroup, setExpandedGroup] = useState(activeGroup);

  useEffect(() => {
    if (activeGroup) setExpandedGroup(activeGroup);
  }, [activeGroup]);

  return (
    <>
      {mobileOpen && <div data-testid="mobile-backdrop" className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={onCloseMobile} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-800 bg-slate-900 transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'md:w-[72px]' : 'md:w-64'}`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-4">
          <Link href="/app" className="flex items-center gap-2 overflow-hidden font-bold text-white" onClick={onCloseMobile}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-sm text-white">V2</span>
            <span className={collapsed ? 'md:hidden' : ''}>VetorOS</span>
          </Link>
          <button aria-label="Fechar menu" onClick={onCloseMobile} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 md:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        {session && (
          <div className="flex shrink-0 flex-col gap-2 border-b border-slate-800 px-4 py-3 md:hidden">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contexto</p>
            <select
              ref={sidebarCompanySelectRef}
              aria-label="Empresa ativa (menu)"
              value={session.activeCompanyId ?? ''}
              onChange={(event) => void selectContext(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100"
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
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 disabled:opacity-40"
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
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <button
                type="button"
                aria-expanded={expandedGroup === group.label}
                onClick={() => setExpandedGroup((current) => current === group.label ? '' : group.label)}
                className={`flex w-full items-center justify-between px-2.5 pb-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-300 ${collapsed ? 'md:hidden' : ''}`}
              >
                {group.label}
                <ChevronDown className={`h-4 w-4 transition-transform ${expandedGroup === group.label ? '' : '-rotate-90'}`} aria-hidden />
              </button>
              <ul className={`space-y-0.5 ${expandedGroup === group.label ? '' : collapsed ? 'md:block' : 'hidden'}`}>
                {group.items.map((item) => {
                  const active = isNavItemActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href} className="group relative">
                      <Link
                        href={item.href}
                        onClick={onCloseMobile}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 ${
                          active ? 'bg-blue-600/15 font-medium text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                        }`}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                        <span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>{item.label}</span>
                      </Link>
                      {collapsed && (
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 md:group-hover:block md:group-focus-within:block"
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

        <div className="hidden shrink-0 border-t border-slate-800 p-3 md:flex">
          <button
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-pressed={collapsed}
            className="flex w-full items-center justify-center gap-2 rounded-xl p-2 text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
          >
            {collapsed ? <ChevronsRight className="h-[18px] w-[18px]" /> : <ChevronsLeft className="h-[18px] w-[18px]" />}
            {!collapsed && <span className="text-sm">Recolher</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
