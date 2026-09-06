'use client';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormActions } from '../../../../components/form-actions';
import { friendlyError } from '../../../../components/error-state';
import { groupPermissions, permissionLabel, type PermissionRef } from '../../../../lib/permission-labels';

type Permission = PermissionRef & { id: string };

// ADM-02 seção 6/18 do correio.md: o administrador só escolhe nome e marca permissions numa
// matriz agrupada por módulo — nunca digita `code` (gerado internamente pela API) nem UUID.
// Checkbox simples por módulo, sem componente sofisticado (seção 18: "para módulos com poucas
// permissions, não criar componentes sofisticados sem necessidade").
export default function NewRolePage() {
  const router = useRouter();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await api('/permissions');
      if (response.ok) setPermissions(await response.json());
    })();
  }, []);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const response = await api('/roles', { method: 'POST', body: JSON.stringify({ name, permissionIds: [...selected] }) });
    setSaving(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível criar o papel.'));
    const body = await response.json();
    router.push(`/app/roles/${body.id}`);
  }

  const groups = groupPermissions(permissions);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Novo papel" description="Papéis personalizados aparecem automaticamente no cadastro de usuários." />
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FormSection title="Identificação">
          <FormField label="Nome" htmlFor="name" span="full" helperText="Ex.: Supervisor de Oficina, Gerente de Loja.">
            <input id="name" required className={formFieldClass} value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
        </FormSection>

        <FormSection title="Permissões" description="Marque o que este papel pode fazer, agrupado por módulo." columns={1}>
          {groups.length === 0 ? (
            <p className="text-sm text-emerald-100/50">Carregando permissões…</p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => (
                <div key={group.module}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-100/60">{group.label}</h3>
                  <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
                    {group.items.map((permission) => (
                      <label key={permission.id} className="flex items-center gap-2 py-0.5 text-sm text-emerald-100">
                        <input type="checkbox" checked={selected.has(permission.id)} onChange={() => toggle(permission.id)} className="h-4 w-4 rounded border-emerald-700 bg-emerald-950 text-emerald-500 focus-visible:outline-2 focus-visible:outline-emerald-500" />
                        {permissionLabel(permission.code)}
                      </label>
                    ))}
                  </div>
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
        <FormActions saving={saving} saveLabel="Criar papel" cancelHref="/app/roles" />
      </form>
    </div>
  );
}
