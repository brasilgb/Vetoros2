import { api } from './api';

// Funções de busca para o EntityCombobox (seção 3 do correio.md UX-03): cada uma só chama um
// endpoint de listagem que já existe (nenhum endpoint novo foi necessário — seção 1/17) e
// devolve um recorte pequeno (pageSize baixo), pensado para caber num dropdown, não numa tela
// inteira. O componente não conhece nenhuma dessas rotas — só recebe a função.

export type CustomerOption = { id: string; legal_name: string; trade_name: string | null; document_normalized: string | null; mobile: string | null; email: string | null };
export async function searchCustomers(term: string): Promise<CustomerOption[]> {
  const response = await api(`/customers?page=1&pageSize=8&search=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error('search_failed');
  return (await response.json()).items;
}

export type SupplierOption = { id: string; legal_name: string; trade_name: string | null; document_normalized: string | null };
export async function searchSuppliers(term: string): Promise<SupplierOption[]> {
  const response = await api(`/suppliers?pageSize=8&search=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error('search_failed');
  return (await response.json()).items;
}

export type PartOption = { id: string; sku: string; description: string; unit: string; balance?: string };
export async function searchParts(term: string): Promise<PartOption[]> {
  const response = await api(`/inventory/parts?page=1&pageSize=8&status=active&search=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error('search_failed');
  return (await response.json()).items;
}

export type AssetOption = { id: string; internal_identifier: string; category: string; brand: string | null; model: string | null };
/** Só lista equipamentos do cliente informado (seção 6: nunca oferecer equipamento de outro cliente). */
export function searchAssetsForCustomer(customerId: string) {
  return async (term: string): Promise<AssetOption[]> => {
    const response = await api(`/assets?page=1&pageSize=8&customerId=${customerId}&search=${encodeURIComponent(term)}`);
    if (!response.ok) throw new Error('search_failed');
    return (await response.json()).items;
  };
}

// FIN-01: origem de um recebimento (seção 6 do correio.md) — usadas pelo diálogo "Novo
// recebimento" quando o operador escolhe vincular a uma venda confirmada ou a uma OS em
// andamento, em vez de digitar um UUID.
export type SaleOption = { id: string; sale_number: number; customer_name: string | null; status: string };
export async function searchConfirmedSales(term: string): Promise<SaleOption[]> {
  const response = await api(`/sales?page=1&pageSize=8&status=confirmed&search=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error('search_failed');
  return (await response.json()).items;
}

export type ServiceOrderOption = { id: string; order_number: number; customer_name: string | null; status: string };
export async function searchOpenServiceOrders(term: string): Promise<ServiceOrderOption[]> {
  const response = await api(`/service-orders?page=1&pageSize=8&search=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error('search_failed');
  const items: ServiceOrderOption[] = (await response.json()).items;
  // a API não filtra por status<>'canceled' diretamente (não há esse operador no filtro de
  // listagem) — `receive_payment` já rejeita OS canceladas no banco (seção 6/9), este filtro é só
  // para não oferecer uma opção que o backend vai recusar de qualquer forma.
  return items.filter((item) => item.status !== 'canceled');
}

// FIN-03: origem de uma conta a pagar (seção 2.2/4 do correio.md) — pedido de compra APROVADO é
// a única origem reconhecida como financeiramente exigível (`create_payable` recusa qualquer
// outro status). `total` já vem do próprio pedido (COM-01) para o resumo "a financiar" na tela.
export type PurchaseOrderOption = { id: string; purchase_order_number: number; supplier_name: string | null; status: string; total: string };
export async function searchApprovedPurchaseOrders(term: string): Promise<PurchaseOrderOption[]> {
  const response = await api(`/purchase-orders?page=1&pageSize=8&status=approved&search=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error('search_failed');
  return (await response.json()).items;
}

// FIN-02: recebimentos da MESMA origem de um título — usada pelo diálogo "Alocar pagamento" (a
// tela de Contas a Receber nunca deve oferecer um pagamento de outra venda/OS: o próprio backend
// já recusaria, seção 8, mas oferecer a opção seria confuso). Só um dos dois ids é informado.
export type PaymentOption = { id: string; amount: string; payment_method_name: string; created_at: string; refunded: boolean };
export function searchPaymentsForOrigin(origin: { saleId?: string; serviceOrderId?: string }) {
  return async (term: string): Promise<PaymentOption[]> => {
    const query = new URLSearchParams({ page: '1', pageSize: '50', ...(origin.saleId ? { saleId: origin.saleId } : {}), ...(origin.serviceOrderId ? { serviceOrderId: origin.serviceOrderId } : {}) });
    const response = await api(`/payments?${query}`);
    if (!response.ok) throw new Error('search_failed');
    const items: PaymentOption[] = (await response.json()).items;
    const active = items.filter((item) => !item.refunded);
    // A origem já é pequena o bastante (recebimentos de UMA venda/OS) para filtrar no cliente em
    // vez de precisar de um parâmetro de busca textual dedicado no backend — digitar filtra por
    // forma de pagamento ou pelo valor exibido.
    const normalized = term.trim().toLowerCase();
    return normalized ? active.filter((item) => item.payment_method_name.toLowerCase().includes(normalized) || item.amount.includes(normalized)) : active;
  };
}
