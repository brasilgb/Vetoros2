'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { FileText, PlusCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { SearchToolbar } from '../../../components/search-toolbar';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge, commonStatus } from '../../../components/status-badge';
import { FormDialog } from '../../../components/form-dialog';
import { FormField, formFieldClass } from '../../../components/form-section';
import { EntityCombobox } from '../../../components/entity-combobox';
import { friendlyError } from '../../../components/error-state';
import { RequireOperationalContext } from '../../../components/require-operational-context';
import { useOperationalContext } from '../../../components/operational-context';
import { useDebouncedValue } from '../../../lib/use-debounced-value';
import { formatCurrency, formatDate } from '../../../lib/format';
import { searchConfirmedSales, searchOpenServiceOrders, type SaleOption, type ServiceOrderOption } from '../../../lib/entity-search';

type FiscalDocument = {
  id: string; document_type: 'nfce' | 'nfe' | 'nfse'; status: string; recipient_legal_name: string; document_number: number | null; series: string | null;
  total: string; created_at: string; sale_number: number | null; service_order_number: number | null;
};
const PAGE_SIZE = 20;
const documentTypeLabel: Record<FiscalDocument['document_type'], string> = { nfce: 'NFC-e', nfe: 'NF-e', nfse: 'NFS-e' };
const originLabel = (row: FiscalDocument) => (row.sale_number ? `Venda #${row.sale_number}` : row.service_order_number ? `OS #${row.service_order_number}` : '—');

// FIS-ADV-01, seção 26: listagem operacional — status, origem, número, cliente, valor, data,
// filtros por status/tipo/origem/busca. Detalhe fica em `/app/fiscal/[id]` (seção 3 padrão: três
// telas para o CRUD principal — aqui não há "editar", já que o documento é imutável depois de
// criado; "novo" é o diálogo de emissão abaixo, não uma página própria).
export default function FiscalPage() {
  return (
    <RequireOperationalContext>
      <Suspense fallback={<p className="text-sm text-slate-500">Carregando…</p>}>
        <FiscalPageContent />
      </Suspense>
    </RequireOperationalContext>
  );
}

type OriginType = 'sale' | 'service_order';

