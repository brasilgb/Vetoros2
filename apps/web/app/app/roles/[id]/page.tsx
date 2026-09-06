'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { AsyncButton } from '../../../../components/async-button';
import { StatusBadge, commonStatus } from '../../../../components/status-badge';
import { ConfirmDialog } from '../../../../components/confirm-dialog';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { groupPermissions, permissionLabel, type PermissionRef } from '../../../../lib/permission-labels';

type Permission = PermissionRef & { id: string };
type RoleDetail = { id: string; code: string; name: string; isSystemManaged: boolean; status: string; grantCount: number; permissionIds: string[] };

export default function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [role, setRole] = useState<RoleDetail>();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);
  const [confirmToggleOpen, setConfirmToggleOpen] = useState(false);
  const [toggleError, setToggleError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const load = useCallback(async () => {
    const [detailResponse, permissionsResponse] = await Promise.all([api(`/roles/${id}`), api('/permissions')]);
    if (!detailResponse.ok) return setState('error');
    const detail: RoleDetail = await detailResponse.json();
    setRole(detail);
    setName(detail.name);
    setSelected(new Set(detail.permissionIds));
    if (permissionsResponse.ok) setPermissions(await permissionsResponse.json());
    setState('ready');
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useSetBreadcrumb(role?.name);

  function toggle(permissionId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return next;
    });
  }

  async function confirmToggleStatus() {
    if (!role) return;
    setToggling(true);
    setToggleError('');
    const response = await api(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify({ status: role.status === 'active' ? 'inactive' : 'active' }) });
    setToggling(false);
    if (!response.ok) return setToggleError(friendlyError((await response.json().catch(() => ({}))).error));
    setConfirmToggleOpen(false);
    await load();
  }

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError('');
    const response = await api(`/roles/${id}`, { method: 'DELETE' });
    setDeleting(false);
    if (!response.ok) return setDeleteError(friendlyError((await response.json().catch(() => ({}))).error));
    router.push('/app/roles');
  }

  if (state === 'loading') return <p className="text-sm text-emerald-100/60">Carregando…</p>;
  if (state === 'error' || !role) return <ErrorState message="Não foi possível carregar este papel." onRetry={load} />;

  const groups = groupPermissions(permissions);
  const statusTone = commonStatus(role.status);
  const readOnly = role.isSystemManaged;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={role.name} description={readOnly ? 'Papel de sistema' : `${role.grantCount} usuário(s) com este papel`} />

      {readOnly && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100/80">
          <Lock className="h-4 w-4 shrink-0 text-emerald-100/50" aria-hidden />
          Papéis de sistema não podem ser renomeados, ter suas permissões alteradas, inativados ou excluídos.
        </div>
      )}

      <FormSection title="Identificação">
        <FormField label="Nome" htmlFor="name" span="full">
          <input id="name" disabled={readOnly} className={`${formFieldClass} ${readOnly ? 'opacity-60' : ''}`} value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        {!readOnly && (
          <FormField label="Status" htmlFor="status">
            <div className="mt-1 flex items-center gap-3">
              <StatusBadge tone={statusTone.tone}>{statusTone.label}</StatusBadge>
              <button type="button" onClick={() => { setToggleError(''); setConfirmToggleOpen(true); }} className="rounded-xl border border-emerald-800 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-950">
                {role.status === 'active' ? 'Inativar' : 'Ativar'}
              </button>
            </div>
          </FormField>
        )}
      </FormSection>

      <FormSection title="Permissões" description={readOnly ? 'Somente leitura.' : 'Marque o que este papel pode fazer, agrupado por módulo.'} columns={1}>
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.module}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-100/60">{group.label}</h3>
              <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
                {group.items.map((permission) =>
                  readOnly ? (
                    selected.has(permission.id) && (
                      <span key={permission.id} className="rounded-lg border border-emerald-900 px-2.5 py-1 text-xs text-emerald-100/80">
                        {permissionLabel(permission.code)}
                      </span>
                    )
                  ) : (
                    <label key={permission.id} className="flex items-center gap-2 py-0.5 text-sm text-emerald-100">
                      <input type="checkbox" checked={selected.has(permission.id)} onChange={() => toggle(permission.id)} className="h-4 w-4 rounded border-emerald-700 bg-emerald-950 text-emerald-500 focus-visible:outline-2 focus-visible:outline-emerald-500" />
                      {permissionLabel(permission.code)}
                    </label>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </FormSection>

      {!readOnly && (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => { setDeleteError(''); setConfirmDeleteOpen(true); }}
            className="rounded-xl border border-red-800 px-4 py-2.5 text-sm text-red-300 hover:bg-red-950/40"
          >
            Excluir papel
          </button>
          <AsyncButton
            tone="secondary"
            label="Salvar"
            busyLabel="Salvando…"
            onClick={async () => {
              const response = await api(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify({ name, permissionIds: [...selected] }) });
              if (!response.ok) setError(friendlyError((await response.json().catch(() => ({}))).error));
              else await load();
            }}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmToggleOpen}
        title={role.status === 'active' ? 'Inativar papel?' : 'Ativar papel?'}
        description={toggleError || `${role.name} ficará ${role.status === 'active' ? 'indisponível para novas atribuições' : 'disponível para atribuição novamente'}.`}
        confirmLabel={role.status === 'active' ? 'Inativar' : 'Ativar'}
        busy={toggling}
        onConfirm={confirmToggleStatus}
        onCancel={() => setConfirmToggleOpen(false)}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Excluir papel?"
        description={deleteError || `"${role.name}" será excluído permanentemente. Só é possível excluir um papel que nunca foi atribuído a ninguém.`}
        confirmLabel="Excluir"
        tone="destructive"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
