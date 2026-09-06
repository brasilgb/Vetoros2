import type { CustomerOption, SupplierOption, PartOption, AssetOption } from '../lib/entity-search';

// Como cada domínio se mostra dentro do EntityCombobox (seção 5/7/8 do correio.md UX-03):
// informação suficiente para não ser ambíguo, só com o que a API já devolve — sem inventar
// dado novo (ex.: não mascarar documento, já que a API entrega o valor normalizado completo e
// o resto do app já o exibe assim).
export function customerLabel(item: CustomerOption): string {
  return item.trade_name || item.legal_name;
}
export function CustomerOptionRow({ item }: { item: CustomerOption }) {
  const secondary = [item.document_normalized, item.mobile || item.email].filter(Boolean).join(' · ');
  return (
    <div>
      <p className="font-medium text-emerald-50">{customerLabel(item)}</p>
      <p className="text-xs text-emerald-100/50">{secondary || 'Sem documento cadastrado'}</p>
    </div>
  );
}

export function supplierLabel(item: SupplierOption): string {
  return item.trade_name || item.legal_name;
}
export function SupplierOptionRow({ item }: { item: SupplierOption }) {
  return (
    <div>
      <p className="font-medium text-emerald-50">{supplierLabel(item)}</p>
      <p className="text-xs text-emerald-100/50">{item.document_normalized || 'Sem documento cadastrado'}</p>
    </div>
  );
}

export function partLabel(item: PartOption): string {
  return `${item.sku} — ${item.description}`;
}
export function PartOptionRow({ item }: { item: PartOption }) {
  return (
    <div>
      <p className="font-medium text-emerald-50">{item.sku}</p>
      <p className="text-xs text-emerald-100/50">
        {item.description}
        {item.balance !== undefined ? ` · saldo ${Number(item.balance)} ${item.unit}` : ''}
      </p>
    </div>
  );
}

export function assetLabel(item: AssetOption): string {
  return `${item.internal_identifier} — ${item.category}`;
}
export function AssetOptionRow({ item }: { item: AssetOption }) {
  const secondary = [item.brand, item.model].filter(Boolean).join(' ');
  return (
    <div>
      <p className="font-medium text-emerald-50">{assetLabel(item)}</p>
      <p className="text-xs text-emerald-100/50">{secondary || 'Sem marca/modelo cadastrados'}</p>
    </div>
  );
}
