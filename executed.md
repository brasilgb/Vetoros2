# Execução de correio.md

Data: 2026-09-10

## Comparação

`correio.md` mudou de novo: marco novo, `FIS-ADV-01 — Fiscal Operacional Completo`, uma área genuinamente nova (nenhum marco anterior tinha tocado em nada fiscal/tributário) — diferente das últimas rodadas, que eram auditorias sobre domínio já maduro.

## FIS-ADV-01 — Fiscal Operacional Completo

### Descoberta

Busca completa por todos os termos da seção 3 (fiscal, NF-e/NFC-e/NFS-e, Focus NFe, SEFAZ, CFOP/CST/CSOSN/ICMS/IPI/PIS/COFINS/ISS, inscrição estadual/municipal, regime tributário etc.) em migrations, API, Web e docs. **Não havia nenhuma estrutura fiscal persistida** — só um `role template` `fiscal` reservado desde o seed inicial (migration 0001), nunca populado com nenhuma permission.

O que já existia e era diretamente reutilizável (nada foi duplicado):

- **Emitente**: `companies` já tinha `tax_id_type`/`tax_id_normalized` (CNPJ), `state_registration`, `municipal_registration`, `tax_regime` (coluna já existente, sem validação) e endereço completo. `branches` já tinha endereço completo próprio.
- **Destinatário**: `customers` já representa PF/PJ (`person_type`, `document_type`/`document_normalized`, `rg_state_registration`, `municipal_registration`) com `customer_addresses` completo (CEP/rua/número/complemento/bairro/cidade/UF/país) — cobre a seção 5 inteira sem alterar nada.
- **Produto**: `inventory_parts` já tinha `ncm` (de CAD-01) e `barcode_ean` (que já serve como GTIN).
- **Origem/rastreabilidade**: o padrão de FK composta same-tenant + `check` de origem exatamente-uma (já usado por `receivables`) era diretamente aplicável a documento fiscal → venda/OS.

### Lacunas reais

1. Nenhuma tabela para representar um documento fiscal em si (número, série, status, chave, protocolo, snapshot).
2. `companies` sem CNAE nem ambiente fiscal (homologação/produção); `branches` sem código IBGE do município.
3. `inventory_parts` sem CEST, origem da mercadoria, CFOP padrão.
4. Nenhuma máquina de estados fiscal, nenhuma imutabilidade pós-autorização.
5. Nenhuma abstração de provedor fiscal — logo nenhuma integração (nem estrutural) com a Focus NFe.
6. Nenhuma permission fiscal populada, nenhuma tela.

### Implementado

**Banco** (`packages/db/migrations/0034_fis_adv01_fiscal.sql`):
- `companies`: +`cnae`, +`fiscal_environment` (`homologacao`/`producao`, default homologação — nunca emite em produção "por acidente"), `check` novo em `tax_regime` (simples/simples com excesso/presumido/real/MEI — coluna já existia, sem validação até agora).
- `branches`: +`ibge_city_code`. **Decisão de domínio (seção 4)**: identidade fiscal (CNPJ/IE/IM/regime/CNAE/ambiente) pertence à **empresa**; o **endereço/município usado no documento é o da filial emissora** — toda venda/OS já carrega `company_id` **e** `branch_id`, é a filial que fisicamente realiza a operação. Não criei tabela de "emitente" separada.
- `inventory_parts`: +`cest`, +`origin` (0–8, código de origem da mercadoria), +`default_cfop` (só um valor de partida para a emissão preencher sozinha — nunca a fonte de verdade da operação real, que é decidida no documento).
- `fiscal_documents`/`fiscal_document_items`: origem exatamente-uma (venda XOR OS), **numeração nunca local** (`document_number`/`series` nascem `null`, só o provedor os atribui na autorização — nenhum contador foi criado), snapshot completo do destinatário e dos itens no momento da criação, totais congelados.
- Máquina de estados por trigger único (mesmo padrão de OS-ADV-02/migration 0033): `draft→pending→authorized|rejected`, `rejected→pending` (nova tentativa), `authorized→cancellation_pending→authorized|cancelled`. `cancelled` é terminal de verdade.
- Imutabilidade física: depois que a emissão é solicitada (`status` fora de `draft`/`rejected`), nenhuma alteração de conteúdo (totais, destinatário, itens) é aceita pelo banco — testado com `UPDATE`/`DELETE` diretos via SQL.
- RLS forçado + `revoke delete` em `fiscal_documents` (nunca `DELETE`, só `cancelled`).
- Permissions `fiscal.read`/`fiscal.create`/`fiscal.issue`/`fiscal.cancel` adicionadas ao role template `fiscal` já existente — nenhum namespace novo.

