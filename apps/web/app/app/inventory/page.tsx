import Link from 'next/link';
import { ArrowLeftRight, Package, Tags } from 'lucide-react';
import { PageHeader } from '../../../components/page-header';

export default function InventoryHubPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Estoque" description="Peças, produtos e suas movimentações." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/app/inventory/parts" className="flex items-center gap-3 rounded-2xl border border-slate-200 p-5 hover:bg-slate-50">
          <Package className="h-6 w-6 text-blue-600" />
          <div>
            <p className="font-medium text-slate-900">Peças / Produtos</p>
            <p className="text-sm text-slate-500">Cadastro e saldos por filial.</p>
          </div>
        </Link>
        <Link href="/app/inventory/catalogs" className="flex items-center gap-3 rounded-2xl border border-slate-200 p-5 hover:bg-slate-50">
          <Tags className="h-6 w-6 text-blue-600" />
          <div><p className="font-medium text-slate-900">Categorias e marcas</p><p className="text-sm text-slate-500">Catálogos usados nos produtos.</p></div>
        </Link>
        <Link href="/app/inventory/movements" className="flex items-center gap-3 rounded-2xl border border-slate-200 p-5 hover:bg-slate-50">
          <ArrowLeftRight className="h-6 w-6 text-blue-600" />
          <div>
            <p className="font-medium text-slate-900">Movimentações</p>
            <p className="text-sm text-slate-500">Histórico de entradas, saídas e ajustes.</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
