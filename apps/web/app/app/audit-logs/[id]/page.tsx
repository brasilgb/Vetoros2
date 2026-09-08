'use client';
import { use, useEffect, useState } from 'react';
import { PageHeader } from '../../../../components/page-header';
import { ErrorState } from '../../../../components/error-state';
import { FormSection } from '../../../../components/form-section';
import { api } from '../../../../lib/api';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { actionLabel, moduleLabelForResourceType, friendlyMetadata } from '../../../../lib/audit-labels';
import { permissionLabel } from '../../../../lib/permission-labels';

type AuditEventDetail = {
  id: string; createdAt: string; action: string; resourceType: string; resourceId: string | null;
  entityLabel: string | null; metadata: Record<string, unknown>;
  actor: { identityId: string; name: string | null; email: string | null } | null;
};

// ADM-03 seção 10/11 do correio.md: página dedicada (não modal) — consistente com todo o resto
// do VetorOS 2, que já usa `/módulo/:id` para detalhe em vez de modal, e dá uma URL estável para
// "quem fez o quê, quando" (útil para investigação/compartilhar um link do evento). O `metadata`
// nunca é despejado como JSON cru: `friendlyMetadata` traduz o que dá para traduzir com
// confiança e respeita exatamente o que foi registrado — nunca inventa um valor "antes" que não
// exista.
export default function AuditEventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [event, setEvent] = useState<AuditEventDetail>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    void (async () => {
      const response = await api(`/audit-events/${id}`);
      if (!response.ok) return setState('error');
      setEvent(await response.json());
      setState('ready');
    })();
  }, [id]);

  useSetBreadcrumb(event ? actionLabel(event.action, event.metadata) : undefined);

  if (state === 'loading') return <p className="text-sm text-slate-500">Carregando…</p>;
  if (state === 'error' || !event) return <ErrorState message="Não foi possível carregar este evento." />;

  const view = friendlyMetadata(event.metadata, permissionLabel);
  const when = new Date(event.createdAt).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'medium' });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={actionLabel(event.action, event.metadata)} description={when} />

      <FormSection title="Identificação">
        <div>
          <p className="text-sm text-slate-600">Usuário</p>
          <p className="mt-1 text-sm text-slate-900">{event.actor?.name ?? 'Sistema'}</p>
          {event.actor?.email && <p className="text-xs text-slate-500">{event.actor.email}</p>}
        </div>
        <div>
          <p className="text-sm text-slate-600">Módulo</p>
          <p className="mt-1 text-sm text-slate-900">{moduleLabelForResourceType(event.resourceType)}</p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-sm text-slate-600">Entidade</p>
          <p className="mt-1 text-sm text-slate-900">{event.entityLabel ?? `${moduleLabelForResourceType(event.resourceType)} · ${event.resourceId?.slice(0, 8) ?? '—'}`}</p>
        </div>
      </FormSection>

      <FormSection title="Alterações realizadas" columns={1}>
        {!view.changedFields && !view.permissionsAdded && !view.permissionsRemoved && view.fields.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma informação adicional registrada para este evento.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {view.changedFields && (
              <div>
                <p className="text-sm text-slate-600">Campos alterados</p>
                <p className="mt-1 text-sm text-slate-900">{view.changedFields.join(', ')}</p>
              </div>
            )}
            {view.permissionsAdded && view.permissionsAdded.length > 0 && (
              <div>
                <p className="text-sm text-slate-600">Permissões adicionadas</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {view.permissionsAdded.map((label) => (
                    <li key={label} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600">{label}</li>
                  ))}
                </ul>
              </div>
            )}
            {view.permissionsRemoved && view.permissionsRemoved.length > 0 && (
              <div>
                <p className="text-sm text-slate-600">Permissões removidas</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {view.permissionsRemoved.map((label) => (
                    <li key={label} className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600">{label}</li>
                  ))}
                </ul>
              </div>
            )}
            {view.fields.map((field) => (
              <div key={field.label}>
                <p className="text-sm text-slate-600">{field.label}</p>
                <p className="mt-1 text-sm text-slate-900">{field.value}</p>
              </div>
            ))}
          </div>
        )}
      </FormSection>
    </div>
  );
}