**API**:
- `apps/api/src/fiscal/provider.ts`: interface `FiscalProvider` (`issue`/`consult`/`cancel`) + `FocusNfeProvider` — autenticação HTTP Basic com o token como usuário (contrato público estável da Focus NFe), `ref` como referência idempotente. Sem `FOCUS_NFE_API_KEY` configurada, responde `fiscal_provider_not_configured` de forma recuperável — nunca finge uma emissão.
- `apps/api/src/fiscal/fake-provider.ts`: usado exclusivamente pelos testes (seção 28) — fila explícita (`enqueueIssueResult`/`enqueueCancelResult`) para o teste decidir autorizar/rejeitar/errar sem nenhuma chamada de rede.
- `apps/api/src/fiscal/routes.ts`: `GET /fiscal-documents`, `GET /fiscal-documents/:id`, `POST /fiscal-documents` (cria em `draft`, só a partir de venda **confirmada** ou OS **concluída/entregue** — nunca de aprovação de orçamento), `POST /fiscal-documents/:id/issue`, `POST /fiscal-documents/:id/consult`, `POST /fiscal-documents/:id/cancel`.
- **Emissão em duas fases** (seção 21/22): fase 1 reivindica atomicamente (`draft/rejected→pending`, lock rápido, sem rede) — uma segunda tentativa concorrente já encontra `pending` e nunca chama o provedor; fase 2 chama o provedor **fora** da transação (não segura lock de linha durante I/O de rede) e aplica o resultado com guard `where status='pending'` (protege contra dupla aplicação).
- **Cancelamento nunca é `status='cancelled'` local puro** (seção 19): passa por `cancellation_pending`, só vira `cancelled` quando o provedor confirma; se o provedor rejeitar, volta para `authorized`.

**Web**: `/app/fiscal` (lista com filtros de status/tipo/origem/busca, diálogo de emissão escolhendo venda confirmada ou OS concluída via busca) e `/app/fiscal/[id]` (situação, origem com link para a venda/OS, destinatário, itens, totais, chave/protocolo, motivo de rejeição, linha do tempo de eventos, ações Emitir/Consultar/Cancelar conforme o status). Item novo no menu lateral.

**Testes**: `packages/db/tests/fis-adv01-contract.test.ts` (7) + `apps/api/tests/fiscal-documents.integration.test.ts` (16) — criação com cliente PF/PJ, criação de NFS-e só a partir de OS entregue (nunca aberta), autorização, rejeição com nova tentativa, recuperação via consulta depois de erro do provedor (nunca assume "não emitido"), concorrência (duplo clique só aciona o provedor uma vez), cancelamento e cancelamento rejeitado pelo provedor, imutabilidade física pós-autorização, venda/estoque nunca corrompidos por falha fiscal, isolamento cross-tenant, RBAC negativo.

### Reutilizado (nada foi duplicado)

`companies`/`branches`/`customers`/`customer_addresses`/`inventory_parts` para toda a identidade fiscal; `sales`/`service_orders` como única origem possível; o padrão de trigger de máquina de estados e de imutabilidade já usado em OS-ADV-02; o padrão de permission dedicada por ação (`.issue`/`.cancel`, mesmo estilo de `.confirm`/`.approve`); o mecanismo de auditoria já existente (`service.auditResource`) para os eventos fiscais — nenhuma tabela de auditoria paralela.

## Resultado

```text
NF-e: PARCIAL
NFC-e: PARCIAL
NFS-e: PARCIAL
```
O modelo de domínio, a máquina de estados, a imutabilidade, a numeração-pelo-provedor e a API/Web estão completos e idênticos para os três tipos (`document_type` é o único diferencial). O que falta para "SIM" pleno é o mesmo em todos: validação do payload exato contra a Focus NFe real (abaixo).