function FiscalPageContent() {
  const router = useRouter();
  const { hasFullContext } = useOperationalContext();
  const [rows, setRows] = useState<FiscalDocument[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [origin, setOrigin] = useState('');
  const debouncedQ = useDebouncedValue(q);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [originType, setOriginType] = useState<OriginType>('sale');
  const [sale, setSale] = useState<SaleOption | null>(null);
  const [serviceOrder, setServiceOrder] = useState<ServiceOrderOption | null>(null);
  const [newDocumentType, setNewDocumentType] = useState<FiscalDocument['document_type']>('nfce');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const activeFilterCount = [debouncedQ, status, documentType, origin].filter(Boolean).length;
  const clearFilters = useCallback(() => { setQ(''); setStatus(''); setDocumentType(''); setOrigin(''); }, []);

  const load = useCallback(async (targetPage: number) => {
    setState('loading');
    const query = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE), ...(debouncedQ ? { q: debouncedQ } : {}), ...(status ? { status } : {}), ...(documentType ? { documentType } : {}), ...(origin ? { origin } : {}) });
    const response = await api(`/fiscal-documents?${query}`);
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) { setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar os documentos fiscais.')); return setState('error'); }
    const body = await response.json();
    setRows(body.items); setTotal(body.total); setPage(targetPage); setState('ready');
  }, [router, debouncedQ, status, documentType, origin]);

  useEffect(() => { if (hasFullContext) void load(1); }, [hasFullContext, load]);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDialogBusy(true);
    setDialogError('');
    const response = await api('/fiscal-documents', { method: 'POST', body: JSON.stringify({ saleId: originType === 'sale' ? sale?.id : null, serviceOrderId: originType === 'service_order' ? serviceOrder?.id : null, documentType: newDocumentType }) });
    setDialogBusy(false);
    if (!response.ok) return setDialogError(friendlyError((await response.json().catch(() => ({}))).error));
    const created = await response.json();
    setDialogOpen(false); setSale(null); setServiceOrder(null);
    router.push(`/app/fiscal/${created.id}`);
  }

  const columns: DataTableColumn<FiscalDocument>[] = [
    { key: 'type', header: 'Tipo', render: (row) => documentTypeLabel[row.document_type] },
    { key: 'number', header: 'Número', render: (row) => (row.document_number ? `${row.series ?? ''}/${row.document_number}` : '—'), hideBelow: 'sm' },
    { key: 'recipient', header: 'Destinatário', render: (row) => row.recipient_legal_name },
    { key: 'origin', header: 'Origem', render: (row) => originLabel(row), hideBelow: 'md' },
    { key: 'total', header: 'Valor', align: 'right', render: (row) => formatCurrency(row.total) },
    { key: 'date', header: 'Data', render: (row) => formatDate(row.created_at), hideBelow: 'md' },
    { key: 'status', header: 'Situação', render: (row) => { const s = commonStatus(row.status); return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>; } },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Fiscal" description="Documentos fiscais emitidos a partir de vendas e ordens de serviço" action={<button onClick={() => setDialogOpen(true)} className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white"><PlusCircle className="h-4 w-4" /> Emitir documento fiscal</button>} />

      <SearchToolbar value={q} onChange={setQ} placeholder="Buscar por destinatário, documento ou número…">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700">
          <option value="">Todos os status</option>
          <option value="draft">Rascunho</option>
          <option value="pending">Em processamento</option>
          <option value="authorized">Autorizado</option>
          <option value="rejected">Rejeitado</option>
          <option value="cancellation_pending">Cancelamento em andamento</option>
          <option value="cancelled">Cancelado</option>
        </select>
        <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700">
          <option value="">Todos os tipos</option>
          <option value="nfce">NFC-e</option>
          <option value="nfe">NF-e</option>
          <option value="nfse">NFS-e</option>
        </select>
        <select value={origin} onChange={(e) => setOrigin(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700">
          <option value="">Toda origem</option>
          <option value="sale">Venda</option>
          <option value="service_order">Ordem de serviço</option>
        </select>
        {activeFilterCount > 0 && <button onClick={clearFilters} className="text-sm text-blue-700 hover:underline">Limpar filtros</button>}
      </SearchToolbar>

      {errorMessage && state === 'error' && <p role="alert" className="text-sm text-red-700">{errorMessage}</p>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        state={state === 'error' ? 'ready' : state}
        onRowClick={(row) => router.push(`/app/fiscal/${row.id}`)}
        emptyState={<EmptyState icon={FileText} title="Nenhum documento fiscal" description="Emita um documento fiscal a partir de uma venda confirmada ou de uma OS concluída." />}
      />
      <DataTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={(next) => void load(next)} />

      <FormDialog
        open={dialogOpen}
        title="Emitir documento fiscal"
        description="Cria o documento em rascunho, com os dados congelados no momento da criação. A emissão em si é uma ação separada."
        submitLabel="Criar rascunho"
        busy={dialogBusy}
        error={dialogError}
        onCancel={() => setDialogOpen(false)}
        onSubmit={submitCreate}
      >
        <FormField label="Tipo de documento" htmlFor="fd-type">
          <select id="fd-type" className={formFieldClass} value={newDocumentType} onChange={(e) => setNewDocumentType(e.target.value as FiscalDocument['document_type'])}>
            <option value="nfce">NFC-e (venda de balcão)</option>
            <option value="nfe">NF-e (venda com nota modelo 55)</option>
            <option value="nfse">NFS-e (serviço)</option>
          </select>
        </FormField>
        <FormField label="Origem" htmlFor="fd-origin-type">
          <select id="fd-origin-type" className={formFieldClass} value={originType} onChange={(e) => { setOriginType(e.target.value as OriginType); setSale(null); setServiceOrder(null); }}>
            <option value="sale">Venda confirmada</option>
            <option value="service_order">Ordem de serviço concluída/entregue</option>
          </select>
        </FormField>
        {originType === 'sale' ? (
          <FormField label="Venda" htmlFor="fd-sale" span="full">
            <EntityCombobox id="fd-sale" value={sale} onChange={setSale} search={searchConfirmedSales} getId={(e) => e.id} getLabel={(e) => `Venda #${e.sale_number} — ${e.customer_name ?? 'Consumidor não identificado'}`} renderOption={(e) => <span>Venda #{e.sale_number} — {e.customer_name ?? 'Consumidor não identificado'}</span>} placeholder="Buscar venda confirmada…" />
          </FormField>
        ) : (
          <FormField label="Ordem de serviço" htmlFor="fd-os" span="full">
            <EntityCombobox id="fd-os" value={serviceOrder} onChange={setServiceOrder} search={searchOpenServiceOrders} getId={(e) => e.id} getLabel={(e) => `OS #${e.order_number} — ${e.customer_name ?? '—'}`} renderOption={(e) => <span>OS #{e.order_number} — {e.customer_name ?? '—'} ({e.status})</span>} placeholder="Buscar ordem de serviço…" />
          </FormField>
        )}
      </FormDialog>
    </div>
  );
}
