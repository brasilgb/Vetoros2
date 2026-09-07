'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { Banknote, History, PlusCircle, Receipt as ReceiptIcon, Settings2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusBadge, commonStatus } from '../../../components/status-badge';
import { AsyncButton } from '../../../components/async-button';
import { FormDialog } from '../../../components/form-dialog';
import { FormField, formFieldClass } from '../../../components/form-section';
import { friendlyError } from '../../../components/error-state';
import { RequireOperationalContext } from '../../../components/require-operational-context';
import { useOperationalContext } from '../../../components/operational-context';
import { formatCurrency, formatDateTime } from '../../../lib/format';

type Register = {
  id: string; name: string; status: 'active' | 'inactive';
  current_session_id: string | null; current_session_opened_at: string | null; current_session_opening_amount: string | null;
  current_session_opened_by_name: string | null; current_session_expected_balance: string | null;
};
type Movement = { id: string; type: string; amount: string; resulting_balance: string; reason: string; actor_name: string | null; created_at: string };
type Session = { id: string; register_name: string; company_legal_name: string; company_trade_name: string | null; branch_code: string; branch_name: string; status: 'open' | 'closed'; opened_at: string; closed_at: string | null; opening_amount: string; expected_amount: string; expected_amount_at_close: string | null; closing_amount_informed: string | null; closing_justification: string | null; has_justification: boolean; difference: string | null; receipts: string; refunds: string; supplies: string; withdrawals: string; total_entries: string; total_exits: string; movement_count: number; opened_by_name: string | null; closed_by_name: string | null };
type SessionDetail = Session & { summary: { receipts: string; refunds: string; supplies: string; withdrawals: string; total_entries: string; total_exits: string; expected_amount: string; movement_count: number; counted_amount: string | null; difference: number | null }; payment_methods: { id: string; name: string; net_amount: string }[] };
type Indicators = { closed_sessions: number; divergent_sessions: number; absolute_difference: string; net_difference: string; largest_difference: string };
const movementTypeInfo: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' }> = {
  opening: { label: 'Abertura', tone: 'neutral' }, receipt: { label: 'Recebimento', tone: 'success' },
  refund: { label: 'Estorno', tone: 'warning' }, supply: { label: 'Suprimento', tone: 'info' }, withdrawal: { label: 'Sangria', tone: 'warning' },
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// FIN-01, seção 16 do correio.md: a tela precisa deixar óbvio, sem cards decorativos, o caixa
// selecionado / filial / aberto-fechado / responsável / horário de abertura / saldo esperado /
// movimentações recentes, com a ação principal certa para cada estado (Abrir/Fechar caixa).
// "Não assumir que haverá somente um caixa por filial" (seção 3) — quando há mais de um caixa
// cadastrado, um seletor simples troca qual está em foco; não há nenhum dashboard de cards.
export default function CashPage() {
  const router = useRouter();
  const { hasFullContext } = useOperationalContext();
  const [registers, setRegisters] = useState<Register[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [movements, setMovements] = useState<Movement[]>([]);
  const [movementsState, setMovementsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [historyDivergence, setHistoryDivergence] = useState('');
  const [historyRegisterId, setHistoryRegisterId] = useState('');
  const [historyReference, setHistoryReference] = useState('');
  const [historyPeriod, setHistoryPeriod] = useState<'opened' | 'closed'>('opened');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [indicators, setIndicators] = useState<Indicators | null>(null);

  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [createDialog, setCreateDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [adjustmentDialog, setAdjustmentDialog] = useState(false);
  const [adjustmentType, setAdjustmentType] = useState<'supply' | 'withdrawal'>('supply');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [openingAmount, setOpeningAmount] = useState('0');
  const [closingAmount, setClosingAmount] = useState('0');
  const [closingJustification, setClosingJustification] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const loadRegisters = useCallback(async () => {
    setState('loading');
    const response = await api('/cash-registers');
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) {
      setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar os caixas.'));
      return setState('error');
    }
    const items: Register[] = await response.json();
    setRegisters(items);
    setState('ready');
    setSelectedId((current) => (current && items.some((r) => r.id === current) ? current : (items[0]?.id ?? '')));
  }, [router]);

  useEffect(() => {
    if (!hasFullContext) return;
    void loadRegisters();
  }, [loadRegisters, hasFullContext]);

  const selected = registers.find((r) => r.id === selectedId);

  const loadSessions = useCallback(async () => {
    const query = new URLSearchParams({ page: String(historyPage), pageSize: '20', ...(historyRegisterId ? { cashRegisterId: historyRegisterId } : {}), ...(uuidPattern.test(historyReference) ? { sessionReference: historyReference } : {}), ...(historyStatus ? { status: historyStatus } : {}), ...(historyFrom ? { [historyPeriod === 'opened' ? 'openedFrom' : 'closedFrom']: historyFrom } : {}), ...(historyTo ? { [historyPeriod === 'opened' ? 'openedTo' : 'closedTo']: historyTo } : {}), ...(historyDivergence ? { divergence: historyDivergence } : {}) });
    const indicatorQuery = new URLSearchParams({ ...(historyRegisterId ? { cashRegisterId: historyRegisterId } : {}), ...(historyPeriod === 'closed' && historyFrom ? { from: historyFrom } : {}), ...(historyPeriod === 'closed' && historyTo ? { to: historyTo } : {}) });
    const [response, indicatorResponse] = await Promise.all([api(`/cash-sessions?${query}`), api(`/cash-session-indicators?${indicatorQuery}`)]);
    if (response.ok) { const body = await response.json(); setSessions(body.items); setHistoryTotal(body.total); }
    if (indicatorResponse.ok) setIndicators(await indicatorResponse.json());
  }, [historyPage, historyRegisterId, historyReference, historyStatus, historyFrom, historyTo, historyPeriod, historyDivergence]);

  const loadDetail = useCallback(async (sessionId: string) => {
    const response = await api(`/cash-sessions/${sessionId}`);
    if (response.ok) setSessionDetail(await response.json());
  }, []);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const loadMovements = useCallback(async (sessionId: string) => {
    setMovementsState('loading');
    const response = await api(`/cash-sessions/${sessionId}/movements?pageSize=10`);
    if (!response.ok) return setMovementsState('error');
    const body = await response.json();
    setMovements(body.items);
    setMovementsState('ready');
  }, []);

  useEffect(() => {
    if (selected?.current_session_id) { void loadMovements(selected.current_session_id); void loadDetail(selected.current_session_id); }
    else setMovements([]);
  }, [selected?.current_session_id, loadMovements, loadDetail]);

  async function handleOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDialogBusy(true); setDialogError('');
    const response = await api('/cash-sessions/open', { method: 'POST', body: JSON.stringify({ cashRegisterId: selectedId, openingAmount: Number(openingAmount) }) });
    setDialogBusy(false);
    if (!response.ok) return setDialogError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível abrir o caixa.'));
    setOpenDialog(false); setOpeningAmount('0');
    void loadRegisters();
  }
  async function handleClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected?.current_session_id) return;
    const sessionId = selected.current_session_id;
    const expected = Number(selected.current_session_expected_balance ?? 0);
    if (Number(closingAmount) !== expected && !closingJustification.trim()) return setDialogError('Informe uma justificativa para a divergência.');
    setDialogBusy(true); setDialogError('');
    const response = await api(`/cash-sessions/${sessionId}/close`, { method: 'POST', body: JSON.stringify({ closingAmountInformed: Number(closingAmount), justification: closingJustification || null }) });
    setDialogBusy(false);
    if (!response.ok) return setDialogError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível fechar o caixa.'));
    setCloseDialog(false); setClosingAmount('0'); setClosingJustification('');
    await loadRegisters(); await loadSessions(); await loadDetail(sessionId);
  }
  async function handleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setDialogBusy(true); setDialogError('');
    const response = await api(`/cash-registers/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ name: editName, status: editStatus }) });
    setDialogBusy(false);
    if (!response.ok) return setDialogError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível salvar o caixa.'));
    setEditDialog(false);
    void loadRegisters();
  }
  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDialogBusy(true); setDialogError('');
    const response = await api('/cash-registers', { method: 'POST', body: JSON.stringify({ name: registerName }) });
    setDialogBusy(false);
    if (!response.ok) return setDialogError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível criar o caixa.'));
    const created = await response.json();
    setCreateDialog(false); setRegisterName('');
    await loadRegisters();
    setSelectedId(created.id);
  }
  async function handleAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected?.current_session_id) return;
    setDialogBusy(true); setDialogError('');
    const response = await api(`/cash-sessions/${selected.current_session_id}/movements`, { method: 'POST', body: JSON.stringify({ type: adjustmentType, amount: Number(adjustmentAmount), reason: adjustmentReason }) });
    setDialogBusy(false);
    if (!response.ok) return setDialogError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível registrar a movimentação.'));
    setAdjustmentDialog(false); setAdjustmentAmount(''); setAdjustmentReason('');
    await loadRegisters(); await loadMovements(selected.current_session_id); await loadDetail(selected.current_session_id); await loadSessions();
  }

  const movementColumns: DataTableColumn<Movement>[] = [
    { key: 'date', header: 'Data', render: (row) => formatDateTime(row.created_at) },
    { key: 'type', header: 'Tipo', render: (row) => { const info = movementTypeInfo[row.type] ?? { label: row.type, tone: 'neutral' as const }; return <StatusBadge tone={info.tone}>{info.label}</StatusBadge>; } },
    { key: 'amount', header: 'Valor', align: 'right', render: (row) => formatCurrency(row.amount) },
    { key: 'balance', header: 'Saldo resultante', align: 'right', render: (row) => formatCurrency(row.resulting_balance), hideBelow: 'sm' },
    { key: 'reason', header: 'Referência', render: (row) => row.reason, hideBelow: 'md' },
    { key: 'actor', header: 'Responsável', render: (row) => row.actor_name ?? '—', hideBelow: 'md' },
  ];

  return (
    <RequireOperationalContext>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Caixa"
          description="Abertura, fechamento e acompanhamento do saldo do caixa da filial ativa."
          action={
            <button onClick={() => setCreateDialog(true)} className="flex items-center gap-2 rounded-xl border border-emerald-800 px-4 py-2.5 text-sm text-emerald-100">
              <PlusCircle className="h-4 w-4" /> Novo caixa
            </button>
          }
        >
          {registers.length > 1 && (
            <select aria-label="Caixa selecionado" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="w-full max-w-xs rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2.5 text-sm text-emerald-100">
              {registers.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </PageHeader>

        {state === 'error' && (
          <EmptyState icon={Banknote} title="Não foi possível carregar" description={errorMessage} action={<button onClick={() => void loadRegisters()} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Tentar novamente</button>} />
        )}
        {state === 'ready' && registers.length === 0 && (
          <EmptyState icon={Banknote} title="Nenhum caixa cadastrado" description="Cadastre o primeiro caixa desta filial para começar a abrir sessões e registrar recebimentos." action={<button onClick={() => setCreateDialog(true)} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-950">Novo caixa</button>} />
        )}
        {state === 'ready' && selected && (
          <>
            <div className="rounded-2xl border border-emerald-900 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-emerald-50">{selected.name}</h2>
                    <StatusBadge tone={selected.current_session_id ? 'info' : 'neutral'}>{selected.current_session_id ? 'Aberto' : 'Fechado'}</StatusBadge>
                    {selected.status === 'inactive' && <StatusBadge tone="neutral">Caixa inativo</StatusBadge>}
                  </div>
                  {selected.current_session_id ? (
                    <p className="mt-1 text-sm text-emerald-100/60">
                      Aberto por {selected.current_session_opened_by_name ?? '—'} em {formatDateTime(selected.current_session_opened_at)} · valor inicial {formatCurrency(selected.current_session_opening_amount)}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-emerald-100/60">Este caixa está fechado no momento.</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-3">
                  {selected.current_session_id ? (
                    <>
                      <button onClick={() => router.push(`/app/payments?new=1&cashSessionId=${selected.current_session_id}`)} className="flex items-center gap-2 rounded-xl border border-emerald-800 px-4 py-2.5 text-sm text-emerald-100">
                        <ReceiptIcon className="h-4 w-4" /> Registrar recebimento
                      </button>
                      <button onClick={() => { setAdjustmentType('supply'); setDialogError(''); setAdjustmentDialog(true); }} className="rounded-xl border border-emerald-800 px-4 py-2.5 text-sm text-emerald-100">Suprimento / sangria</button>
                      <AsyncButton tone="destructive" label="Fechar caixa" onClick={() => { setClosingAmount(String(selected.current_session_expected_balance ?? '0')); setClosingJustification(''); setDialogError(''); setCloseDialog(true); }} />
                    </>
                  ) : (
                    <AsyncButton tone="primary" label="Abrir caixa" disabled={selected.status === 'inactive'} onClick={() => { setOpeningAmount('0'); setDialogError(''); setOpenDialog(true); }} />
                  )}
                  <button onClick={() => { setEditName(selected.name); setEditStatus(selected.status); setDialogError(''); setEditDialog(true); }} className="flex items-center gap-2 rounded-xl border border-emerald-800 px-4 py-2.5 text-sm text-emerald-100">
                    <Settings2 className="h-4 w-4" /> Editar
                  </button>
                </div>
              </div>
              {selected.current_session_id && sessionDetail?.id === selected.current_session_id && (
                <div className="mt-5 grid grid-cols-2 gap-4 border-t border-emerald-900 pt-4 md:grid-cols-4">
                  {[['Saldo esperado', sessionDetail.summary.expected_amount], ['Entradas', sessionDetail.summary.total_entries], ['Saídas', sessionDetail.summary.total_exits], ['Saldo inicial', sessionDetail.opening_amount]].map(([label, value]) => <div key={label}><p className="text-xs uppercase tracking-wide text-emerald-100/50">{label}</p><p className="mt-1 text-xl font-semibold text-emerald-50">{formatCurrency(value)}</p></div>)}
                </div>
              )}
            </div>

            {selected.current_session_id && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-emerald-100">Movimentações recentes</h3>
                <DataTable
                  columns={movementColumns}
                  rows={movements}
                  rowKey={(row) => row.id}
                  state={movementsState}
                  onRetry={() => selected.current_session_id && loadMovements(selected.current_session_id)}
                  emptyState={<EmptyState icon={Banknote} title="Nenhuma movimentação ainda" description="Movimentações aparecem aqui conforme recebimentos e estornos são registrados nesta sessão." />}
                />
              </div>
            )}

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-100"><History className="h-4 w-4" /> Histórico de sessões</h3>
                <div className="flex flex-wrap gap-2">
                  <select aria-label="Caixa do histórico" value={historyRegisterId} onChange={(e) => { setHistoryRegisterId(e.target.value); setHistoryPage(1); }} className={formFieldClass}><option value="">Todos os caixas</option>{registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}</select>
                  <select aria-label="Status da sessão" value={historyStatus} onChange={(e) => { setHistoryStatus(e.target.value); setHistoryPage(1); }} className={formFieldClass}><option value="">Todos os status</option><option value="open">Abertas</option><option value="closed">Fechadas</option></select>
                  <select aria-label="Divergência" value={historyDivergence} onChange={(e) => { setHistoryDivergence(e.target.value); setHistoryPage(1); }} className={formFieldClass}><option value="">Todas as conferências</option><option value="with">Com divergência</option><option value="without">Sem divergência</option></select>
                  <select aria-label="Tipo de período" value={historyPeriod} onChange={(e) => { setHistoryPeriod(e.target.value as 'opened' | 'closed'); setHistoryPage(1); }} className={formFieldClass}><option value="opened">Período de abertura</option><option value="closed">Período de fechamento</option></select>
                  <input aria-label="Período inicial" type="date" value={historyFrom} onChange={(e) => { setHistoryFrom(e.target.value); setHistoryPage(1); }} className={formFieldClass} />
                  <input aria-label="Período final" type="date" value={historyTo} onChange={(e) => { setHistoryTo(e.target.value); setHistoryPage(1); }} className={formFieldClass} />
                  <input aria-label="Referência da sessão" type="text" placeholder="UUID da sessão" value={historyReference} onChange={(e) => { setHistoryReference(e.target.value.trim()); setHistoryPage(1); }} className={formFieldClass} />
                </div>
              </div>
              {indicators && <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{[['Sessões fechadas', indicators.closed_sessions], ['Com divergência', indicators.divergent_sessions], ['Divergência absoluta', formatCurrency(indicators.absolute_difference)], ['Diferença líquida', formatCurrency(indicators.net_difference)], ['Maior divergência', formatCurrency(indicators.largest_difference)]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-emerald-900 p-3"><p className="text-xs text-emerald-100/50">{label}</p><p className="mt-1 font-semibold text-emerald-50">{value}</p></div>)}</div>}
              <DataTable columns={[
                { key: 'reference', header: 'Referência', render: (row: Session) => <span title={row.id} className="font-mono text-xs">{row.id.slice(0, 8)}</span> },
                { key: 'register', header: 'Caixa', render: (row: Session) => row.register_name },
                { key: 'opened', header: 'Abertura', render: (row: Session) => formatDateTime(row.opened_at) },
                { key: 'operator', header: 'Operador', render: (row: Session) => row.opened_by_name ?? '—' },
                { key: 'status', header: 'Status', render: (row: Session) => <StatusBadge tone={row.status === 'open' ? 'info' : 'neutral'}>{row.status === 'open' ? 'Aberta' : 'Fechada'}</StatusBadge> },
                { key: 'flow', header: 'Entradas / saídas', align: 'right', render: (row: Session) => <span>{formatCurrency(row.total_entries)} / {formatCurrency(row.total_exits)}</span>, hideBelow: 'md' },
                { key: 'expected', header: 'Esperado', align: 'right', render: (row: Session) => formatCurrency(row.expected_amount) },
                { key: 'counted', header: 'Contado', align: 'right', render: (row: Session) => row.closing_amount_informed === null ? '—' : formatCurrency(row.closing_amount_informed) },
                { key: 'difference', header: 'Diferença', align: 'right', render: (row: Session) => row.difference === null ? '—' : <span className={Number(row.difference) === 0 ? '' : 'font-semibold text-amber-300'}>{formatCurrency(row.difference)}</span> },
              ]} rows={sessions} rowKey={(row) => row.id} state="ready" onRowClick={(row) => { void loadDetail(row.id); void loadMovements(row.id); }} emptyState={<EmptyState icon={History} title="Nenhuma sessão encontrada" description="Ajuste os filtros ou abra uma sessão neste caixa." />} />
              <DataTablePagination page={historyPage} pageSize={20} total={historyTotal} onPageChange={setHistoryPage} />
              {sessionDetail && <div className="rounded-2xl border border-emerald-900 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-emerald-50">Conferência — {sessionDetail.register_name}</h3><p className="mt-1 text-sm text-emerald-100/60">Aberta por {sessionDetail.opened_by_name ?? '—'} em {formatDateTime(sessionDetail.opened_at)}{sessionDetail.closed_at ? ` · fechada por ${sessionDetail.closed_by_name ?? '—'} em ${formatDateTime(sessionDetail.closed_at)}` : ' · sessão atual aberta'}</p></div>{sessionDetail.status === 'closed' && <button onClick={() => router.push(`/app/cash/sessions/${sessionDetail.id}`)} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm text-emerald-100">Ver fechamento</button>}</div><div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">{[['Recebimentos', sessionDetail.summary.receipts], ['Estornos', sessionDetail.summary.refunds], ['Suprimentos', sessionDetail.summary.supplies], ['Sangrias', sessionDetail.summary.withdrawals], ['Esperado', sessionDetail.summary.expected_amount], ['Contado', sessionDetail.summary.counted_amount], ['Diferença', sessionDetail.summary.difference], ['Movimentos', sessionDetail.summary.movement_count]].map(([label, value]) => <div key={String(label)}><p className="text-xs text-emerald-100/50">{label}</p><p className="font-medium text-emerald-50">{value === null ? '—' : label === 'Movimentos' ? String(value) : formatCurrency(value as string | number)}</p></div>)}</div>{sessionDetail.closing_justification && <p className="mt-4 rounded-xl bg-amber-950/30 p-3 text-sm text-amber-100"><span className="font-semibold">Justificativa:</span> {sessionDetail.closing_justification}</p>}{sessionDetail.payment_methods.length > 0 && <div className="mt-4 border-t border-emerald-900 pt-3"><p className="text-xs uppercase tracking-wide text-emerald-100/50">Totais líquidos por forma de pagamento</p><div className="mt-2 flex flex-wrap gap-3">{sessionDetail.payment_methods.map((method) => <span key={method.id} className="rounded-lg bg-emerald-950 px-3 py-2 text-sm text-emerald-100">{method.name}: {formatCurrency(method.net_amount)}</span>)}</div></div>}</div>}
            </div>

            {registers.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-100"><Settings2 className="h-4 w-4" /> Caixas cadastrados</h3>
                <DataTable
                  columns={[
                    { key: 'name', header: 'Nome', render: (row: Register) => row.name },
                    { key: 'status', header: 'Status', render: (row: Register) => { const c = commonStatus(row.status); return <StatusBadge tone={c.tone}>{c.label}</StatusBadge>; } },
                    { key: 'session', header: 'Sessão atual', render: (row: Register) => (row.current_session_id ? <StatusBadge tone="info">Aberto</StatusBadge> : <StatusBadge tone="neutral">Fechado</StatusBadge>) },
                  ]}
                  rows={registers}
                  rowKey={(row) => row.id}
                  state="ready"
                  onRowClick={(row) => setSelectedId(row.id)}
                  emptyState={<></>}
                />
              </div>
            )}
          </>
        )}

        <FormDialog open={openDialog} title="Abrir caixa" description={`Informe o valor inicial em espécie para "${selected?.name ?? ''}".`} submitLabel="Abrir caixa" busy={dialogBusy} error={dialogError} onSubmit={handleOpen} onCancel={() => setOpenDialog(false)}>
          <FormField label="Valor inicial (R$)" htmlFor="opening-amount">
            <input id="opening-amount" type="number" min="0" step="0.01" required value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} className={formFieldClass} />
          </FormField>
        </FormDialog>

        <FormDialog open={adjustmentDialog} title="Movimentação manual" description={`Registre um fato auditável no ledger de "${selected?.name ?? ''}".`} submitLabel="Registrar" busy={dialogBusy} error={dialogError} onSubmit={handleAdjustment} onCancel={() => setAdjustmentDialog(false)}>
          <FormField label="Operação" htmlFor="adjustment-type">
            <select id="adjustment-type" value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value as 'supply' | 'withdrawal')} className={formFieldClass}><option value="supply">Suprimento</option><option value="withdrawal">Sangria</option></select>
          </FormField>
          <FormField label="Valor (R$)" htmlFor="adjustment-amount"><input id="adjustment-amount" type="number" min="0.01" step="0.01" required value={adjustmentAmount} onChange={(e) => setAdjustmentAmount(e.target.value)} className={formFieldClass} /></FormField>
          <FormField label="Motivo" htmlFor="adjustment-reason"><textarea id="adjustment-reason" required maxLength={1000} value={adjustmentReason} onChange={(e) => setAdjustmentReason(e.target.value)} className={formFieldClass} /></FormField>
        </FormDialog>

        <FormDialog open={closeDialog} title="Fechar caixa" description="Informe o valor contado fisicamente no caixa. A diferença em relação ao saldo esperado fica registrada." submitLabel="Fechar caixa" busy={dialogBusy} error={dialogError} onSubmit={handleClose} onCancel={() => setCloseDialog(false)}>
          {sessionDetail && sessionDetail.id === selected?.current_session_id && <div className="grid grid-cols-2 gap-2 rounded-xl bg-emerald-950/60 p-3 text-sm"><span>Saldo inicial: {formatCurrency(sessionDetail.opening_amount)}</span><span>Recebimentos: {formatCurrency(sessionDetail.summary.receipts)}</span><span>Estornos: {formatCurrency(sessionDetail.summary.refunds)}</span><span>Suprimentos: {formatCurrency(sessionDetail.summary.supplies)}</span><span>Sangrias: {formatCurrency(sessionDetail.summary.withdrawals)}</span><span>Movimentos: {sessionDetail.summary.movement_count}</span>{sessionDetail.payment_methods.map((method) => <span key={method.id}>{method.name}: {formatCurrency(method.net_amount)}</span>)}</div>}
          <FormField label="Saldo esperado" htmlFor="expected-readonly">
            <input id="expected-readonly" disabled value={formatCurrency(selected?.current_session_expected_balance)} className={formFieldClass} />
          </FormField>
          <FormField label="Valor contado (R$)" htmlFor="closing-amount">
            <input id="closing-amount" type="number" min="0" step="0.01" required value={closingAmount} onChange={(e) => setClosingAmount(e.target.value)} className={formFieldClass} />
          </FormField>
          <p className={`text-sm font-semibold ${Number(closingAmount) === Number(selected?.current_session_expected_balance ?? 0) ? 'text-emerald-300' : 'text-amber-300'}`}>Diferença: {formatCurrency(Number(closingAmount || 0) - Number(selected?.current_session_expected_balance ?? 0))}</p>
          {Number(closingAmount) !== Number(selected?.current_session_expected_balance ?? 0) && <FormField label="Justificativa da divergência" htmlFor="closing-justification"><textarea id="closing-justification" required maxLength={2000} value={closingJustification} onChange={(e) => setClosingJustification(e.target.value)} className={formFieldClass} /></FormField>}
          <p className="text-xs text-emerald-100/60">Ao confirmar, a sessão será encerrada e não poderá ser reaberta ou alterada.</p>
        </FormDialog>

        <FormDialog open={editDialog} title="Editar caixa" description="Alterar nome ou status do caixa." submitLabel="Salvar" busy={dialogBusy} error={dialogError} onSubmit={handleEdit} onCancel={() => setEditDialog(false)}>
          <FormField label="Nome" htmlFor="edit-register-name">
            <input id="edit-register-name" required maxLength={120} value={editName} onChange={(e) => setEditName(e.target.value)} className={formFieldClass} />
          </FormField>
          <FormField label="Status" htmlFor="edit-register-status">
            <select id="edit-register-status" value={editStatus} onChange={(e) => setEditStatus(e.target.value as 'active' | 'inactive')} className={formFieldClass}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </FormField>
        </FormDialog>

        <FormDialog open={createDialog} title="Novo caixa" description="Cadastre um novo caixa para esta filial." submitLabel="Criar" busy={dialogBusy} error={dialogError} onSubmit={handleCreate} onCancel={() => setCreateDialog(false)}>
          <FormField label="Nome" htmlFor="register-name">
            <input id="register-name" required maxLength={120} value={registerName} onChange={(e) => setRegisterName(e.target.value)} placeholder="Ex.: Caixa 1" className={formFieldClass} />
          </FormField>
        </FormDialog>
      </div>
    </RequireOperationalContext>
  );
}
