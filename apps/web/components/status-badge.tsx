export type StatusTone = 'success' | 'neutral' | 'info' | 'warning' | 'danger';

const toneClasses: Record<StatusTone, string> = {
  success: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  neutral: 'bg-white/8 text-emerald-100/70 ring-1 ring-inset ring-white/10',
  info: 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30',
  warning: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
  danger: 'bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30',
};

// Padrão único de badge (seção 20 do correio.md): cor nunca é a única
// diferenciação — o texto do status sempre acompanha.
export function StatusBadge({ tone, children }: { tone: StatusTone; children: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]}`}>{children}</span>;
}

const commonStatusMap: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: 'Ativo', tone: 'success' },
  inactive: { label: 'Inativo', tone: 'neutral' },
  draft: { label: 'Rascunho', tone: 'neutral' },
  open: { label: 'Aberta', tone: 'info' },
  closed: { label: 'Fechado', tone: 'neutral' },
  in_progress: { label: 'Em andamento', tone: 'info' },
  pending: { label: 'Pendente', tone: 'warning' },
  confirmed: { label: 'Confirmado', tone: 'info' },
  received: { label: 'Recebido', tone: 'success' },
  returned: { label: 'Devolvido', tone: 'warning' },
  completed: { label: 'Concluída', tone: 'success' },
  finished: { label: 'Finalizado', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'danger' },
  canceled: { label: 'Cancelado', tone: 'danger' },
  sent: { label: 'Enviado', tone: 'info' },
  approved: { label: 'Aprovado', tone: 'success' },
  rejected: { label: 'Rejeitado', tone: 'danger' },
  expired: { label: 'Expirado', tone: 'neutral' },
  partially_received: { label: 'Parcialmente recebido', tone: 'warning' },
};

/** Mapa central para significados comuns de status entre módulos. Um módulo com vocabulário próprio deve declarar seu próprio mapa e usar <StatusBadge tone> diretamente, mas reaproveitar este mapa sempre que o significado coincidir. */
export function commonStatus(status: string): { label: string; tone: StatusTone } {
  return commonStatusMap[status] ?? { label: status, tone: 'neutral' };
}
