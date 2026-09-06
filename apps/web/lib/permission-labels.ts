// Rótulos em pt-BR para módulo/ação de uma permission (seção 5 do correio.md ADM-01, seção 7 do
// ADM-02) — o administrador nunca vê o código técnico (`service_orders.update`) nem nomes de
// módulo em inglês. Compartilhado entre a tela de usuário (permissões efetivas, somente leitura)
// e as telas de papel (matriz editável) para não duplicar a mesma tradução em três lugares.
export const moduleLabels: Record<string, string> = {
  auth: 'Sessão', operational: 'Contexto operacional', companies: 'Empresas', branches: 'Filiais', users: 'Usuários',
  customers: 'Clientes', customer_assets: 'Equipamentos', service_orders: 'Ordens de Serviço', quotes: 'Orçamentos',
  inventory: 'Estoque', suppliers: 'Fornecedores', purchase_orders: 'Pedidos de Compra', purchase_receipts: 'Recebimentos',
  purchase_returns: 'Devoluções', sales: 'Vendas', audit: 'Auditoria',
  // FIN-01: `cash.*`/`payments.*` (migration 0022) — dois módulos distintos porque são dois
  // conjuntos de responsabilidade diferentes (gerir caixas/sessões vs. registrar/estornar
  // recebimentos), mesma granularidade de purchase_orders/purchase_receipts.
  cash: 'Caixa', payments: 'Recebimentos (financeiro)',
};

export const actionLabels: Record<string, string> = {
  read: 'Visualizar', create: 'Criar', update: 'Alterar', approve: 'Aprovar', confirm: 'Confirmar', move: 'Movimentar',
  select: 'Selecionar', manage_roles: 'Gerenciar papéis', manage: 'Gerenciar', open: 'Abrir', close: 'Fechar', refund: 'Estornar',
};

export function permissionLabel(code: string): string {
  const action = code.split('.').at(-1) ?? code;
  return actionLabels[action] ?? action;
}

export type PermissionRef = { id?: string; code: string; module: string; description: string | null };

/** Agrupa uma lista de permissions por módulo, com rótulo em pt-BR, ordenado alfabeticamente
 * pelo rótulo (não pela chave técnica do módulo). */
export function groupPermissions<T extends PermissionRef>(permissions: T[]): { module: string; label: string; items: T[] }[] {
  const byModule = new Map<string, T[]>();
  for (const permission of permissions) byModule.set(permission.module, [...(byModule.get(permission.module) ?? []), permission]);
  return [...byModule.entries()].map(([module, items]) => ({ module, label: moduleLabels[module] ?? module, items })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}
