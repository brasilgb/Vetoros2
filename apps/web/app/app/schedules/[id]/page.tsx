'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { friendlyError } from '../../../../components/error-state';
import { RequireOperationalContext } from '../../../../components/require-operational-context';
import { StatusBadge } from '../../../../components/status-badge';
import { ConfirmDialog } from '../../../../components/confirm-dialog';
import { LoadingState } from '../../../../components/loading-state';

type Schedule = {
  id: string;
  customer_name: string;
  asset_identifier: string | null;
  service_order_id: string | null;
  service_order_number: number | null;
  responsible_user_profile_id: string | null;
  responsible_name: string | null;
  starts_at: string;
  ends_at: string | null;
  notes: string | null;
  status: string;
  canceled_at: string | null;
};

const localDateTime = (value: string | null) =>
  value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';

export default function ScheduleDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [row, setRow] = useState<Schedule | null>(null);
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ startsAt: '', endsAt: '', responsibleUserProfileId: '', notes: '' });
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const load = useCallback(async () => {
    const [detailResponse, assigneesResponse] = await Promise.all([api(`/schedules/${id}`), api('/schedules/assignees')]);
    if (detailResponse.status === 401) return router.replace('/login');
    if (!detailResponse.ok) return setError('Agendamento não encontrado.');
    const body: Schedule = await detailResponse.json();
    setRow(body);
    setForm({
      startsAt: localDateTime(body.starts_at),
      endsAt: localDateTime(body.ends_at),
      responsibleUserProfileId: body.responsible_user_profile_id ?? '',
      notes: body.notes ?? '',
    });
    if (assigneesResponse.ok) setAssignees(await assigneesResponse.json());
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setWarning('');
    const response = await api(`/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        responsibleUserProfileId: form.responsibleUserProfileId || null,
        notes: form.notes || null,
      }),
    });
    setSaving(false);
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível salvar.'));
    const body = await response.json();
    if (body.conflicts?.length) setWarning(`Alteração salva com ${body.conflicts.length} sobreposição(ões) de horário.`);
    await load();
  }

  async function cancelSchedule() {
    setCanceling(true);
    setCancelError('');
    const response = await api(`/schedules/${id}/cancel`, { method: 'POST' });
    setCanceling(false);
    if (response.status === 401) return router.replace('/login');
    if (!response.ok) {
      return setCancelError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível cancelar o agendamento.'));
    }
    setCancelOpen(false);
    await load();
  }

  if (!row) {
    return (
      <RequireOperationalContext>
        <LoadingState label={error || 'Carregando agendamento…'} error={Boolean(error)} />
      </RequireOperationalContext>
    );
  }

  const canceled = row.status === 'canceled';
  return (
    <RequireOperationalContext>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          title={`Agendamento — ${row.customer_name}`}
          description={row.service_order_number ? `Vinculado à OS #${row.service_order_number}` : 'Atendimento ainda sem ordem de serviço'}
          action={<StatusBadge tone={canceled ? 'neutral' : 'success'}>{canceled ? 'Cancelado' : 'Agendado'}</StatusBadge>}
        />

        <section className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-600" aria-label="Contexto do atendimento">
          <p>Cliente: <strong>{row.customer_name}</strong></p>
          <p>Equipamento: {row.asset_identifier ?? 'Não informado'}</p>
          {row.service_order_id && (
            <Link className="text-blue-600 underline" href={`/app/service-orders/${row.service_order_id}`}>
              Abrir OS #{row.service_order_number}
            </Link>
          )}
        </section>

        <form onSubmit={save} className="flex flex-col gap-5">
          <FormSection title="Programação">
            <FormField label="Início" htmlFor="starts">
              <input id="starts" disabled={canceled} required type="datetime-local" className={formFieldClass} value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />
            </FormField>
            <FormField label="Fim (opcional)" htmlFor="ends">
              <input id="ends" disabled={canceled} type="datetime-local" className={formFieldClass} value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} />
            </FormField>
            <FormField label="Responsável" htmlFor="responsible" span="full">
              <select id="responsible" disabled={canceled} className={formFieldClass} value={form.responsibleUserProfileId} onChange={(event) => setForm({ ...form, responsibleUserProfileId: event.target.value })}>
                <option value="">Não atribuído</option>
                {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}
              </select>
            </FormField>
            <FormField label="Observação operacional" htmlFor="notes" span="full">
              <textarea id="notes" disabled={canceled} className={`${formFieldClass} min-h-24`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </FormField>
          </FormSection>

          {warning && <p role="status" className="text-sm text-amber-600">{warning}</p>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {!canceled && (
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => { setCancelError(''); setCancelOpen(true); }} className="rounded-xl border border-red-300 px-4 py-2.5 text-sm text-red-700">
                Cancelar agendamento
              </button>
              <button disabled={saving} className="rounded-xl bg-blue-600 hover:bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
          )}
        </form>

        <ConfirmDialog
          open={cancelOpen}
          title="Cancelar agendamento?"
          description="O atendimento deixará de aparecer como agendado, mas seu histórico será preservado."
          confirmLabel="Cancelar agendamento"
          tone="destructive"
          busy={canceling}
          error={cancelError}
          onConfirm={cancelSchedule}
          onCancel={() => { setCancelError(''); setCancelOpen(false); }}
        />
      </div>
    </RequireOperationalContext>
  );
}
