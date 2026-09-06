// ADM-03 — tradução central e reutilizável de ação/módulo (seção 8/9 do correio.md): o backend
// devolve `action`/`resourceType` técnicos (`customer.updated`, `customer`) e é só aqui que viram
// "Cliente alterado"/"Clientes" — o código técnico nunca é a experiência principal. "Módulo" não
// existe no banco: é só este agrupamento de `resourceType` para exibição e para montar o filtro
// (`GET /audit-events?resourceType=a,b,c`) — ver `apps/api/src/audit/routes.ts`.

export type ModuleKey =
  | 'customers' | 'assets' | 'service_orders' | 'quotes' | 'inventory' | 'purchases' | 'sales' | 'finance'
  | 'users' | 'roles' | 'companies' | 'branches' | 'session' | 'other';

// A lista de exemplo do correio.md (seção 9) não menciona Empresas/Filiais/Sessão — adicionados
// aqui porque `company`/`branch`/`auth_session` são `resourceType`s reais e identificáveis com
// confiança (não uma inferência frágil); qualquer `resourceType` fora deste mapa cai em "Outros"
// em vez de inventar um agrupamento (seção 9: "não inventar agrupamento quando o evento não
// permitir identificação confiável").
export const moduleGroups: Record<ModuleKey, { label: string; resourceTypes: string[] }> = {
  customers: { label: 'Clientes', resourceTypes: ['customer'] },
  assets: { label: 'Equipamentos', resourceTypes: ['customer_asset'] },
  service_orders: { label: 'Ordens de Serviço', resourceTypes: ['service_order'] },
  quotes: { label: 'Orçamentos', resourceTypes: ['quote'] },
  inventory: { label: 'Estoque', resourceTypes: ['inventory_part', 'stock_movement'] },
  purchases: { label: 'Compras', resourceTypes: ['supplier', 'purchase_order', 'purchase_receipt', 'purchase_return'] },
  sales: { label: 'Vendas', resourceTypes: ['sale'] },
  // FIN-01: `cash_register`/`cash_session`/`payment` são os `resourceType`s reais emitidos por
  // `auditResource` em apps/api/src/cash/routes.ts.
  finance: { label: 'Financeiro', resourceTypes: ['cash_register', 'cash_session', 'payment'] },
  users: { label: 'Usuários', resourceTypes: ['tenant_user_profile'] },
  roles: { label: 'Papéis e Permissões', resourceTypes: ['tenant_role'] },
  companies: { label: 'Empresas', resourceTypes: ['company'] },
  branches: { label: 'Filiais', resourceTypes: ['branch'] },
  session: { label: 'Sessão', resourceTypes: ['auth_session'] },
  other: { label: 'Outros', resourceTypes: [] },
};

const resourceTypeToModule = new Map<string, ModuleKey>();
for (const [key, group] of Object.entries(moduleGroups) as [ModuleKey, (typeof moduleGroups)[ModuleKey]][]) {
  for (const resourceType of group.resourceTypes) resourceTypeToModule.set(resourceType, key);
}

export function moduleLabelForResourceType(resourceType: string): string {
  const key = resourceTypeToModule.get(resourceType);
  return key ? moduleGroups[key].label : moduleGroups.other.label;
}

// Rótulo amigável por código de ação. Cobre exatamente as ações que os módulos existentes
// produzem hoje (levantadas na Descoberta) — não inventa ações que não existem. Um código não
// mapeado cai num fallback legível (capitaliza/espaça o código) em vez de quebrar a tela.
const actionLabels: Record<string, string> = {
  'customer.created': 'Cliente criado', 'customer.updated': 'Cliente alterado', 'customer.status_changed': 'Status do cliente alterado',
  'customer.contact.created': 'Contato do cliente adicionado', 'customer.address.created': 'Endereço do cliente adicionado',
  'customer_asset.created': 'Equipamento criado', 'customer_asset.updated': 'Equipamento alterado', 'customer_asset.identifier.created': 'Identificador do equipamento adicionado',
  'service_order.created': 'Ordem de serviço criada', 'service_order.updated': 'Ordem de serviço alterada',
  'service_order_item.created': 'Item da ordem de serviço adicionado', 'service_order_item.updated': 'Item da ordem de serviço alterado', 'service_order_item.deleted': 'Item da ordem de serviço removido',
  'service_order_stock.reserve': 'Peça reservada na ordem de serviço', 'service_order_stock.release': 'Reserva de peça liberada',
  'service_order_stock.consume': 'Peça consumida na ordem de serviço', 'service_order_stock.return': 'Peça devolvida da ordem de serviço',
  'quote.created': 'Orçamento criado', 'quote.updated': 'Orçamento alterado', 'quote.converted': 'Orçamento convertido',
  'quote_item.created': 'Item do orçamento adicionado', 'quote_item.updated': 'Item do orçamento alterado', 'quote_item.deleted': 'Item do orçamento removido',
  'inventory_part.created': 'Peça cadastrada', 'inventory_part.updated': 'Peça alterada', 'stock_movement.created': 'Movimentação de estoque registrada',
  'supplier.created': 'Fornecedor criado', 'supplier.updated': 'Fornecedor alterado',
  'supplier.contact.created': 'Contato do fornecedor adicionado', 'supplier.contact.updated': 'Contato do fornecedor alterado',
  'supplier.address.created': 'Endereço do fornecedor adicionado', 'supplier.address.updated': 'Endereço do fornecedor alterado',
  'purchase_order.created': 'Pedido de compra criado', 'purchase_order.updated': 'Pedido de compra alterado',
  'purchase_order.approved': 'Pedido de compra aprovado', 'purchase_order.cancelled': 'Pedido de compra cancelado',
  'purchase_order_item.created': 'Item do pedido de compra adicionado', 'purchase_order_item.updated': 'Item do pedido de compra alterado', 'purchase_order_item.deleted': 'Item do pedido de compra removido',
  'purchase_receipt.created': 'Recebimento criado', 'purchase_receipt.updated': 'Recebimento alterado',
  'purchase_receipt.confirmed': 'Recebimento confirmado', 'purchase_receipt.cancelled': 'Recebimento cancelado',
  'purchase_receipt_item.created': 'Item do recebimento adicionado', 'purchase_receipt_item.updated': 'Item do recebimento alterado', 'purchase_receipt_item.deleted': 'Item do recebimento removido',
  'purchase_return.created': 'Devolução criada', 'purchase_return.updated': 'Devolução alterada',
  'purchase_return.confirmed': 'Devolução confirmada', 'purchase_return.cancelled': 'Devolução cancelada',
  'purchase_return_item.created': 'Item da devolução adicionado', 'purchase_return_item.updated': 'Item da devolução alterado', 'purchase_return_item.deleted': 'Item da devolução removido',
  'sale.created': 'Venda criada', 'sale.updated': 'Venda alterada', 'sale.confirmed': 'Venda confirmada', 'sale.cancelled': 'Venda cancelada',
  'sale_item.created': 'Item da venda adicionado', 'sale_item.updated': 'Item da venda alterado', 'sale_item.deleted': 'Item da venda removido',
  'cash_register.created': 'Caixa criado', 'cash_register.updated': 'Caixa alterado',
  'cash_session.opened': 'Caixa aberto', 'cash_session.closed': 'Caixa fechado',
  'payment.created': 'Recebimento registrado', 'payment.refunded': 'Recebimento estornado',
  'company.created': 'Empresa criada', 'company.updated': 'Empresa alterada',
  'branch.created': 'Filial criada', 'branch.updated': 'Filial alterada',
  'user.created': 'Usuário criado', 'user.role_changed': 'Papel do usuário alterado', 'user.profile_updated': 'Dados do usuário alterados',
  'role.created': 'Papel criado', 'role.updated': 'Papel alterado', 'role.permissions_changed': 'Permissões do papel alteradas', 'role.deleted': 'Papel excluído',
  'auth.login_succeeded': 'Login realizado', 'auth.logout': 'Logout realizado',
  'auth.tenant_selected': 'Tenant selecionado', 'auth.tenant_switched': 'Tenant alterado', 'auth.operational_context_selected': 'Empresa/Filial selecionadas',
};

