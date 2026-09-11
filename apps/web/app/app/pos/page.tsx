'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import Link from 'next/link';
import { Banknote, Plus, ShoppingCart, Trash2, X } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { FormField, formFieldClass } from '../../../components/form-section';
import { friendlyError } from '../../../components/error-state';
import { EntityCombobox } from '../../../components/entity-combobox';
import { CustomerOptionRow, customerLabel, PartOptionRow, partLabel } from '../../../components/entity-option-rows';
import { searchCustomers, searchParts, type CustomerOption, type PartOption } from '../../../lib/entity-search';
import { formatCurrency } from '../../../lib/format';
import { useSetBreadcrumb } from '../../../components/breadcrumb-context';
import { RequireOperationalContext } from '../../../components/require-operational-context';
import { useOperationalContext } from '../../../components/operational-context';

// PDV-ADV-01: tela especializada de balcão sobre o mesmo domínio de `sales` já usado pelo CRUD
// administrativo (`/app/sales`) — nenhuma entidade nova, nenhuma regra de estoque/financeiro
// reimplementada. Só a UI é diferente: foco em fluxo contínuo (escanear → ajustar → finalizar →
// próxima venda), não em ficha de cadastro.

type Item = { id: string; type: string; inventory_part_id: string | null; part_sku: string | null; description: string; quantity: string; unit_price: string; discount_amount: string; total: string };
type Sale = { id: string; sale_number: number; status: string; customer_id: string | null; items: Item[]; subtotal: string; discount_total: string; total: string };
type PaymentMethod = { id: string; code: string; name: string; status: string };
type Register = { id: string; name: string; current_session_id: string | null };
type PaymentRow = { key: string; paymentMethodId: string; amount: string; tendered: string };
type Receipt = { saleId: string; saleNumber: number; total: number; payments: Array<{ methodName: string; amount: number }> };

const newRow = (): PaymentRow => ({ key: crypto.randomUUID(), paymentMethodId: '', amount: '', tendered: '' });

