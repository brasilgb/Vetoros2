# Execução de `correio.md`

Data: 2026-09-11

## Comparação

`vetoros2/correio.md` está diferente da versão anterior registrada no Git. O marco anterior era **FIS-ADV-01 — Fiscal Operacional Completo**; o conteúdo atual solicita **FIS-ADV-02 — Fluxo Fiscal Operacional Integrado**, com foco nos vínculos entre PDV, vendas, ordens de serviço, cadastros e documentos fiscais.

## Resultado — FIS-ADV-02

```text
PDV → Fiscal: SIM
Venda → Fiscal: SIM
OS → Fiscal: SIM
Configuração empresa: SIM
Configuração filial: SIM
Configuração produtos: SIM
Proteção contra duplicidade: SIM
RBAC: SIM
RLS: SIM
```

## Descoberta e implementação

- Reutilizados `fiscal_documents` e `fiscal_document_items` do FIS-ADV-01, além de `sales`, `service_orders`, `companies`, `branches` e `inventory_parts`.
- Adicionada proteção estrutural de unicidade: no máximo um documento fiscal por venda ou ordem de serviço.
- Adicionados links de origem fiscal nas APIs de venda e OS.
- Adicionada ação fiscal ao comprovante do PDV e às telas de venda e OS.
- Disponibilizada manutenção dos dados fiscais de empresa, filial e produto.
- Nenhuma camada de integração fiscal externa foi alterada.

## Arquivos alterados

- `apps/api/src/core/routes.ts`
- `apps/api/src/inventory/routes.ts`
- `apps/api/src/sales/routes.ts`
- `apps/api/src/service-orders/routes.ts`
- `apps/web/app/app/branches/[id]/page.tsx`
- `apps/web/app/app/companies/[id]/page.tsx`
- `apps/web/app/app/inventory/parts/[id]/page.tsx`
- `apps/web/app/app/pos/page.tsx`
- `apps/web/app/app/sales/[id]/page.tsx`
- `apps/web/app/app/service-orders/[id]/page.tsx`
- `packages/db/migrations/0035_fis_adv02_operational_links.sql`
- `packages/db/migrations/meta/_journal.json`

Migration criada: `0035_fis_adv02_operational_links.sql`, somente para a restrição de unicidade por origem.

## Gates

```text
lint: PASS
typecheck: PASS
Web build: PASS
git diff --check: PASS
DB tests: NÃO EXECUTADOS — PostgreSQL inacessível (connect EPERM 127.0.0.1:5432)
API tests: NÃO EXECUTADOS — dependem do PostgreSQL inacessível
Docker Compose: indisponível — comando docker não encontrado neste ambiente
```

Os testes contratuais sem banco foram coletados com sucesso. Os testes de integração não puderam validar o banco/RLS porque o serviço PostgreSQL e o Docker não estão disponíveis neste ambiente.

## Limitações

A validação end-to-end com banco, migração, RLS e fluxo HTTP permanece pendente até executar o ambiente Docker/PostgreSQL oficial. Não foi feito commit.

```text
FIS-ADV-02 = IMPLEMENTADO; validação de infraestrutura pendente por indisponibilidade do ambiente
```
