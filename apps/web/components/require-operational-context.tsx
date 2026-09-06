'use client';
import { Building2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useOperationalContext } from './operational-context';

// Seção 4 do correio.md UX-02: tornar a ausência de Empresa/Filial proativa, não reativa. Toda
// página de módulo que exige contexto completo (a mesma lista que hoje recebe
// `operational_context_required` da API — ver nav-config.ts) envolve seu conteúdo com isto em
// vez de deixar o usuário preencher um formulário inteiro só para descobrir o problema no submit.
// A API continua sendo a fonte final de autorização; isto é só orientação de UI.
//
// `focusContextSelectors` (seção 12 do correio.md UX-03) já resolve sozinho qual seletor focar
// em qualquer breakpoint — no desktop foca o do cabeçalho, no mobile abre o drawer e foca o de
// lá —, então este botão nunca precisa saber onde os seletores vivem.
export function RequireOperationalContext({ children }: { children: ReactNode }) {
  const { loading, hasFullContext, focusContextSelectors } = useOperationalContext();

  if (loading) return null;

  if (!hasFullContext) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-800/60 bg-amber-950/20 px-6 py-14 text-center">
        <Building2 className="h-9 w-9 text-amber-400/70" aria-hidden />
        <p className="text-base font-medium text-amber-100">Selecione uma empresa e uma filial</p>
        <p className="max-w-sm text-sm text-amber-100/70">Este módulo depende do contexto operacional. Escolha Empresa e Filial para continuar.</p>
        <button onClick={focusContextSelectors} className="rounded-xl border border-amber-700 px-4 py-2 text-sm text-amber-100 hover:bg-amber-900/30">
          Selecionar Empresa/Filial
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
