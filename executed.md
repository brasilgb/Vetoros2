# Resumo de execução — correio.md (COM-01 — Fornecedores)

**Data:** 5 de setembro de 2026
**Projeto:** `vetoros2`
**Status:** concluído para revisão, sem commit.

O `correio.md` estava diferente da rodada anterior (trocou de OS-02 para COM-01 —
Fornecedores). A implementação de COM-01 já existia parcialmente na árvore de
trabalho (não commitada), mas nunca havia sido migrada, semeada, buildada nem
testada — o `executed.md` anterior estava vazio. Esta rodada completou a
execução e corrigiu um defeito real encontrado no caminho.

## 1. Descoberta

Respostas às perguntas obrigatórias do `correio.md`:

1. **Existe entidade que represente fornecedores de forma inequívoca?** Não.
   `customers`, `inventory_parts` e `stock_movements` foram revisados; nenhum
   modela fornecedor.
2. **`customers` pode ser reutilizado?** Não. Cliente e fornecedor têm
   domínios distintos (CRM × Suprimentos); a semelhança cadastral (PF/PJ,
   CPF/CNPJ, endereço, contato) não justifica acoplamento.
3. **Fornecedor pertence a Tenant, Company ou Branch?** Tenant, conforme
   exigido.
4. **Há necessidade real de vínculo fornecedor × Branch nesta etapa?** Não.
5. **Padrões reutilizados sem duplicação:** a validação/normalização de
   CPF/CNPJ foi extraída de `customers/routes.ts` para
   `apps/api/src/shared/br-documents.ts` (`onlyDigits`, `validCpf`,
   `validCnpj`, `normalizeBrazilianDocument`) e passou a ser usada tanto por
   `customers` quanto por `suppliers`; os padrões de RLS fail-closed, FKs
   compostas same-tenant, numeração sequencial transacional e auditoria
   append-only seguem exatamente o modelo de CRM-01/OS-01.

## 2. Decisão arquitetural

Fornecedor implementado como entidade própria do domínio de Suprimentos,
pertencente ao **Tenant**, sem vínculo com Branch e sem qualquer estrutura de
compras, recebimento, contas a pagar, custo médio, lote, serialização ou
fiscal — conforme restrição de escopo do COM-01.

## 3. Migration e entidades

`packages/db/migrations/0012_suppliers.sql`:

- `supplier_number_counters` — contador sequencial por tenant, incrementado
  transacionalmente via `on conflict ... do update`;
- `suppliers` — `person_type` (individual/company), `legal_name`,
  `trade_name`, documento normalizado com `document_type` amarrado ao
  `person_type`, inscrições estadual/municipal, `status`
  (`active`/`inactive`), auditoria de criador/atualizador;
- `supplier_addresses` — tipos `commercial`/`billing`/`shipping`/`other`,
  endereço principal garantido por índice único parcial
  (`is_primary` por fornecedor);
- `supplier_contacts` — tipos `phone`/`mobile`/`whatsapp`/`email`/`other`,
  valor normalizado, principal único por tipo (índice parcial).

Integridade: FKs compostas `(tenant_id, id)`/`(tenant_id, supplier_id)`
referenciando `suppliers(tenant_id, id)`, unicidade de documento por tenant
(`suppliers_document_uq`), checks de PF/PJ coerentes com o tipo de documento.

## 4. RLS

Todas as quatro tabelas novas têm RLS habilitado e **forçado**, com política
única `tenant_id = vetoros_current_tenant_id()` em `using`/`with check`
(mesmo mecanismo fail-closed do DB-01, herdado por todos os módulos
anteriores). Nenhuma concede `delete`. Validado por
`packages/db/tests/suppliers-contract.test.ts` (verificação estrutural da
migration) e, na camada genérica, por `postgres-integration.test.ts` /
`tenant-context.test.ts`, que provam runtime sem `BYPASSRLS` e isolamento por
`app.tenant_id` — o mesmo padrão de cobertura já usado por CRM-02/OS-01/EST-01
neste repositório (contrato estrutural por migration + prova funcional
genérica na camada de multitenancy).

## 5. RBAC

Permissões criadas: `suppliers.read`, `suppliers.create`, `suppliers.update`
(adicionadas ao seed de templates). Nenhuma permissão de compras/estoque foi
criada. Aplicadas de forma consistente em todas as rotas da API.