```text
Integração Focus NFe: PARCIAL
```
`FiscalProvider`/`FocusNfeProvider` existem, com autenticação/idempotência corretas (contrato público estável da Focus NFe), mas **não há credencial de homologação disponível neste ambiente** para validar o mapeamento exato de payload/resposta contra a API real (seção 28 antecipa exatamente esse cenário — testes usam `FakeFiscalProvider`, nunca rede real). Está isolado atrás da interface `FiscalProvider`, então validar/ajustar o adapter não toca em nenhuma rota, trigger ou tela.

```text
PDV → Fiscal: PARCIAL
```
O domínio e a API suportam perfeitamente o fluxo (criar documento a partir da venda que o PDV acabou de confirmar, emitir). Não adicionei um botão "Emitir NFC-e" na tela de comprovante do PDV nesta rodada — o checkout atômico de venda/estoque/pagamento (seção 17) permanece deliberadamente independente da disponibilidade fiscal; a ação de emitir já existe em `/app/fiscal`, faltando só o atalho de UX a partir do comprovante do PDV.

```text
OS → Fiscal: SIM
```
NFS-e só pode nascer de OS `completed`/`delivered` — nunca de aprovação de orçamento — já testado.

### Idempotência

`idempotency_key` nasce no servidor na criação do documento (nunca do cliente) e é a mesma referência (`externalRef`) enviada ao provedor em toda tentativa de emissão — retry depois de erro/timeout nunca duplica, porque é sempre a mesma referência do lado de fora. Testado: erro do provedor → documento fica `pending` → `/consult` reconcilia sem nunca assumir "não emitido".

### Concorrência

Duas requisições de emissão simultâneas sobre o mesmo rascunho: só uma reivindica a transição `draft→pending` (lock rápido) e chama o provedor; a outra recebe 409 antes de qualquer chamada de rede. Testado e confirmado (`fiscalProvider.issueCalls` == 1).

### RBAC

`fiscal.read`/`fiscal.create`/`fiscal.issue`/`fiscal.cancel`, mapeadas ao role template `fiscal` já reservado. Testado negativamente: sem `fiscal.create` → 403 na criação; sem `fiscal.issue` → 403 na emissão, documento permanece `draft`.

### RLS

Forçado em `fiscal_documents`/`fiscal_document_items`, mesmo padrão de toda a base. Testado: documento de outro tenant é invisível (`GET`/`issue` → 404) e não aparece na listagem, mesmo com o UUID real conhecido.

### Testes

```text
DB: 260/260 PASS (7 novos — fis-adv01-contract.test.ts)
API: 373/373 PASS (16 novos — fiscal-documents.integration.test.ts)
lint: PASS
typecheck: PASS
build: PASS (inclui /app/fiscal e /app/fiscal/[id])
git diff --check: PASS
```

Todos reproduzidos em ambiente Docker Compose oficial resetado do zero (`down -v && up -d --build`), hostname `postgres` em todas as conexões internas. Nenhuma falha pré-existente apareceu para investigar.

### Limitações reais restantes

1. **Payload exato da Focus NFe não validado contra sandbox real** — é o único item que impede "SIM" pleno em NF-e/NFC-e/NFS-e/Integração. Precisa de uma credencial de homologação real para ajustar/confirmar o mapeamento de campos de `FocusNfeProvider` antes do primeiro uso em produção.
2. **Sem atalho "Emitir NFC-e" no comprovante do PDV** — a ação já existe em `/app/fiscal`, só falta o link direto a partir da tela de finalização do PDV-ADV-01 (deliberadamente não acoplado ao checkout atômico).
3. **NFS-e**: código de serviço/item da LC 116/alíquota ISS ficam em branco por padrão (`fiscal_document_items.service_code`/`iss_rate`), preenchidos manualmente se necessário — não construí nenhum motor de tributação municipal automático (proibido pela seção 32).

Nada disso bloqueia o marco: são exatamente os pontos que a seção 46 antecipa como aceitáveis para `DONE` (infraestrutura correta e operacional, com o provedor real como próxima validação externa).

## Conclusão

FIS-ADV-01 APROVADO E ENCERRADO

Não foi feito commit por mim. Durante a execução, um commit externo ("Push", fora desta conversa) arquivou o trabalho já concluído no repositório — não foi uma ação minha; o conteúdo do `correio.md` usado corresponde exatamente ao commitado.