export default function PosPage() {
  useSetBreadcrumb('PDV');
  const { hasFullContext } = useOperationalContext();
  const [sale, setSale] = useState<Sale | null>(null);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [barcode, setBarcode] = useState('');
  const [barcodeError, setBarcodeError] = useState('');
  const [part, setPart] = useState<PartOption | null>(null);
  const [error, setError] = useState('');
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [registers, setRegisters] = useState<Register[]>([]);
  const [rows, setRows] = useState<PaymentRow[]>([newRow()]);
  const [finalizing, setFinalizing] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const openRegister = registers.find((r) => r.current_session_id);

  const loadLookups = useCallback(async () => {
    const [methodsResponse, registersResponse] = await Promise.all([api('/payment-methods'), api('/cash-registers')]);
    if (methodsResponse.ok) setMethods((await methodsResponse.json()).filter((m: PaymentMethod) => m.status === 'active'));
    if (registersResponse.ok) setRegisters(await registersResponse.json());
  }, []);

  useEffect(() => {
    if (!hasFullContext) return;
    void loadLookups();
  }, [hasFullContext, loadLookups]);

  useEffect(() => {
    if (!receipt) barcodeRef.current?.focus();
  }, [receipt, sale]);

  const reloadSale = useCallback(async (saleId: string) => {
    const response = await api(`/sales/${saleId}`);
    if (response.ok) setSale(await response.json());
  }, []);

  // Cria o rascunho só quando o primeiro item entra (seção 6) — abrir o PDV e não vender nada
  // não deixa rascunho vazio para trás.
  async function ensureSale(): Promise<string | null> {
    if (sale) return sale.id;
    const response = await api('/sales', { method: 'POST', body: JSON.stringify({ customerId: customer?.id ?? null }) });
    if (!response.ok) { setError(friendlyError((await response.json().catch(() => ({}))).error)); return null; }
    const created = await response.json();
    setSale({ ...created, items: [], subtotal: '0.00', discount_total: '0.00', total: '0.00' });
    return created.id as string;
  }

  async function addPart(entry: PartOption, quantity = 1) {
    setError('');
    const saleId = await ensureSale();
    if (!saleId) return;
    const existing = sale?.items.find((i) => i.inventory_part_id === entry.id);
    if (existing) {
      const response = await api(`/sales/${saleId}/items/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ quantity: Number(existing.quantity) + quantity }) });
      if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    } else {
      const response = await api(`/sales/${saleId}/items`, {
        method: 'POST',
        body: JSON.stringify({ type: 'part', inventoryPartId: entry.id, description: entry.description, quantity, unitPrice: Number((entry as PartOption & { reference_price?: string | null }).reference_price ?? 0) }),
      });
      if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    }
    await reloadSale(saleId);
    setPart(null);
  }

  // Seção 7/8: leitura de scanner (comporta-se como teclado + Enter). Não depende de nenhuma
  // integração nativa — só de foco permanente neste campo e de uma busca imediata (sem debounce
  // de digitação humana) contra o mesmo `/inventory/parts?search=` já usado por `searchParts`.
  async function handleBarcodeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || !barcode.trim()) return;
    event.preventDefault();
    setBarcodeError('');
    const term = barcode.trim();
    setBarcode('');
    const response = await api(`/inventory/parts?page=1&pageSize=5&status=active&search=${encodeURIComponent(term)}`);
    if (!response.ok) { setBarcodeError('Não foi possível buscar.'); return; }
    const items: Array<PartOption & { barcode_ean: string | null }> = (await response.json()).items;
    const exact = items.find((i) => i.sku === term || i.barcode_ean === term);
    const match = exact ?? (items.length === 1 ? items[0] : null);
    if (!match) { setBarcodeError(items.length ? 'Mais de um item encontrado — busque manualmente abaixo.' : 'Item não encontrado.'); barcodeRef.current?.focus(); return; }
    await addPart(match);
    barcodeRef.current?.focus();
  }

  async function updateItem(itemId: string, patch: Record<string, unknown>) {
    if (!sale) return;
    const response = await api(`/sales/${sale.id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    await reloadSale(sale.id);
  }
  async function removeItem(itemId: string) {
    if (!sale) return;
    await api(`/sales/${sale.id}/items/${itemId}`, { method: 'DELETE' });
    await reloadSale(sale.id);
  }
  async function changeCustomer(next: CustomerOption | null) {
    setCustomer(next);
    if (sale) await api(`/sales/${sale.id}`, { method: 'PATCH', body: JSON.stringify({ customerId: next?.id ?? null }) });
  }

  async function abandonDraft() {
    if (!sale) return;
    if (sale.items.length) await api(`/sales/${sale.id}/cancel`, { method: 'POST' });
    resetForNextSale();
  }

  function resetForNextSale() {
    setSale(null);
    setCustomer(null);
    setRows([newRow()]);
    setError('');
    setReceipt(null);
  }

  const total = Number(sale?.total ?? 0);
  const paidSoFar = rows.reduce((n, row) => n + (Number(row.amount) || 0), 0);
  const remaining = Math.max(0, Math.round((total - paidSoFar) * 100) / 100);

  function addPaymentRow() { setRows((current) => [...current, newRow()]); }
  function removePaymentRow(key: string) { setRows((current) => current.filter((r) => r.key !== key)); }
  function updateRow(key: string, patch: Partial<PaymentRow>) {
    setRows((current) => current.map((row) => {
      if (row.key !== key) return row;
      const next = { ...row, ...patch };
      const method = methods.find((m) => m.id === next.paymentMethodId);
      // Troco (seção 18): só para dinheiro. `amount` é sempre o que efetivamente quita a venda
      // (nunca o valor entregue) — o troco em si nunca chega a `/sales/:id/checkout`.
      if (method?.code === 'cash' && next.tendered) {
        const tendered = Number(next.tendered) || 0;
        const others = rows.filter((r) => r.key !== key).reduce((n, r) => n + (Number(r.amount) || 0), 0);
        next.amount = String(Math.max(0, Math.min(tendered, Math.round((total - others) * 100) / 100)));
      }
      return next;
    }));
  }

  async function finalize(event: FormEvent) {
    event.preventDefault();
    if (!sale) return;
    setFinalizing(true);
    setError('');
    const payments = rows.filter((r) => r.paymentMethodId && Number(r.amount) > 0).map((r) => ({ paymentMethodId: r.paymentMethodId, amount: Number(r.amount), idempotencyKey: `pos-${sale.id}-${r.key}` }));
    const response = await api(`/sales/${sale.id}/checkout`, { method: 'POST', body: JSON.stringify({ cashSessionId: openRegister?.current_session_id, payments }) });
    setFinalizing(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    const body = await response.json();
    setReceipt({
      saleId: sale.id,
      saleNumber: sale.sale_number,
      total,
      payments: (body.payments as Array<{ amount: string; payment_id: string }>).map((p, index) => ({ methodName: methods.find((m) => m.id === payments[index]?.paymentMethodId)?.name ?? '—', amount: Number(p.amount) })),
    });
  }

  if (!hasFullContext) return <RequireOperationalContext><p className="text-sm text-slate-500">Carregando…</p></RequireOperationalContext>;

  if (receipt) {
    return (
      <RequireOperationalContext>
        <div className="mx-auto flex max-w-md flex-col gap-4">
          <div className="print-hidden"><PageHeader title="Venda finalizada" /></div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
            <p className="text-sm text-emerald-800">Venda concluída</p>
            <p className="text-3xl font-semibold text-emerald-900">{formatCurrency(receipt.total)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Comprovante — Venda {receipt.saleNumber}</h2>
            <ul className="flex flex-col gap-1 text-sm text-slate-700">
              {receipt.payments.map((p, i) => <li key={i} className="flex justify-between"><span>{p.methodName}</span><span>{formatCurrency(p.amount)}</span></li>)}
              <li className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900"><span>Total</span><span>{formatCurrency(receipt.total)}</span></li>
            </ul>
          </div>
          <div className="print-hidden flex gap-3">
            <Link href={`/app/fiscal?origin=sale&saleId=${receipt.saleId}`} className="flex-1 rounded-xl border border-blue-300 px-4 py-2.5 text-center text-sm font-medium text-blue-700 hover:bg-blue-50">Emitir documento fiscal</Link>
            <button onClick={() => window.print()} className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">Imprimir comprovante</button>
            <button onClick={resetForNextSale} className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white">Nova venda</button>
          </div>
        </div>
      </RequireOperationalContext>
    );
  }

  return (
    <RequireOperationalContext>
      <div className="flex flex-col gap-4">
        <PageHeader title="PDV" description="Venda de balcão" action={<Link href="/app/sales?status=draft" className="print-hidden text-sm text-blue-700 hover:underline">Vendas em rascunho</Link>} />

        {!openRegister && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Nenhum caixa aberto nesta filial. Você pode montar a venda, mas só será possível finalizar depois de abrir um caixa.{' '}
            <Link href="/app/cash" className="font-semibold underline">Abrir caixa</Link>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <FormField label="Código de barras / SKU (leitor ou digitação + Enter)" htmlFor="pos-barcode" error={barcodeError}>
                <input id="pos-barcode" ref={barcodeRef} autoFocus className={formFieldClass} value={barcode} onChange={(e) => { setBarcode(e.target.value); setBarcodeError(''); }} onKeyDown={handleBarcodeKeyDown} placeholder="Escaneie ou digite o código e pressione Enter" />
              </FormField>
              <div className="mt-3">
                <FormField label="Buscar por descrição" htmlFor="pos-search">
                  <EntityCombobox id="pos-search" value={part} onChange={(next) => { if (next) void addPart(next); }} search={searchParts} getId={(e) => e.id} getLabel={partLabel} renderOption={(e) => <PartOptionRow item={e} />} placeholder="Buscar peça por SKU ou descrição…" />
                </FormField>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              {!sale || sale.items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-slate-400"><ShoppingCart className="h-8 w-8" /><p className="text-sm">Nenhum item ainda — escaneie ou busque um produto.</p></div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 text-left font-medium">Item</th><th className="px-3 py-2 text-right font-medium">Qtd.</th>
                    <th className="px-3 py-2 text-right font-medium">Preço</th><th className="px-3 py-2 text-right font-medium">Desconto</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th><th className="px-3 py-2" />
                  </tr></thead>
                  <tbody>
                    {sale.items.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-2">{item.part_sku ? `${item.part_sku} — ` : ''}{item.description}</td>
                        <td className="px-3 py-1 text-right"><input type="number" min="0.001" step="0.001" defaultValue={item.quantity} onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== Number(item.quantity) && updateItem(item.id, { quantity: Number(e.target.value) })} className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-right" /></td>
                        <td className="px-3 py-1 text-right"><input type="number" min="0" step="0.01" defaultValue={item.unit_price} onBlur={(e) => Number(e.target.value) !== Number(item.unit_price) && updateItem(item.id, { unitPrice: Number(e.target.value) })} className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right" /></td>
                        <td className="px-3 py-1 text-right"><input type="number" min="0" step="0.01" defaultValue={item.discount_amount} onBlur={(e) => Number(e.target.value) !== Number(item.discount_amount) && updateItem(item.id, { discountAmount: Number(e.target.value) })} className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-right" /></td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(item.total)}</td>
                        <td className="px-2 py-2"><button onClick={() => void removeItem(item.id)} aria-label="Remover item" className="rounded-lg p-1.5 text-slate-500 hover:bg-red-100 hover:text-red-800"><Trash2 className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <FormField label="Cliente (opcional)" htmlFor="pos-customer">
                <EntityCombobox id="pos-customer" value={customer} onChange={changeCustomer} search={searchCustomers} getId={(e) => e.id} getLabel={customerLabel} renderOption={(e) => <CustomerOptionRow item={e} />} placeholder="Consumidor não identificado" />
              </FormField>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(sale?.subtotal ?? 0)}</span></div>
              <div className="flex justify-between"><span>Descontos</span><span>-{formatCurrency(sale?.discount_total ?? 0)}</span></div>
              <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900"><span>Total</span><span>{formatCurrency(total)}</span></div>
            </div>

            <form onSubmit={finalize} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">Pagamento</h2>
                <button type="button" onClick={addPaymentRow} className="flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"><Plus className="h-3.5 w-3.5" /> forma de pagamento</button>
              </div>
              {rows.map((row) => {
                const method = methods.find((m) => m.id === row.paymentMethodId);
                return (
                  <div key={row.key} className="flex flex-col gap-1.5 rounded-xl border border-slate-200 p-2.5">
                    <div className="flex items-center gap-2">
                      <select className={formFieldClass} value={row.paymentMethodId} onChange={(e) => updateRow(row.key, { paymentMethodId: e.target.value, amount: '', tendered: '' })}>
                        <option value="">Forma de pagamento…</option>
                        {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      {rows.length > 1 && <button type="button" onClick={() => removePaymentRow(row.key)} aria-label="Remover forma de pagamento" className="rounded-lg p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-700"><X className="h-4 w-4" /></button>}
                    </div>
                    {method?.code === 'cash' ? (
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <Banknote className="h-4 w-4 shrink-0" />
                        <input type="number" min="0" step="0.01" placeholder="Valor entregue" value={row.tendered} onChange={(e) => updateRow(row.key, { tendered: e.target.value })} className="w-28 rounded-lg border border-slate-300 px-2 py-1" />
                        <span>Troco: <strong>{formatCurrency(Math.max(0, (Number(row.tendered) || 0) - Number(row.amount)))}</strong></span>
                      </div>
                    ) : (
                      <input type="number" min="0" step="0.01" placeholder="Valor" value={row.amount} onChange={(e) => updateRow(row.key, { amount: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                    )}
                  </div>
                );
              })}
              <div className="flex justify-between text-sm text-slate-600"><span>Recebido</span><span>{formatCurrency(paidSoFar)}</span></div>
              <div className="flex justify-between text-sm font-medium text-slate-900"><span>Restante</span><span>{formatCurrency(remaining)}</span></div>
              <button type="submit" disabled={!sale || !sale.items.length || finalizing || !openRegister} className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">
                {finalizing ? 'Finalizando…' : 'Finalizar venda'}
              </button>
              {sale && sale.items.length > 0 && (
                <button type="button" onClick={abandonDraft} className="text-center text-xs text-red-700 hover:underline">Cancelar venda</button>
              )}
            </form>
          </div>
        </div>
      </div>
    </RequireOperationalContext>
  );
}
