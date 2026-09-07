import type { Metadata } from 'next';
import './globals.css';

// SAN-01 — seção 2 do correio.md: `dynamic = 'force-dynamic'` no layout raiz se propaga para
// TODAS as rotas descendentes que não sobrescrevem a própria configuração (Next.js resolve o
// segment config efetivo por herança layout -> página). Correto para esta aplicação
// independentemente do bug abaixo: toda página vive atrás de login, sessão e contexto
// operacional resolvidos em runtime (cookies/tenant ativo) — nenhuma delas tem conteúdo válido
// para pré-renderizar em build time; geração estática nunca foi um objetivo real aqui.
//
// O motivo imediato de adicionar isto agora é um bug confirmado do núcleo do Next.js 16.x
// (vercel/next.js#86178, #84994, #95741, #85668, discussão #94667 — ver executed.md "Diagnóstico
// #2"): o passo de EXPORT ESTÁTICO do `next build` agrupa múltiplas rotas no mesmo passe de
// render como irmãos sem `key`, e isso quebra com `useContext` nulo em rotas arbitrárias
// (`/_global-error` sempre, e outras rotas dependendo do agendamento dos workers — no nosso
// build, consistentemente `/app/purchase-receipts`). Tirar as rotas do PRÓPRIO PASSO onde o bug
// vive (`force-dynamic` = nunca entra no export estático) é a correção que trata a causa, não um
// `.next` limpo nem uma tentativa de mascarar o sintoma — confirmado reproduzindo o erro em
// árvore limpa, testando build Turbopack e webpack (os dois quebram), uma única cópia de
// react/react-dom no workspace inteiro (sem múltiplas cópias), e isolando o defeito exatamente ao
// passo de export estático (`--experimental-build-mode=compile`, que pula esse passo, builda sem
// erro). `/_global-error` continua afetado por ser gerado independentemente da árvore de rotas
// (ver `app/global-error.tsx`, que já declara `force-dynamic` por conta própria pela mesma razão,
// embora sozinho não bastasse sem isto aqui).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'VetorOS 2', description: 'Fundação segura para gestão de assistências técnicas.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
