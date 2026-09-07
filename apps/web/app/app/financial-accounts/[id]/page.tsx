'use client';
import { use, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { StatusBadge } from '../../../../components/status-badge';
import { DataTable, DataTablePagination, type DataTableColumn } from '../../../../components/data-table';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormDialog } from '../../../../components/form-dialog';
import { formatCurrency, formatDateTime } from '../../../../lib/format';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../components/operational-context';

type FinancialAccount = {
  id: string; name: string; bank_code: string | null; bank_name: string | null; branch_number: string | null;
  account_number: string | null; account_digit: string | null; pix_key: string | null;
  status: 'active' | 'inactive'; balance: string; has_opening_balance: boolean;
};
type Transaction = {
  id: string; type: 'credit' | 'debit'; amount: string; occurred_at: string; description: string; reference: string | null;
  origin: 'opening_balance' | 'manual' | 'transfer' | 'reversal'; financial_transfer_id: string | null; reverses_transaction_id: string | null;
  reversed: boolean; counterparty_account_name: string | null; created_at: string;
};
const PAGE_SIZE = 20;
const originLabels: Record<Transaction['origin'], string> = { opening_balance: 'Saldo inicial', manual: 'Lançamento manual', transfer: 'Transferência', reversal: 'Estorno' };

// FIN-04, seção 25.3 do correio.md: identificação, saldo atual, histórico com filtros, e ações
// operacionais de pequeno payload (crédito/débito/transferência/estorno) em modal — nenhuma delas
// justifica uma página própria (mesmo critério de "Pagar"/"Estornar" em Contas a Pagar).
export default function FinancialAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { hasFullContext } = useOperationalContext();
  const [account, setAccount] = useState<FinancialAccount>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [rows, setRows] = useState<Transaction[]>([]);
  const [txState, setTxState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [txError, setTxError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [originFilter, setOriginFilter] = useState('');

  const [otherAccounts, setOtherAccounts] = useState<{ id: string; name: string; status: string }[]>([]);

  const [txDialogType, setTxDialogType] = useState<'credit' | 'debit' | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [txBusy, setTxBusy] = useState(false);
  const [txErrorMsg, setTxErrorMsg] = useState('');

  const [openingDialog, setOpeningDialog] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [openingBusy, setOpeningBusy] = useState(false);
  const [openingError, setOpeningError] = useState('');

  const [transferDialog, setTransferDialog] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDescription, setTransferDescription] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState('');

  const [reverseTarget, setReverseTarget] = useState<Transaction | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseBusy, setReverseBusy] = useState(false);
  const [reverseError, setReverseError] = useState('');

  const [statusBusy, setStatusBusy] = useState(false);

  const loadAccount = useCallback(async () => {
    setState('loading');
    const response = await api(`/financial-accounts/${id}`);
    if (!response.ok) {
      setErrorMessage(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar a conta financeira.'));
      return setState('error');
    }
    setAccount(await response.json());
    setState('ready');
  }, [id]);

  const loadTransactions = useCallback(async (targetPage: number) => {
    setTxState('loading');
    const query = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE), ...(typeFilter ? { type: typeFilter } : {}), ...(originFilter ? { origin: originFilter } : {}) });
    const response = await api(`/financial-accounts/${id}/transactions?${query}`);
    if (!response.ok) {
      setTxError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível carregar as movimentações.'));
      return setTxState('error');
    }
    const body = await response.json();
    setRows(body.items); setTotal(body.total); setPage(targetPage); setTxState('ready');
  }, [id, typeFilter, originFilter]);

  useEffect(() => { if (hasFullContext) void loadAccount(); }, [loadAccount, hasFullContext]);
  useEffect(() => { if (hasFullContext) void loadTransactions(1); }, [loadTransactions, hasFullContext]);
  useEffect(() => {
    if (!hasFullContext) return;
    void api('/financial-accounts?status=active').then((r) => r.ok && r.json()).then((items) => items && setOtherAccounts(items.filter((a: { id: string }) => a.id !== id)));
  }, [id, hasFullContext]);
  useSetBreadcrumb(account?.name);

  function openTxDialog(type: 'credit' | 'debit') {
    setTxErrorMsg(''); setAmount(''); setDescription(''); setReference(''); setTxDialogType(type);
  }
  async function handleTx(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!txDialogType) return;
    setTxBusy(true); setTxErrorMsg('');
    const response = await api(`/financial-accounts/${id}/transactions`, { method: 'POST', body: JSON.stringify({
      type: txDialogType, amount: Number(amount), description, reference: reference || null, idempotencyKey: crypto.randomUUID(),
    }) });
    setTxBusy(false);
    if (!response.ok) return setTxErrorMsg(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível registrar a movimentação.'));
    setTxDialogType(null);
    void loadAccount(); void loadTransactions(1);
  }

  function openOpeningDialog() { setOpeningError(''); setOpeningAmount(''); setOpeningDialog(true); }
  async function handleOpening(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOpeningBusy(true); setOpeningError('');
    const response = await api(`/financial-accounts/${id}/opening-balance`, { method: 'POST', body: JSON.stringify({ amount: Number(openingAmount), idempotencyKey: crypto.randomUUID() }) });
    setOpeningBusy(false);
    if (!response.ok) return setOpeningError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível definir o saldo inicial.'));
    setOpeningDialog(false);
    void loadAccount(); void loadTransactions(1);
  }

  function openTransferDialog() { setTransferError(''); setTransferTo(''); setTransferAmount(''); setTransferDescription(''); setTransferDialog(true); }
  async function handleTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTransferBusy(true); setTransferError('');
    const response = await api(`/financial-accounts/${id}/transfer`, { method: 'POST', body: JSON.stringify({
      toFinancialAccountId: transferTo, amount: Number(transferAmount), description: transferDescription, idempotencyKey: crypto.randomUUID(),
    }) });
    setTransferBusy(false);
    if (!response.ok) return setTransferError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível realizar a transferência.'));
    setTransferDialog(false);
    void loadAccount(); void loadTransactions(1);
  }

  function openReverseDialog(transaction: Transaction) { setReverseError(''); setReverseReason(''); setReverseTarget(transaction); }
  async function handleReverse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reverseTarget) return;
    setReverseBusy(true); setReverseError('');
    const url = reverseTarget.origin === 'transfer' ? `/financial-transfers/${reverseTarget.financial_transfer_id}/reverse` : `/financial-accounts/${id}/transactions/${reverseTarget.id}/reverse`;
    const response = await api(url, { method: 'POST', body: JSON.stringify({ reason: reverseReason || null }) });
    setReverseBusy(false);
    if (!response.ok) return setReverseError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível estornar esta movimentação.'));
    setReverseTarget(null);
    void loadAccount(); void loadTransactions(page);
  }

  async function toggleStatus() {
    if (!account) return;
    setStatusBusy(true);
    const response = await api(`/financial-accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ status: account.status === 'active' ? 'inactive' : 'active' }) });
    setStatusBusy(false);
    if (response.ok) void loadAccount();
  }

  if (state === 'error') return <ErrorState message={errorMessage} onRetry={loadAccount} />;
  if (!account) return null;

  const columns: DataTableColumn<Transaction>[] = [
    { key: 'date', header: 'Data', render: (row) => formatDateTime(row.occurred_at) },
    { key: 'description', header: 'Descrição', render: (row) => (
      <span>
        {row.description}
        {row.counterparty_account_name ? <span className="text-emerald-100/50"> · {row.type === 'debit' ? 'para' : 'de'} {row.counterparty_account_name}</span> : null}
      </span>
    ) },
    { key: 'origin', header: 'Origem', render: (row) => originLabels[row.origin], hideBelow: 'sm' },
    { key: 'type', header: 'Tipo', render: (row) => <StatusBadge tone={row.type === 'credit' ? 'success' : 'danger'}>{row.type === 'credit' ? 'Crédito' : 'Débito'}</StatusBadge> },
    { key: 'amount', header: 'Valor', align: 'right', render: (row) => formatCurrency(row.amount) },
    { key: 'actions', header: '', render: (row) => (
      row.origin !== 'reversal' && !row.reversed ? (
        <button onClick={() => openReverseDialog(row)} className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40">Estornar</button>
      ) : row.reversed ? <StatusBadge tone="neutral">Estornado</StatusBadge> : null
    ) },
  ];

  return (
    <RequireOperationalContext>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={account.name}
          description={account.bank_name ?? 'Sem instituição informada'}
          action={
            <div className="flex gap-2">
              <button onClick={() => void toggleStatus()} disabled={statusBusy} className="rounded-xl border border-emerald-800 px-4 py-2.5 text-sm text-emerald-100 hover:bg-emerald-950 disabled:opacity-40">
                {account.status === 'active' ? 'Desativar' : 'Ativar'}
              </button>
              <button onClick={() => openTxDialog('credit')} className="rounded-xl border border-emerald-800 px-4 py-2.5 text-sm text-emerald-100 hover:bg-emerald-950">Lançar crédito</button>
              <button onClick={() => openTxDialog('debit')} className="rounded-xl border border-emerald-800 px-4 py-2.5 text-sm text-emerald-100 hover:bg-emerald-950">Lançar débito</button>
              <button onClick={openTransferDialog} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-950">Transferir</button>
            </div>
          }
        >
          <StatusBadge tone={account.status === 'active' ? 'success' : 'neutral'}>{account.status === 'active' ? 'Ativa' : 'Inativa'}</StatusBadge>
        </PageHeader>

        <FormSection title="Dados da conta">
          <FormField label="Saldo atual" htmlFor="d-balance"><p id="d-balance" className="mt-1 text-lg font-semibold text-emerald-50">{formatCurrency(account.balance)}</p></FormField>
          <FormField label="Banco" htmlFor="d-bank"><p id="d-bank" className={formFieldClass}>{account.bank_name ?? '—'}{account.bank_code ? ` (${account.bank_code})` : ''}</p></FormField>
          <FormField label="Agência / Conta" htmlFor="d-account"><p id="d-account" className={formFieldClass}>{account.branch_number || account.account_number ? `${account.branch_number ?? '—'} / ${account.account_number ?? '—'}${account.account_digit ? `-${account.account_digit}` : ''}` : '—'}</p></FormField>
          <FormField label="Chave PIX" htmlFor="d-pix"><p id="d-pix" className={formFieldClass}>{account.pix_key ?? '—'}</p></FormField>
          {!account.has_opening_balance && (
            <FormField label="Saldo inicial" htmlFor="d-opening" span="full">
              <button type="button" onClick={openOpeningDialog} className="mt-1 rounded-xl border border-emerald-800 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-950">Definir saldo inicial</button>
              <p className="mt-1 text-xs text-emerald-100/50">Registrado como uma movimentação de abertura — não é um campo editável da conta.</p>
            </FormField>
          )}
        </FormSection>

        <FormSection title="Movimentações" description="Histórico append-only — um estorno nunca apaga ou edita o lançamento original, é sempre um novo lançamento de natureza inversa.">
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">
              <option value="">Todos os tipos</option>
              <option value="credit">Crédito</option>
              <option value="debit">Débito</option>
            </select>
            <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value)} className="rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">
              <option value="">Todas as origens</option>
              <option value="opening_balance">Saldo inicial</option>
              <option value="manual">Lançamento manual</option>
              <option value="transfer">Transferência</option>
              <option value="reversal">Estorno</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} state={txState} onRetry={() => loadTransactions(page)} errorMessage={txError}
              emptyState={<p className="p-6 text-sm text-emerald-100/60">Nenhuma movimentação registrada ainda.</p>} />
            <div className="mt-3">
              <DataTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={loadTransactions} />
            </div>
          </div>
        </FormSection>

        <FormDialog open={txDialogType !== null} title={txDialogType === 'credit' ? 'Lançar crédito' : 'Lançar débito'} description="Lançamento manual controlado — a soma dessas movimentações compõe o saldo derivado da conta." submitLabel="Lançar" busy={txBusy} error={txErrorMsg} onSubmit={handleTx} onCancel={() => setTxDialogType(null)}>
          <FormField label="Valor (R$)" htmlFor="tx-amount">
            <input id="tx-amount" type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={formFieldClass} />
          </FormField>
          <FormField label="Descrição" htmlFor="tx-description">
            <input id="tx-description" required maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} className={formFieldClass} />
          </FormField>
          <FormField label="Referência (opcional)" htmlFor="tx-reference" span="full">
            <input id="tx-reference" maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} className={formFieldClass} />
          </FormField>
        </FormDialog>

        <FormDialog open={openingDialog} title="Definir saldo inicial" description="Valor positivo lança um crédito de abertura; negativo, um débito (a conta já começa operando no vermelho). Só pode ser feito uma vez." submitLabel="Definir" busy={openingBusy} error={openingError} onSubmit={handleOpening} onCancel={() => setOpeningDialog(false)}>
          <FormField label="Saldo inicial (R$)" htmlFor="opening-amount">
            <input id="opening-amount" type="number" step="0.01" required value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} className={formFieldClass} />
          </FormField>
        </FormDialog>

        <FormDialog open={transferDialog} title="Transferir" description="Débito na origem e crédito no destino, na mesma transação — nunca só um lado é registrado." submitLabel="Transferir" busy={transferBusy} error={transferError} onSubmit={handleTransfer} onCancel={() => setTransferDialog(false)}>
          <FormField label="Conta de destino" htmlFor="transfer-to">
            <select id="transfer-to" required value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className={formFieldClass}>
              <option value="">Selecione…</option>
              {otherAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </FormField>
          <FormField label="Valor (R$)" htmlFor="transfer-amount">
            <input id="transfer-amount" type="number" min="0.01" step="0.01" required value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} className={formFieldClass} />
          </FormField>
          <FormField label="Descrição" htmlFor="transfer-description" span="full">
            <input id="transfer-description" required maxLength={300} value={transferDescription} onChange={(e) => setTransferDescription(e.target.value)} className={formFieldClass} />
          </FormField>
        </FormDialog>

        <FormDialog open={!!reverseTarget} title={reverseTarget?.origin === 'transfer' ? 'Estornar transferência' : 'Estornar movimentação'} description="O lançamento original é preservado — o estorno é um novo lançamento de natureza inversa." submitLabel="Estornar" busy={reverseBusy} error={reverseError} onSubmit={handleReverse} onCancel={() => setReverseTarget(null)}>
          <FormField label="Motivo (opcional)" htmlFor="reverse-reason">
            <input id="reverse-reason" maxLength={1000} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} className={formFieldClass} />
          </FormField>
        </FormDialog>
      </div>
    </RequireOperationalContext>
  );
}
