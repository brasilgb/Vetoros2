# QA-01 — Descoberta de isolamento e paralelismo

Data: 2026-09-08.

## Estado anterior

- Vitest tinha apenas `testTimeout: 15_000`; `fileParallelism` permanecia no
  padrão habilitado e o número de workers era automático.
- A execução serial usada como contingência era passada por CLI com
  `--fileParallelism=false`; não estava gravada nos scripts nem na configuração.
- Os 23 arquivos API abrem suas próprias instâncias de app/conexões em
  `beforeAll` e fecham em `afterAll`. Não há `beforeEach` global, banco por worker,
  schema por worker ou rollback automático.
- Todos compartilham os dois tenants, empresas, filiais, usuários e clientes do
  seed. A maioria dos dados criados usa UUID, nomes, documentos, SKUs e chaves
  idempotentes exclusivas. Listagens normalmente pesquisam pelo marcador criado.
- Counters globais de cliente, OS, venda e documentos são exercitados sob
  concorrência; os testes não devem assumir seu valor inicial.
- Reports e Receivables usam datas fixas, porém vinculam suas assertions aos IDs
  e origens criados pelo próprio caso. Receivables não altera fixtures seedadas.

## Reprodução

- Paralelismo automático no ambiente de 4,8 GiB: processo terminou com `SIGBUS`
  antes de produzir resultado de testes, evidenciando excesso de workers/memória.
- Paralelismo entre arquivos limitado a quatro workers: 23/23 arquivos e 312/312
  testes passaram em 50,60 s.
- A serialização global anterior evitava tanto a pressão de memória quanto janelas
  de mutação compartilhada, mas custava paralelismo e não corrigia as fixtures.

## Fragilidades encontradas e decisão

- `reports.integration.test.ts` desativava temporariamente a filial Alpha principal,
  usada pela maioria dos arquivos. Isso podia transformar operações simultâneas
  em `409`.
- `auth.integration.test.ts` suspendia a membership Beta de
  `shared@vetoros.local`, identidade usada em verificações de contexto.
- `customers.integration.test.ts` criava grant e suspendia a membership Alpha da
  mesma identidade compartilhada.
- O teste concorrente de números de cliente consulta o intervalo completo no
  banco, portanto aceita inserções intercaladas legítimas de outros arquivos e
  ainda prova unicidade/continuidade global do counter.

A solução mantém um banco compartilhado e paralelismo entre arquivos, limita a
quatro workers por capacidade observada e troca mutações globais por fixtures
exclusivas. Um helper cria identidade, memberships e profiles únicos. Reports
cria uma filial UUID exclusiva para validar contexto inativo. Não são usados
sleeps, retries, skips, serialização global ou redução de assertions.
