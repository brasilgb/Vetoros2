'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { ErrorState, friendlyError } from '../../../../components/error-state';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { AsyncButton } from '../../../../components/async-button';
import { StatusBadge, commonStatus } from '../../../../components/status-badge';
import { ConfirmDialog } from '../../../../components/confirm-dialog';
import { useSetBreadcrumb } from '../../../../components/breadcrumb-context';
import { groupPermissions, permissionLabel } from '../../../../lib/permission-labels';

type Role = { id: string; code: string; name: string; status?: string };
type Permission = { code: string; module: string; description: string | null };
type UserDetail = { id: string; name: string; status: string; email: string | null; lastLoginAt: string | null; role: Role | null; permissions: Permission[] };

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [user, setUser] = useState<UserDetail>();
  const [roles, setRoles] = useState<Role[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [fields, setFields] = useState({ name: '', roleId: '' });
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);
  const [confirmToggleOpen, setConfirmToggleOpen] = useState(false);
  const [toggleError, setToggleError] = useState('');

  const load = useCallback(async () => {
    const [detailResponse, rolesResponse] = await Promise.all([api(`/users/${id}`), api('/roles')]);
    if (!detailResponse.ok) return setState('error');
    const detail: UserDetail = await detailResponse.json();
    setUser(detail);
    setFields({ name: detail.name, roleId: detail.role?.id ?? '' });
    // ADM-02: GET /roles agora devolve papéis ativos e inativos (a tela de administração de
    // papéis precisa ver os dois). Aqui só oferecemos os ativos para atribuição — mas mantemos
    // o papel ATUAL na lista mesmo se ele tiver sido inativado depois da atribuição, senão o
    // <select> perderia o valor selecionado (seção 19 do correio.md ADM-02: papel inativo não
    // deve ser oferecido para NOVAS atribuições, o que é diferente de esconder a atribuição já
    // existente).
    if (rolesResponse.ok) {
      const allRoles: Role[] = await rolesResponse.json();
      setRoles(allRoles.filter((role) => role.status === 'active' || role.id === detail.role?.id));
    }
    setState('ready');
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useSetBreadcrumb(user?.name);

  async function confirmToggle() {
    if (!user) return;
    setToggling(true);
    setToggleError('');
    const response = await api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ status: user.status === 'active' ? 'inactive' : 'active' }) });
    setToggling(false);
    if (!response.ok) return setToggleError(friendlyError((await response.json().catch(() => ({}))).error));
    setConfirmToggleOpen(false);
    await load();
  }

  if (state === 'loading') return <p className="text-sm text-emerald-100/60">Carregando…</p>;
  if (state === 'error' || !user) return <ErrorState message="Não foi possível carregar este usuário." onRetry={load} />;

  const groups = groupPermissions(user.permissions);
  const statusTone = commonStatus(user.status);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={user.name} {...(user.email ? { description: user.email } : {})} />

      <FormSection title="Dados">
        <FormField label="Nome" htmlFor="name" span="full">
          <input id="name" className={formFieldClass} value={fields.name} onChange={(e) => setFields({ ...fields, name: e.target.value })} />
        </FormField>
        <FormField label="E-mail" htmlFor="email" helperText="Somente leitura: o e-mail é o login da pessoa e pode valer para mais de um tenant — alterá-lo aqui mudaria o acesso dela em todos eles, então esta tela não permite.">
          <input id="email" disabled className={`${formFieldClass} opacity-60`} value={user.email ?? '—'} />
        </FormField>
        <FormField label="Status" htmlFor="status">
          <div className="mt-1 flex items-center gap-3">
            <StatusBadge tone={statusTone.tone}>{statusTone.label}</StatusBadge>
            <button type="button" onClick={() => { setToggleError(''); setConfirmToggleOpen(true); }} className="rounded-xl border border-emerald-800 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-950">
              {user.status === 'active' ? 'Inativar' : 'Ativar'}
            </button>
          </div>
        </FormField>
        <div className="sm:col-span-2">
          <AsyncButton
            tone="secondary"
            label="Salvar"
            busyLabel="Salvando…"
            onClick={async () => {
              const response = await api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ name: fields.name }) });
              if (!response.ok) setError(friendlyError((await response.json().catch(() => ({}))).error));
              else await load();
            }}
          />
        </div>
      </FormSection>

      <FormSection title="Acesso">
        <FormField label="Papel" htmlFor="roleId" span="full">
          <select id="roleId" className={formFieldClass} value={fields.roleId} onChange={(e) => setFields({ ...fields, roleId: e.target.value })}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
        </FormField>
        <div className="sm:col-span-2">
          <AsyncButton
            tone="secondary"
            label="Salvar papel"
            busyLabel="Salvando…"
            disabled={!fields.roleId || fields.roleId === user.role?.id}
            onClick={async () => {
              const response = await api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ roleId: fields.roleId }) });
              if (!response.ok) setError(friendlyError((await response.json().catch(() => ({}))).error));
              else await load();
            }}
          />
        </div>
      </FormSection>

      <FormSection title="Permissões efetivas" description="Somente leitura — reflete o que o papel atual permite; não é possível ajustar permission por permission nesta versão." columns={1}>
        {groups.length === 0 ? (
          <p className="text-sm text-emerald-100/50">Este usuário não tem nenhuma permissão efetiva no momento.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.module}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-100/60">{group.label}</h3>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {group.items.map((permission) => (
                    <li key={permission.code} className="rounded-lg border border-emerald-900 px-2.5 py-1 text-xs text-emerald-100/80">
                      {permissionLabel(permission.code)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </FormSection>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmToggleOpen}
        title={user.status === 'active' ? 'Inativar usuário?' : 'Ativar usuário?'}
        description={toggleError || `${user.name} ficará ${user.status === 'active' ? 'sem acesso a este tenant' : 'com acesso restaurado'}.`}
        confirmLabel={user.status === 'active' ? 'Inativar' : 'Ativar'}
        busy={toggling}
        onConfirm={confirmToggle}
        onCancel={() => setConfirmToggleOpen(false)}
      />
    </div>
  );
}