/** `user.status_changed` é uma única action para "ativado" e "inativado" — o metadata (`status`)
 * é o que distingue as duas; as demais ações não precisam do metadata para um rótulo correto. */
export function actionLabel(action: string, metadata?: Record<string, unknown> | null): string {
  if (action === 'user.status_changed') return metadata?.status === 'inactive' ? 'Usuário inativado' : 'Usuário ativado';
  return actionLabels[action] ?? action.replaceAll(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export const knownActions = Object.keys(actionLabels);

// Rótulos pt-BR para as chaves de `metadata` mais comuns — usados só para o nome do campo; o
// VALOR nunca é inventado (seção 11 do correio.md: "não fabricar valor anterior que não esteja
// registrado"). Uma chave sem tradução aqui cai num fallback que separa camelCase em palavras.
const fieldLabels: Record<string, string> = {
  legalName: 'Razão social', tradeName: 'Nome fantasia', name: 'Nome', status: 'Status', document: 'Documento',
  personType: 'Tipo de pessoa', customerNumber: 'Número do cliente', quantity: 'Quantidade', unitPrice: 'Preço unitário',
  discountAmount: 'Desconto', description: 'Descrição', notes: 'Observações', email: 'E-mail', phone: 'Telefone',
  identityReused: 'Identidade reaproveitada', permissionCount: 'Quantidade de permissões',
};
function fieldLabel(key: string): string {
  return fieldLabels[key] ?? key.replaceAll(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isPermissionCodeArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.includes('.'));
}

export type MetadataView = {
  changedFields?: string[];
  permissionsAdded?: string[];
  permissionsRemoved?: string[];
  fields: { label: string; value: string }[];
};

/** Traduz o `metadata` de um evento para algo exibível — respeita exatamente o que foi
 * registrado (seção 11): "campos alterados" quando é só uma lista de nomes, um diff de
 * permissões quando é `added`/`removed`, e os demais campos como pares rótulo/valor. IDs em
 * formato UUID são omitidos (não são informação útil por si só nesta tela). */
export function friendlyMetadata(metadata: Record<string, unknown> | null | undefined, permissionLabel: (code: string) => string): MetadataView {
  const view: MetadataView = { fields: [] };
  if (!metadata) return view;
  for (const [key, raw] of Object.entries(metadata)) {
    if (key === 'changedFields' && Array.isArray(raw)) { view.changedFields = raw.map((field) => fieldLabel(String(field))); continue; }
    if (key === 'added' && isPermissionCodeArray(raw)) { view.permissionsAdded = raw.map(permissionLabel); continue; }
    if (key === 'removed' && isPermissionCodeArray(raw)) { view.permissionsRemoved = raw.map(permissionLabel); continue; }
    if (key === 'permissions' && isPermissionCodeArray(raw)) { view.fields.push({ label: 'Permissões', value: raw.map(permissionLabel).join(', ') }); continue; }
    if (raw === null || raw === undefined || raw === '') continue;
    if (typeof raw === 'string' && uuidPattern.test(raw)) continue;
    const value = typeof raw === 'boolean' ? (raw ? 'Sim' : 'Não') : Array.isArray(raw) ? raw.map(String).join(', ') : String(raw);
    view.fields.push({ label: fieldLabel(key), value });
  }
  return view;
}
