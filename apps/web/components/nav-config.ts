import {
  ArrowLeftRight,
  Banknote,
  Building,
  Building2,
  ClipboardList,
  Cpu,
  FileText,
  History,
  LayoutDashboard,
  Package,
  PackageCheck,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Undo2,
  UserCog,
  Users,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = { label: string; href: string; icon: LucideIcon; requiresOperationalContext?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

// Estrutura definida em correio.md (UX-01, seção 6): agrupamentos e nomes já
// familiares ao usuário do VetorOS 1. Somente recursos realmente
// implementados no VetorOS 2 aparecem aqui — "Usuários" (Administração)
// ainda não existe e por isso fica de fora até ser implementado.
//
// `requiresOperationalContext: true` marca os módulos cujos endpoints exigem Empresa E Filial
// selecionadas (a API responde 409 `operational_context_required` sem isso — descoberta do
// UX-01, seção 4 do UX-02). Clientes, Equipamentos, Fornecedores, Empresas, Filiais e Usuários
// toleram tenant sem empresa selecionada (administração é sempre por tenant, não por
// filial/empresa — ADM-01) e por isso ficam de fora dessa marcação.
export const navGroups: NavGroup[] = [
  {
    label: 'Operação',
    items: [
      { label: 'Dashboard', href: '/app', icon: LayoutDashboard },
      { label: 'Ordens de Serviço', href: '/app/service-orders', icon: Wrench, requiresOperationalContext: true },
      { label: 'Orçamentos', href: '/app/quotes', icon: FileText, requiresOperationalContext: true },
    ],
  },
  {
    label: 'Cadastros',
    items: [
      { label: 'Clientes', href: '/app/customers', icon: Users },
      { label: 'Equipamentos', href: '/app/assets', icon: Cpu },
    ],
  },
  {
    label: 'Estoque',
    items: [
      { label: 'Peças / Produtos', href: '/app/inventory/parts', icon: Package, requiresOperationalContext: true },
      { label: 'Movimentações', href: '/app/inventory/movements', icon: ArrowLeftRight, requiresOperationalContext: true },
    ],
  },
  {
    label: 'Compras',
    items: [
      { label: 'Fornecedores', href: '/app/suppliers', icon: Truck },
      { label: 'Pedidos de Compra', href: '/app/purchase-orders', icon: ClipboardList, requiresOperationalContext: true },
      { label: 'Recebimentos', href: '/app/purchase-receipts', icon: PackageCheck, requiresOperationalContext: true },
      { label: 'Devoluções', href: '/app/purchase-returns', icon: Undo2, requiresOperationalContext: true },
    ],
  },
  {
    label: 'Vendas',
    items: [{ label: 'Vendas', href: '/app/sales', icon: ShoppingCart, requiresOperationalContext: true }],
  },
  {
    // FIN-01, seção 15 do correio.md: agrupamento sugerido literalmente ("Financeiro: Caixa,
    // Recebimentos"). O rótulo "Recebimentos" também existe em Compras (recebimento de
    // mercadoria/estoque) — são conceitos diferentes (dinheiro vs. mercadoria) e ficam em grupos
    // com cabeçalho próprio na sidebar, então não há ambiguidade visual real; o rótulo do menu
    // segue a nomenclatura do correio.md em vez de inventar um nome alternativo.
    label: 'Financeiro',
    items: [
      { label: 'Caixa', href: '/app/cash', icon: Banknote, requiresOperationalContext: true },
      { label: 'Recebimentos', href: '/app/payments', icon: Receipt, requiresOperationalContext: true },
    ],
  },
  {
    label: 'Administração',
    items: [
      { label: 'Empresas', href: '/app/companies', icon: Building },
      { label: 'Filiais', href: '/app/branches', icon: Building2 },
      { label: 'Usuários', href: '/app/users', icon: UserCog },
      { label: 'Papéis e Permissões', href: '/app/roles', icon: ShieldCheck },
      { label: 'Auditoria', href: '/app/audit-logs', icon: History },
    ],
  },
];

export const navItems: NavItem[] = navGroups.flatMap((group) => group.items);

/** Um item é ativo se a rota atual for exatamente o href, ou um descendente dele (exceto para "/app", que só é ativo na home exata). */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === '/app') return pathname === '/app';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Resolve o rótulo de navegação conhecido para um segmento de rota, usado para montar breadcrumbs automáticos. */
export function findNavItemByHref(href: string): NavItem | undefined {
  return navItems.find((item) => item.href === href);
}

/** Resolve o item de menu cujo href é o prefixo mais específico da rota atual (usado para breadcrumb e para saber se a página exige Empresa/Filial). */
export function matchNavItem(pathname: string): NavItem | undefined {
  if (pathname === '/app') return navItems.find((item) => item.href === '/app');
  return navItems
    .filter((item) => item.href !== '/app' && (pathname === item.href || pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
