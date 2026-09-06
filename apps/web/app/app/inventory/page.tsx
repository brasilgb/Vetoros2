import Link from 'next/link';
import { ArrowLeftRight, Package } from 'lucide-react';
import { PageHeader } from '../../../components/page-header';

export default function InventoryHubPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Estoque" description="Peças, produtos e suas movimentações." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/app/inventory/parts" className="flex items-center gap-3 rounded-2xl border border-emerald-900 p-5 hover:bg-emerald-950/60">
          <Package className="h-6 w-6 text-emerald-400" />
          <div>
            <p className="font-medium text-emerald-50">Peças / Produtos</p>
            <p className="text-sm text-emerald-100/60">Cadastro e saldos por filial.</p>
          </div>
        </Link>
        <Link href="/app/inventory/movements" className="flex items-center gap-3 rounded-2xl border border-emerald-900 p-5 hover:bg-emerald-950/60">
          <ArrowLeftRight className="h-6 w-6 text-emerald-400" />
          <div>
            <p className="font-medium text-emerald-50">Movimentações</p>
            <p className="text-sm text-emerald-100/60">Histórico de entradas, saídas e ajustes.</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
