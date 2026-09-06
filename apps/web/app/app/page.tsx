import { PageHeader } from '../../components/page-header';

// O contexto de Empresa/Filial e o logout agora vivem no cabeçalho global (AppHeader),
// disponível em todas as páginas de "/app" através do layout do shell. Esta página não
// inventa um dashboard com métricas/gráficos (seção 34 do correio.md) — isso fica para
// um marco funcional futuro; por ora ela só recebe o usuário e aponta o menu lateral.
export default function DashboardPage() {
  return (
    <PageHeader title="Painel" description="Use o menu lateral para acessar Clientes, Ordens de Serviço, Estoque, Compras, Vendas e Administração." />
  );
}
