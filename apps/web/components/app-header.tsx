'use client';
import { usePathname } from 'next/navigation';
import { LogOut, Menu, User } from 'lucide-react';
import { Breadcrumbs, type Crumb } from './breadcrumbs';
import { matchNavItem } from './nav-config';
import { useOperationalContext } from './operational-context';
import { useBreadcrumbState } from './breadcrumb-context';
import { Menu as DropdownMenu, MenuItem } from './menu';

// Deriva a trilha de breadcrumbs a partir da rota e do menu (seção 9 do UX-01 / seção 5 do
// UX-02): o segmento final usa o nome do registro quando a própria página já o carregou
// (useSetBreadcrumb) e cai para um rótulo genérico enquanto isso não acontece — nunca dispara
// um fetch só para isto.
function breadcrumbsFor(pathname: string, recordLabel: string | undefined): Crumb[] {
  if (pathname === '/app') return [{ label: 'Dashboard' }];
  const match = matchNavItem(pathname);
  if (!match) return [{ label: 'Dashboard', href: '/app' }];
  const crumbs: Crumb[] = [{ label: 'Dashboard', href: '/app' }, { label: match.label, href: match.href }];
  const rest = pathname.slice(match.href.length).split('/').filter(Boolean);
  if (rest.length === 0) return crumbs;
  const last = rest[rest.length - 1];
  for (let i = 0; i < rest.length - 1; i++) crumbs.push({ label: 'Detalhe' });
  crumbs.push({ label: recordLabel ?? (last === 'new' ? 'Novo' : 'Detalhe') });
  return crumbs;
}

// Cabeçalho discreto (seção 8 do correio.md): breadcrumb + contexto Company/Branch + usuário,
// mantendo o foco visual no conteúdo operacional abaixo. UX-02 seção 4: quando a página atual
// exige Empresa/Filial e o contexto ainda não foi escolhido, os seletores ganham destaque
// visual (anel âmbar) — proativo, em vez de só reagir ao 409 depois do usuário tentar salvar.
export function AppHeader({ onOpenMobileMenu }: { onOpenMobileMenu: () => void }) {
  const pathname = usePathname();
  const recordLabel = useBreadcrumbState(pathname);
  const { session, hasFullContext, selectContext, logout, companySelectRef, branchSelectRef } = useOperationalContext();

  const pageRequiresContext = matchNavItem(pathname)?.requiresOperationalContext ?? false;
  const missingContext = pageRequiresContext && !hasFullContext;
  const branchOptions = session?.profile.branches.filter((branch) => branch.company_id === session.activeCompanyId) ?? [];
  const selectClass = (highlight: boolean) =>
    `hidden max-w-[10rem] truncate rounded-lg border bg-emerald-950 px-2.5 py-1.5 text-xs text-emerald-100 disabled:opacity-40 sm:block ${
      highlight ? 'animate-pulse border-amber-500 ring-2 ring-amber-500/50' : 'border-emerald-800'
    }`;

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-emerald-900 bg-emerald-950/80 px-4 backdrop-blur sm:px-6">
      <button aria-label="Abrir menu" onClick={onOpenMobileMenu} className="rounded-lg p-2 text-emerald-100/70 hover:bg-emerald-900 md:hidden">
        <Menu className="h-5 w-5" />
      </button>

      <Breadcrumbs items={breadcrumbsFor(pathname, recordLabel)} />

      <div className="ml-auto flex items-center gap-2">
        {missingContext && (
          <span className="hidden items-center gap-1 text-xs font-medium text-amber-300 sm:inline-flex" role="status">
            Selecione empresa e filial
          </span>
        )}
        {session && (
          <>
            <select
              ref={companySelectRef}
              aria-label="Empresa ativa (cabeçalho)"
              value={session.activeCompanyId ?? ''}
              onChange={(event) => void selectContext(event.target.value)}
              className={selectClass(missingContext && !session.activeCompanyId)}
            >
              <option value="">Empresa</option>
              {session.profile.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.legal_name}
                </option>
              ))}
            </select>
            <select
              ref={branchSelectRef}
              aria-label="Filial ativa (cabeçalho)"
              value={session.activeBranchId ?? ''}
              disabled={!session.activeCompanyId}
              onChange={(event) => void selectContext(session.activeCompanyId!, event.target.value)}
              className={selectClass(missingContext && Boolean(session.activeCompanyId) && !session.activeBranchId)}
            >
              <option value="">Filial</option>
              {branchOptions.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </>
        )}

        <DropdownMenu trigger={<User className="h-[18px] w-[18px]" />} triggerLabel="Menu do usuário" triggerClassName="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-900 text-emerald-100 hover:bg-emerald-800">
          <MenuItem onSelect={logout} icon={LogOut}>
            Sair
          </MenuItem>
        </DropdownMenu>
      </div>
    </header>
  );
}
