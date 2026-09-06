'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { Banknote, PlusCircle, Receipt as ReceiptIcon, Settings2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { DataTable, type DataTableColumn } from '../../../components/data-table';
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
const movementTypeInfo: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' }> = {
  opening: { label: 'Abertura', tone: 'neutral' }, receipt: { label: 'Recebimento', tone: 'success' },
  refund: { label: 'Estorno', tone: 'warning' }, supply: { label: 'Suprimento', tone: 'info' }, withdrawal: { label: 'Sangria', tone: 'warning' },
};

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

  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [createDialog, setCreateDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('0');
  const [closingAmount, setClosingAmount] = useState('0');
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

  const loadMovements = useCallback(async (sessionId: string) => {
    setMovementsState('loading');
    const response = await api(`/cash-sessions/${sessionId}/movements?pageSize=10`);
    if (!response.ok) return setMovementsState('error');
    const body = await response.json();
    setMovements(body.items);
    setMovementsState('ready');
  }, []);

  useEffect(() => {
    if (selected?.current_session_id) void loadMovements(selected.current_session_id);
    else setMovements([]);
  }, [selected?.current_session_id, loadMovements]);

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
    setDialogBusy(true); setDialogError('');
    const response = await api(`/cash-sessions/${selected.current_session_id}/close`, { method: 'POST', body: JSON.stringify({ closingAmountInformed: Number(closingAmount) }) });
    setDialogBusy(false);
    if (!response.ok) return setDialogError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível fechar o caixa.'));
    setCloseDialog(false); setClosingAmount('0');
    void loadRegisters();
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
                      <AsyncButton tone="destructive" label="Fechar caixa" onClick={() => { setClosingAmount(String(selected.current_session_expected_balance ?? '0')); setDialogError(''); setCloseDialog(true); }} />
                    </>
                  ) : (
                    <AsyncButton tone="primary" label="Abrir caixa" disabled={selected.status === 'inactive'} onClick={() => { setOpeningAmount('0'); setDialogError(''); setOpenDialog(true); }} />
                  )}
                  <button onClick={() => { setEditName(selected.name); setEditStatus(selected.status); setDialogError(''); setEditDialog(true); }} className="flex items-center gap-2 rounded-xl border border-emerald-800 px-4 py-2.5 text-sm text-emerald-100">
                    <Settings2 className="h-4 w-4" /> Editar
                  </button>
                </div>
              </div>
              {selected.current_session_id && (
                <div className="mt-5 grid grid-cols-1 gap-4 border-t border-emerald-900 pt-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-emerald-100/50">Saldo esperado</p>
                    <p className="mt-1 text-xl font-semibold text-emerald-50">{formatCurrency(selected.current_session_expected_balance)}</p>
                  </div>
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

        <FormDialog open={closeDialog} title="Fechar caixa" description="Informe o valor contado fisicamente no caixa. A diferença em relação ao saldo esperado fica registrada." submitLabel="Fechar caixa" busy={dialogBusy} error={dialogError} onSubmit={handleClose} onCancel={() => setCloseDialog(false)}>
          <FormField label="Saldo esperado" htmlFor="expected-readonly">
            <input id="expected-readonly" disabled value={formatCurrency(selected?.current_session_expected_balance)} className={formFieldClass} />
          </FormField>
          <FormField label="Valor contado (R$)" htmlFor="closing-amount">
            <input id="closing-amount" type="number" min="0" step="0.01" required value={closingAmount} onChange={(e) => setClosingAmount(e.target.value)} className={formFieldClass} />
          </FormField>
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
