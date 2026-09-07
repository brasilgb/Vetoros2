'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api';
import { formatCurrency, formatDateTime } from '../../../../../lib/format';
import { RequireOperationalContext } from '../../../../../components/require-operational-context';

type Movement = { id: string; type: string; amount: string; resulting_balance: string; reason: string; created_at: string; payment_method_name: string | null; actor_name: string | null };
type Report = {
  id: string; status: 'open' | 'closed'; register_name: string; company_legal_name: string; company_trade_name: string | null;
  company_tax_id_type: string; company_tax_id_normalized: string; branch_code: string; branch_name: string; branch_timezone: string;
  opened_at: string; closed_at: string | null; opened_by_name: string | null; closed_by_name: string | null; opening_amount: string;
  closing_justification: string | null;
  summary: { receipts: string; refunds: string; supplies: string; withdrawals: string; expected_amount: string; counted_amount: string | null; difference: number | null; movement_count: number };
  payment_methods: { id: string; code: string; name: string; received_amount: string; refunded_amount: string; net_amount: string }[];
  movements: Movement[];
};
const movementNames: Record<string, string> = { opening: 'Abertura', receipt: 'Recebimento', refund: 'Estorno', supply: 'Suprimento', withdrawal: 'Sangria' };

export default function CashClosingReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [showMovements, setShowMovements] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await api(`/cash-sessions/${id}?includeMovements=true`);
      if (response.status === 401) return router.replace('/login');
      if (!response.ok) return setError(response.status === 404 ? 'Fechamento não encontrado.' : 'Não foi possível carregar o fechamento.');
      setReport(await response.json());
    })();
  }, [id, router]);

  return <RequireOperationalContext>
    <div className="cash-closing-report flex flex-col gap-5">
      <div className="print-hidden flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => router.push('/app/cash')} className="rounded-xl border border-emerald-800 px-4 py-2 text-sm">Voltar ao caixa</button>
        {report?.status === 'closed' && <button onClick={() => window.print()} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950">Imprimir fechamento</button>}
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-800 p-4 text-red-200">{error}</p>}
      {!report && !error && <p>Carregando fechamento…</p>}
      {report && <>
        <section className="rounded-2xl border border-emerald-900 bg-emerald-950/30 p-6">
          <p className="text-xs uppercase tracking-widest text-emerald-100/60">{report.status === 'closed' ? 'Comprovante de fechamento de caixa' : 'Conferência provisória — sessão aberta'}</p>
          <h1 className="mt-2 text-2xl font-semibold">{report.company_trade_name || report.company_legal_name}</h1>
          <p className="mt-1 text-sm">{report.company_legal_name} · {report.company_tax_id_type.toUpperCase()} {report.company_tax_id_normalized}</p>
          <p className="text-sm">Filial {report.branch_name} ({report.branch_code}) · Caixa {report.register_name}</p>
          <p className="mt-3 font-mono text-xs text-emerald-100/60">Sessão {report.id}</p>
        </section>
        <section className="grid grid-cols-1 gap-4 rounded-2xl border border-emerald-900 p-6 sm:grid-cols-2">
          <div><p className="text-xs uppercase text-emerald-100/50">Abertura</p><p>{formatDateTime(report.opened_at)}</p><p className="text-sm">Operador: {report.opened_by_name ?? 'Não identificado'}</p></div>
          <div><p className="text-xs uppercase text-emerald-100/50">Fechamento</p><p>{report.closed_at ? formatDateTime(report.closed_at) : 'Sessão ainda aberta'}</p><p className="text-sm">Operador: {report.closed_by_name ?? '—'}</p></div>
        </section>
        <section className="rounded-2xl border border-emerald-900 p-6">
          <h2 className="font-semibold">Resumo financeiro</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">{[
            ['Saldo inicial', report.opening_amount], ['Recebimentos', report.summary.receipts], ['Suprimentos', report.summary.supplies], ['Estornos', report.summary.refunds],
            ['Sangrias', report.summary.withdrawals], ['Saldo esperado', report.summary.expected_amount], ['Valor contado', report.summary.counted_amount], ['Diferença', report.summary.difference],
          ].map(([label, value]) => <div key={String(label)}><p className="text-xs uppercase text-emerald-100/50">{label}</p><p className={label === 'Diferença' && Number(value) !== 0 ? 'font-semibold text-amber-300' : 'font-medium'}>{value === null ? '—' : formatCurrency(value)}</p></div>)}</div>
          <p className="mt-4 text-sm">Quantidade de movimentos: {report.summary.movement_count}</p>
          {report.summary.difference !== null && Number(report.summary.difference) !== 0 && <div className="mt-4 rounded-xl border border-amber-800 p-4"><p className="font-semibold">Divergência: {formatCurrency(report.summary.difference)}</p><p className="mt-1 text-sm">Justificativa: {report.closing_justification || 'Não informada (fechamento histórico anterior ao CAI-03)'}</p><p className="text-sm">Responsável: {report.closed_by_name ?? 'Não identificado'}</p></div>}
        </section>
        <section className="rounded-2xl border border-emerald-900 p-6">
          <h2 className="font-semibold">Formas de pagamento</h2>
          <p className="mt-1 text-xs text-emerald-100/50">Composição dos recebimentos; os métodos não representam necessariamente dinheiro físico.</p>
          <table className="mt-3 text-sm"><thead><tr><th className="text-left">Método</th><th className="text-right">Recebido</th><th className="text-right">Estornado</th><th className="text-right">Líquido</th></tr></thead><tbody>{report.payment_methods.map((method) => <tr key={method.id}><td>{method.name} ({method.code})</td><td className="text-right">{formatCurrency(method.received_amount)}</td><td className="text-right">{formatCurrency(method.refunded_amount)}</td><td className="text-right">{formatCurrency(method.net_amount)}</td></tr>)}</tbody></table>
          {report.payment_methods.length === 0 && <p className="mt-3 text-sm">Nenhum recebimento por forma de pagamento.</p>}
        </section>
        <section className="rounded-2xl border border-emerald-900 p-6">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Movimentos detalhados</h2><button className="print-hidden text-sm underline" onClick={() => setShowMovements((value) => !value)}>{showMovements ? 'Ocultar' : 'Exibir'}</button></div>
          <div className={showMovements ? 'mt-3' : 'mt-3 hidden print:block'}><table className="text-sm"><thead><tr><th className="text-left">Data</th><th className="text-left">Tipo</th><th className="text-left">Método / motivo</th><th className="text-left">Operador</th><th className="text-right">Valor</th></tr></thead><tbody>{report.movements.map((movement) => <tr key={movement.id}><td>{formatDateTime(movement.created_at)}</td><td>{movementNames[movement.type] ?? movement.type}</td><td>{movement.payment_method_name ?? movement.reason}</td><td>{movement.actor_name ?? '—'}</td><td className="text-right">{formatCurrency(movement.amount)}</td></tr>)}</tbody></table></div>
        </section>
        <p className="text-xs text-emerald-100/50">Relatório regenerado a partir dos fatos canônicos da sessão. Emitido em {formatDateTime(new Date())}.</p>
      </>}
    </div>
  </RequireOperationalContext>;
}
