export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// UX-02 (correio.md, seção 8): descoberto durante a validação visual ponta a ponta que toda
// ação sem corpo (aprovar/cancelar/confirmar pedidos, recebimentos, devoluções, vendas,
// converter orçamento) vinha falhando com 400 "Body cannot be empty when content-type is set
// to 'application/json'" — o wrapper sempre mandava esse header, mesmo sem `body`, e o Fastify
// rejeita JSON vazio com esse content-type. Isso não é regra de negócio nem contrato de API;
// é o cliente HTTP mandando um header que não corresponde ao que está enviando. Só define
// content-type quando existe corpo de fato.
export async function api(path: string, init?: RequestInit) {
  return fetch(`${apiUrl}${path}`, { ...init, credentials: 'include', headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } });
}
