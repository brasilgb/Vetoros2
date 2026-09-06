'use client';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy } from 'lucide-react';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormActions } from '../../../../components/form-actions';
import { friendlyError } from '../../../../components/error-state';

type Role = { id: string; code: string; name: string; status: string };

// ADM-01 seção 7 do correio.md: não existe infraestrutura de convite/e-mail no projeto ainda —
// "menor fluxo funcional" documentado é o administrador definir a senha inicial: a API gera uma
// senha temporária seguramente aleatória (só quando o e-mail é realmente novo — se a pessoa já
// tinha uma Identity de outro tenant, a senha dela não é tocada) e devolve em texto puro UMA
// única vez na resposta da criação, para o administrador repassar por fora do sistema. Por isso
// esta tela não redireciona sozinha: mostra a senha com um aviso claro e só segue para o
// registro quando o administrador confirmar que já anotou/repassou.
export default function NewUserPage() {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState({ name: '', email: '', roleId: '', status: 'active' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ id: string; temporaryPassword?: string }>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await api('/roles');
      // ADM-02: GET /roles agora inclui papéis inativos (a administração de papéis precisa vê-los);
      // um cadastro de usuário novo só deve oferecer papéis atribuíveis (seção 19 do correio.md).
      if (response.ok) setRoles((await response.json()).filter((role: Role) => role.status === 'active'));
    })();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const response = await api('/users', {
      method: 'POST',
      body: JSON.stringify({ name: form.name, email: form.email, roleId: form.roleId, status: form.status }),
    });
    setSaving(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível criar o usuário.'));
    const body = await response.json();
    if (body.temporaryPassword) setCreated({ id: body.id, temporaryPassword: body.temporaryPassword });
    else router.push(`/app/users/${body.id}`);
  }

  if (created) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageHeader title="Usuário criado" description="Repasse a senha temporária ao usuário por um canal seguro fora do sistema — ela não será exibida novamente." />
        <FormSection title="Senha temporária">
          <div className="sm:col-span-2 flex items-center gap-3">
            <code className="flex-1 rounded-xl border border-emerald-800 bg-emerald-950 p-3 text-sm text-emerald-50">{created.temporaryPassword}</code>
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(created.temporaryPassword ?? ''); setCopied(true); }}
              className="flex items-center gap-2 rounded-xl border border-emerald-800 px-4 py-2.5 text-sm text-emerald-100 hover:bg-emerald-950"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copiada' : 'Copiar'}
            </button>
          </div>
          <p className="sm:col-span-2 text-xs text-emerald-100/50">O usuário deve trocar essa senha assim que possível — ainda não existe troca obrigatória automática nesta versão.</p>
          <div className="sm:col-span-2">
            <button onClick={() => router.push(`/app/users/${created.id}`)} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-emerald-950">
              Já anotei, ir para o usuário
            </button>
          </div>
        </FormSection>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Novo usuário" />
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FormSection title="Dados">
          <FormField label="Nome" htmlFor="name" span="full">
            <input id="name" required className={formFieldClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <FormField label="E-mail" htmlFor="email" span="full" helperText="Se este e-mail já tiver uma conta em outro tenant, o acesso a este tenant é concedido usando a senha que a pessoa já tem.">
            <input id="email" type="email" required className={formFieldClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </FormField>
        </FormSection>
        <FormSection title="Acesso">
          <FormField label="Papel" htmlFor="roleId">
            <select id="roleId" required className={formFieldClass} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="" disabled>Selecione…</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Status" htmlFor="status">
            <select id="status" className={formFieldClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </FormField>
        </FormSection>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <FormActions saving={saving} saveLabel="Criar usuário" cancelHref="/app/users" />
      </form>
    </div>
  );
}
