import { AlertTriangle } from 'lucide-react';

// Estados de erro compreensíveis (seção 18 do correio.md): nunca expor SQLSTATE, stack trace ou mensagem interna crua.
export function ErrorState({ message, onRetry }: { message: string; onRetry?: (() => void) | undefined }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-red-900/60 bg-red-950/20 px-6 py-14 text-center">
      <AlertTriangle className="h-9 w-9 text-red-400/70" aria-hidden />
      <p className="max-w-sm text-sm text-red-200">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="rounded-xl border border-red-800 px-4 py-2 text-sm text-red-200 hover:bg-red-900/30">
          Tentar novamente
        </button>
      )}
    </div>
  );
}

/** Traduz códigos de erro técnicos conhecidos da API para mensagens compreensíveis; usa um texto padrão quando o código não é reconhecido. */
export function friendlyError(code: string | undefined, fallback = 'Não foi possível concluir a operação. Tente novamente.'): string {
  const map: Record<string, string> = {
    document_already_exists: 'Já existe um registro com este CPF/CNPJ.',
    invalid_document: 'CPF/CNPJ inválido.',
    insufficient_or_invalid_quantity: 'Quantidade indisponível ou inválida.',
    not_found: 'Registro não encontrado.',
    forbidden: 'Você não tem permissão para esta ação.',
    operational_context_required: 'Selecione uma empresa e uma filial no cabeçalho para continuar.',
    tenant_required: 'Selecione um tenant para continuar.',
    membership_already_exists: 'Este e-mail já tem acesso a este tenant.',
    invalid_role: 'Selecione um papel válido.',
    last_administrator_protected: 'O tenant precisa manter ao menos um administrador ativo.',
    membership_inactive: 'Seu acesso a este tenant foi desativado.',
    role_name_already_exists: 'Já existe um papel com este nome.',
    invalid_permission: 'Uma ou mais permissões selecionadas são inválidas.',
    system_role_protected: 'Papéis de sistema não podem ser alterados ou excluídos.',
    role_in_use: 'Este papel já foi atribuído a algum usuário — inative-o em vez de excluir.',
    register_name_already_exists: 'Já existe um caixa com este nome nesta filial.',
    register_already_open: 'Este caixa já está aberto.',
    session_not_open: 'Esta sessão de caixa não está aberta.',
    idempotency_conflict: 'Esta operação já foi registrada com dados diferentes. Atualize a página e tente novamente.',
    invalid_origin_or_payment_method: 'Venda, ordem de serviço ou forma de pagamento inválida.',
    insufficient_session_balance: 'Saldo do caixa é insuficiente para este estorno.',
    refund_already_applied: 'Este recebimento já foi estornado.',
    sale_has_active_payments: 'Esta venda tem recebimentos sem estorno — estorne-os antes de cancelar.',
    service_order_has_active_payments: 'Esta ordem de serviço tem recebimentos sem estorno — estorne-os antes de cancelar.',
  };
  return (code && map[code]) || fallback;
}
