export type StatusTone = 'success' | 'neutral' | 'info' | 'warning' | 'danger';

const toneClasses: Record<StatusTone, string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  neutral: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  info: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  warning: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
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
  // OS-ADV-02: estados operacionais da OS que ainda não tinham rótulo no mapa comum.
  awaiting_diagnosis: { label: 'Aguardando diagnóstico', tone: 'warning' },
  awaiting_approval: { label: 'Aguardando aprovação', tone: 'warning' },
  awaiting_parts: { label: 'Aguardando peças', tone: 'warning' },
  ready: { label: 'Pronta para entrega', tone: 'info' },
  delivered: { label: 'Entregue', tone: 'success' },
  // FIS-ADV-01: estados do documento fiscal que ainda não tinham rótulo no mapa comum.
  authorized: { label: 'Autorizado', tone: 'success' },
  cancellation_pending: { label: 'Cancelamento em andamento', tone: 'warning' },
};

/** Mapa central para significados comuns de status entre módulos. Um módulo com vocabulário próprio deve declarar seu próprio mapa e usar <StatusBadge tone> diretamente, mas reaproveitar este mapa sempre que o significado coincidir. */
export function commonStatus(status: string): { label: string; tone: StatusTone } {
  return commonStatusMap[status] ?? { label: status, tone: 'neutral' };
}
