'use client';
import { use, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/page-header';
import { ErrorState, friendlyError } from '../../../../../components/error-state';
import { FormSection, FormField, formFieldClass } from '../../../../../components/form-section';
import { AsyncButton } from '../../../../../components/async-button';
import { useSetBreadcrumb } from '../../../../../components/breadcrumb-context';
import { RequireOperationalContext } from '../../../../../components/require-operational-context';
import { useOperationalContext } from '../../../../../components/operational-context';

type Part = { id: string; sku: string; description: string; unit: string; status: string; balance: string };
const movementTypes = [
  { value: 'entry', label: 'Entrada' },
  { value: 'exit', label: 'Saída' },
  { value: 'adjustment_in', label: 'Ajuste (entrada)' },
  { value: 'adjustment_out', label: 'Ajuste (saída)' },
];

export default function InventoryPartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [part, setPart] = useState<Part>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('active');
  const [move, setMove] = useState({ type: 'entry', quantity: '1', reason: '' });
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const { hasFullContext } = useOperationalContext();

  const load = useCallback(async () => {
    const response = await api(`/inventory/parts/${id}`);
    if (!response.ok) return setState('error');
    const data: Part = await response.json();
    setPart(data);
    setDescription(data.description);
    setStatus(data.status);
    setState('ready');
  }, [id]);

  useEffect(() => {
    if (!hasFullContext) return;
    void load();
  }, [load, hasFullContext]);

  useSetBreadcrumb(part ? part.sku : undefined);

  async function registerMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegistering(true);
    setError('');
    const response = await api('/inventory/movements', { method: 'POST', body: JSON.stringify({ ...move, partId: id }) });
    setRegistering(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error));
    setMove({ ...move, reason: '' });
    await load();
  }

  if (state === 'loading') return <RequireOperationalContext><p className="text-sm text-emerald-100/60">Carregando…</p></RequireOperationalContext>;
  if (state === 'error' || !part) return <RequireOperationalContext><ErrorState message="Não foi possível carregar esta peça." onRetry={load} /></RequireOperationalContext>;

  return (
    <RequireOperationalContext>
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={part.sku} description={`Saldo atual: ${Number(part.balance)} ${part.unit}`} />

      <FormSection title="Cadastro">
        <FormField label="Descrição" htmlFor="description" span="full">
          <input id="description" className={formFieldClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <FormField label="Status" htmlFor="status">
          <select id="status" className={formFieldClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </select>
        </FormField>
        <div className="sm:col-span-2">
          <AsyncButton
            tone="secondary"
            label="Salvar cadastro"
            busyLabel="Salvando…"
            onClick={async () => {
              const response = await api(`/inventory/parts/${id}`, { method: 'PATCH', body: JSON.stringify({ description, status }) });
              if (!response.ok) setError(friendlyError((await response.json().catch(() => ({}))).error));
              else await load();
            }}
          />
        </div>
      </FormSection>

      <FormSection title="Registrar movimentação">
        <form onSubmit={registerMovement} className="contents">
          <FormField label="Tipo" htmlFor="move-type">
            <select id="move-type" className={formFieldClass} value={move.type} onChange={(e) => setMove({ ...move, type: e.target.value })}>
              {movementTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Quantidade" htmlFor="move-quantity">
            <input id="move-quantity" type="number" min="0.001" step="0.001" className={formFieldClass} value={move.quantity} onChange={(e) => setMove({ ...move, quantity: e.target.value })} />
          </FormField>
          <FormField label="Motivo" htmlFor="move-reason" span="full">
            <input id="move-reason" required className={formFieldClass} value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} />
          </FormField>
          <div className="sm:col-span-2">
            <button type="submit" disabled={registering} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-emerald-950 disabled:opacity-50">
              {registering ? 'Registrando…' : 'Registrar movimentação'}
            </button>
          </div>
        </form>
      </FormSection>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
    </RequireOperationalContext>
  );
}
