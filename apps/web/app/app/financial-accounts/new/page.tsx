'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/page-header';
import { FormSection, FormField, formFieldClass } from '../../../../components/form-section';
import { FormActions } from '../../../../components/form-actions';
import { friendlyError } from '../../../../components/error-state';
import { RequireOperationalContext } from '../../../../components/require-operational-context';

// FIN-04, seção 25.2 do correio.md: "como é entidade administrativa relevante e possui vários
// campos, não usar modal para o cadastro principal" — mesmo critério de Contas a Pagar (FIN-03).
// Saldo inicial (seção 12) NUNCA é um campo de cadastro aqui — não existe no formulário porque
// não é atributo da conta; quando necessário, é lançado como uma movimentação própria
// (`opening_balance`) a partir da tela de detalhe, depois que a conta já existe.
export default function NewFinancialAccountPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [bankName, setBankName] = useState('');
  const [branchNumber, setBranchNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountDigit, setAccountDigit] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError('');
    const response = await api('/financial-accounts', { method: 'POST', body: JSON.stringify({
      name,
      bankCode: bankCode || null, bankName: bankName || null, branchNumber: branchNumber || null,
      accountNumber: accountNumber || null, accountDigit: accountDigit || null, pixKey: pixKey || null,
    }) });
    setSaving(false);
    if (!response.ok) return setError(friendlyError((await response.json().catch(() => ({}))).error, 'Não foi possível criar a conta financeira.'));
    router.push(`/app/financial-accounts/${(await response.json()).id}`);
  }

  return (
    <RequireOperationalContext>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageHeader title="Nova conta financeira" description="Conta bancária ou financeira da empresa — nunca uma forma de pagamento." />
        <form onSubmit={submit} className="flex flex-col gap-5">
          <FormSection title="Identificação">
            <FormField label="Nome" htmlFor="name" span="full">
              <input id="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={formFieldClass} placeholder="Ex.: Banco do Brasil — Conta corrente" />
            </FormField>
          </FormSection>

          <FormSection title="Dados bancários (opcional)" description="Só cadastrais — nunca senha, token, certificado ou credencial de acesso ao banco.">
            <FormField label="Banco" htmlFor="bank-name">
              <input id="bank-name" maxLength={120} value={bankName} onChange={(e) => setBankName(e.target.value)} className={formFieldClass} placeholder="Ex.: Banco do Brasil" />
            </FormField>
            <FormField label="Código do banco" htmlFor="bank-code">
              <input id="bank-code" maxLength={20} value={bankCode} onChange={(e) => setBankCode(e.target.value)} className={formFieldClass} placeholder="Ex.: 001" />
            </FormField>
            <FormField label="Agência" htmlFor="branch-number">
              <input id="branch-number" maxLength={20} value={branchNumber} onChange={(e) => setBranchNumber(e.target.value)} className={formFieldClass} />
            </FormField>
            <FormField label="Conta" htmlFor="account-number">
              <input id="account-number" maxLength={30} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className={formFieldClass} />
            </FormField>
            <FormField label="Dígito" htmlFor="account-digit">
              <input id="account-digit" maxLength={5} value={accountDigit} onChange={(e) => setAccountDigit(e.target.value)} className={formFieldClass} />
            </FormField>
            <FormField label="Chave PIX" htmlFor="pix-key">
              <input id="pix-key" maxLength={160} value={pixKey} onChange={(e) => setPixKey(e.target.value)} className={formFieldClass} placeholder="CPF/CNPJ, e-mail, telefone ou chave aleatória" />
            </FormField>
          </FormSection>

          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          <FormActions saving={saving} saveLabel="Criar conta financeira" cancelHref="/app/financial-accounts" />
        </form>
      </div>
    </RequireOperationalContext>
  );
}