## 6. Auditoria

Eventos registrados no mecanismo append-only existente (`auditResource`):
`supplier.created`, `supplier.updated`, `supplier.status_changed`,
`supplier.address.created`, `supplier.address.updated`,
`supplier.contact.created`, `supplier.contact.updated`.

## 7. API (`apps/api/src/suppliers/routes.ts`)

- `GET /suppliers` — busca (nome, fantasia, número, documento), paginação,
  ordenação, filtro por status;
- `GET /suppliers/:id` — detalhe com endereços e contatos;
- `POST /suppliers` — criação com numeração sequencial transacional e
  validação de CPF/CNPJ;
- `PATCH /suppliers/:id` — atualização parcial, bloqueando `id`/`tenantId`;
- `GET/POST /suppliers/:id/addresses`, `PATCH /suppliers/:id/addresses/:childId`;
- `GET/POST /suppliers/:id/contacts`, `PATCH /suppliers/:id/contacts/:childId`.

Exclusão física não implementada — desativação ocorre por `status`.

### Bug encontrado e corrigido

A implementação encontrada na árvore de trabalho tinha um defeito real: nos
`UPDATE`s de `suppliers`, `supplier_addresses` e `supplier_contacts`, os
templates SQL do Drizzle concatenavam `then`/`else`/`and`/`returning`
diretamente colados a um parâmetro (`$3then$4else`, `$1and`, `$15returning`),
o que o Postgres rejeitava com `trailing junk after parameter`. Isso quebrava
em runtime **toda atualização de fornecedor, endereço ou contato** com
HTTP 500. Corrigido adicionando os espaços que faltavam em
`apps/api/src/suppliers/routes.ts`; rebuild da imagem Docker e nova rodada de
testes confirmaram a correção (ver seção 9).

## 8. Frontend

- `/app/suppliers` — listagem (número, razão social, fantasia, CPF/CNPJ,
  contato principal, status);
- `/app/suppliers/new` — criação;
- `/app/suppliers/:id` — detalhe/edição, endereços, contatos e
  ativar/inativar.

Presentes no build de produção do Next.js (rotas listadas no `next build`).

## 9. Validação final

- **Build Docker de produção:** OK (`docker compose build`), incluindo as
  rotas `/app/suppliers*` no `next build`;
- **Migration 0012:** aplicada com sucesso (`docker compose up -d` →
  `migrate` saiu com código 0); tabelas `suppliers`, `supplier_addresses`,
  `supplier_contacts`, `supplier_number_counters` confirmadas no Postgres;
- **Seed:** `Exited (0)`, permissões `suppliers.*` carregadas;
- **Lint:** `pnpm -r lint` — OK, sem warnings novos;
- **Typecheck:** `pnpm -r typecheck` — OK;
- **Testes DB:** **79/79** (`packages/db` — 9 arquivos, incluindo
  `suppliers-contract.test.ts` com 8 testes);
- **Testes API:** **65/65** (`apps/api` — 10 arquivos, incluindo
  `suppliers.integration.test.ts` com 8 testes, todos verdes após a correção
  do bug de SQL);
- **Health:** `{"status":"ok"}` em `http://localhost:3001/health`;
- **Frontend:** `http://localhost:3000/login` → HTTP 200;
  `http://localhost:3000/app/suppliers` e `/app/suppliers/new` → HTTP 307
  (redirecionamento esperado para autenticação);
- API e web saudáveis (`docker compose ps`); PostgreSQL e Redis apenas na
  rede interna, sem publicação no host.

DB-01, AUTH-01, CORE-01, CRM-01, CRM-02, OS-01, OS-02, CRM-03, EST-01 e EST-02
permanecem preservados (suas suítes de teste continuam 100% verdes na mesma
execução). `vetoros1` não foi alterado. Nenhum commit foi criado.

## 10. Itens explicitamente não implementados

Conforme restrição de escopo do COM-01: pedido de compra, cotação de
fornecedores, recebimento, entrada automática de estoque, contas a pagar,
financeiro, custo médio, FIFO/LIFO, lote, serialização unitária,
transferência de estoque, fiscal, NF-e de entrada, comissão, contratos,
automações, vínculo fornecedor × Branch e exclusão física de fornecedor.

**Gate COM-01: para revisão.**
