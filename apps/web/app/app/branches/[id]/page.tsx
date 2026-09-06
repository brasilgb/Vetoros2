'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { AsyncButton } from '../../../../components/async-button';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';

// GET /branches/:id passou a devolver os mesmos campos da listagem (correção da ADM-01, seção
// 19 do correio.md — antes só devolvia {id, company_id} e esta tela buscava a lista inteira
// para achar o registro; o workaround foi removido junto com a correção do endpoint).
type Branch = { id: string; name: string; code: string; company_id: string; timezone: string; is_default: boolean; status: string };

export default function BranchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [branch, setBranch] = useState<Branch>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [fields, setFields] = useState({ name: '', status: 'active' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await api(`/branches/${id}`);
    if (!response.ok) return setState('error');
    const found: Branch = await response.json();
    setBranch(found);
    setFields({ name: found.name, status: found.status });
    setState('ready');
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useSetBreadcrumb(branch ? branch.name : undefined);

  if (state === 'loading') return <p className="text-sm text-emerald-100/60">Carregando…</p>;
  if (state === 'error' || !branch) return <ErrorState message="Não foi possível carregar esta filial." onRetry={load} />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={branch.name} description={`Código: ${branch.code}`} />

      <FormSection title="Identificação">
        <FormField label="Nome" htmlFor="name" span="full">
          <input id="name" className={formFieldClass} value={fields.name} onChange={(e) => setFields({ ...fields, name: e.target.value })} />
        </FormField>
        <FormField label="Status" htmlFor="status">
          <select id="status" className={formFieldClass} value={fields.status} onChange={(e) => setFields({ ...fields, status: e.target.value })}>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>
        </FormField>
        <div className="sm:col-span-2">
          <AsyncButton
            tone="secondary"
            label="Salvar"
            busyLabel="Salvando…"
            onClick={async () => {
              const response = await api(`/branches/${id}`, { method: 'PATCH', body: JSON.stringify({ name: fields.name, status: fields.status }) });
              if (!response.ok) setError(friendlyError((await response.json().catch(() => ({}))).error));
              else await load();
            }}
          />
        </div>
      </FormSection>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
