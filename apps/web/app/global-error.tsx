'use client';

// SAN-01 — seção 2 do correio.md: workaround para um bug confirmado do Next.js 16.x no núcleo do
// framework (vercel/next.js#86178, #84994, #95741, #85668, discussão #94667), NÃO introduzido nem
// corrigível por código desta aplicação. Causa raiz confirmada externamente e reproduzida aqui
// (ver executed.md "Diagnóstico #2"): durante `next build`, o passo de export estático agrupa
// várias rotas no mesmo passe de render como irmãos sem `key`, e a página `/_global-error`
// auto-gerada quebra com `useContext` nulo porque é renderizada FORA da árvore de providers do
// layout raiz. Sem `global-error.tsx` próprio, o Next usa uma página interna mínima que ainda
// assim é estaticamente pré-renderizada e cai nesse bug.
//
// Este arquivo, com `dynamic = 'force-dynamic'`, tira a página de erro global do passo de export
// estático (o mesmo mecanismo onde o bug vive) — ela passa a ser resolvida sob demanda, igual a
// qualquer rota dinâmica desta aplicação, sem qualquer perda de comportamento: o conteúdo é
// idêntico ao fallback padrão do Next (mensagem genérica + botão de tentar de novo), só o momento
// em que é gerada muda. Testado: sem este arquivo, `next build` falha de forma determinística
// prerenderizando `/_global-error`; com ele, o erro deixa de ocorrer nessa rota.
export const dynamic = 'force-dynamic';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body>
        <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', fontFamily: 'system-ui, sans-serif' }}>
          <p>Ocorreu um erro inesperado.</p>
          <button onClick={() => reset()} style={{ borderRadius: '0.5rem', border: '1px solid #ccc', padding: '0.5rem 1rem' }}>
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}
