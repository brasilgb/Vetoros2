'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { api } from '../../../../lib/api';
import { CustomerForm } from '../customer-form';
import { PageHeader } from '../../../../components/page-header';
import { EmptyState } from '../../../../components/empty-state';
import { ErrorState } from '../../../../components/error-state';

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Record<string, string | number | null>>();
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'missing' | 'error'>('loading');

  useEffect(() => {
    void api(`/customers/${id}`).then(async (response) => {
      if (response.status === 401) return router.replace('/login');
      if (response.status === 403) return setState('denied');
      if (response.status === 404) return setState('missing');
      if (!response.ok) return setState('error');
      setData(await response.json());
      setState('ready');
    });
  }, [id, router]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {state === 'loading' && <p className="text-sm text-emerald-100/60">Carregando…</p>}
      {state === 'denied' && <EmptyState icon={Users} title="Acesso negado" description="Você não tem permissão para visualizar este cliente." />}
      {state === 'missing' && <EmptyState icon={Users} title="Cliente não encontrado" description="Ele pode ter sido removido ou o link está incorreto." />}
      {state === 'error' && <ErrorState message="Não foi possível carregar este cliente." />}
      {state === 'ready' && data && (
        <>
          <PageHeader title={`Editar cliente — #${data.customer_number}`} description={String(data.legal_name ?? '')} />
          <CustomerForm customer={data} />
        </>
      )}
    </div>
  );
}
