# VetorOS 2 — OS-01 Work Orders

Data: 4 de setembro de 2026

## Objetivo

Implementar exclusivamente o primeiro núcleo operacional de Ordens de Serviço sobre a base já aprovada:

DB-01 → AUTH-01 → CORE-01 → CRM-01 → CRM-02 → OS-01

Não avançar para orçamento, peças, estoque, financeiro, fiscal, notificações ou módulos posteriores.

## Premissas obrigatórias

- Trabalhar somente no projeto `vetoros2`.
- `vetoros1` é somente referência e não deve ser alterado.
- Não reescrever migrations anteriores.
- Manter PostgreSQL + Drizzle + Fastify + Next.js já existentes.
- Reutilizar integralmente Session → TenantContext → Authorization → RLS.
- Todo ownership multitenant deve ser derivado da sessão autenticada.
- Nenhum `tenant_id` confiável deve vir diretamente do frontend.
- Manter auditoria append-only já adotada.
- Preservar compatibilidade com DB-01, AUTH-01, CORE-01, CRM-01 e CRM-02.

## 1. Modelo de dados

Criar a estrutura principal de ordens de serviço.

### `work_orders`

Campos mínimos:

- `id`
- `tenant_id`
- `work_order_number`
- `customer_id`
- `customer_asset_id`
- `branch_id`
- `assigned_identity_id` ou vínculo equivalente já compatível com AUTH/CORE
- `status`
- `priority`
- `title`
- `reported_issue`
- `technical_notes`
- `customer_notes`
- `opened_at`
- `started_at`
- `completed_at`
- `closed_at`
- `created_at`
- `updated_at`

Regras:

- `work_order_number` sequencial por tenant.
- Não usar `MAX()+1`.
- Implementar contador transacional seguro contra concorrência, seguindo o padrão adotado em `customer_number`.
- Cliente é obrigatório.
- Equipamento pode ser obrigatório somente se isso for coerente com o modelo atual; caso exista dúvida arquitetural, preferir permitir `customer_asset_id` nulo para suportar serviços sem equipamento físico.
- Se houver equipamento informado, ele deve pertencer ao mesmo tenant e ao cliente selecionado.
- Branch deve pertencer ao mesmo tenant.
- Técnico/responsável, quando informado, deve pertencer ao tenant e respeitar o modelo de membership/authorization existente.
- Todos os relacionamentos multitenant devem possuir proteção same-tenant no banco sempre que tecnicamente aplicável.

## 2. Status

Implementar workflow inicial simples e fechado.

Sugestão de estados:

- `open`
- `in_progress`
- `waiting_customer`
- `waiting_parts`
- `completed`
- `closed`
- `cancelled`

Não criar engine genérica de workflow nesta fase.

Validar transições no backend.

No mínimo:

- `open` → `in_progress`
- `open` → `cancelled`
- `in_progress` → `waiting_customer`
- `in_progress` → `waiting_parts`
- `in_progress` → `completed`
- `waiting_customer` → `in_progress`
- `waiting_parts` → `in_progress`
- `completed` → `closed`
- `completed` → `in_progress`, se necessário reabrir antes do fechamento
- não permitir alterar OS `closed` ou `cancelled` livremente

Se o projeto já possuir convenção melhor documentada, reutilizá-la em vez de criar mecanismo paralelo.

## 3. Prioridade

Usar enum/conjunto fechado simples:

- `low`
- `normal`
- `high`
- `urgent`

Default: `normal`.

## 4. RLS e isolamento

Aplicar RLS habilitado e forçado em todas as novas tabelas tenant-owned.

Garantir isolamento fail-closed.

Os testes devem provar pelo menos:

- tenant A não lê OS do tenant B;
- tenant A não atualiza OS do tenant B;
- tenant A não cria OS vinculada a cliente do tenant B;
- tenant A não vincula equipamento do tenant B;
- equipamento pertencente a outro cliente do mesmo tenant não pode ser usado incorretamente;
- branch de outro tenant não pode ser usada;
- nenhuma autorização depende apenas do frontend.

## 5. Permissions

Adicionar e integrar às estruturas AUTH-01 existentes:

- `work_orders.read`
- `work_orders.create`
- `work_orders.update`

Se houver endpoint específico de mudança de status e o modelo atual justificar permission própria, avaliar `work_orders.status.update`, mas evitar granularidade desnecessária nesta fase.

Reutilizar scopes e mecanismos já existentes.

Não criar sistema paralelo de autorização.

## 6. Auditoria

Registrar eventos append-only para:

- criação da OS;
- atualização de dados principais;
- atribuição/troca de responsável;
- mudança de status;
- alteração de cliente/equipamento, caso permitida;
- fechamento/cancelamento.

Registrar somente dados necessários e compatíveis com o padrão de auditoria existente.

## 7. API

Implementar endpoints REST seguindo o padrão atual.

Mínimo esperado:

- `GET /work-orders`
- `GET /work-orders/:id`
- `POST /work-orders`
- `PATCH /work-orders/:id`
- `PATCH /work-orders/:id/status`

Filtros da listagem:

- número da OS;
- cliente;
- equipamento;
- status;
- prioridade;
- responsável;
- branch;
- período de abertura.

Implementar:

- paginação;
- ordenação;
- busca compatível com os padrões CRM já existentes;
- validação via contratos/schemas compartilhados quando já adotado pelo projeto.

Não implementar orçamento, peças, pagamentos ou emissão fiscal.

## 8. Regras de criação

Ao criar uma OS:

1. resolver tenant pela sessão;
2. validar autorização;
3. validar cliente no tenant;
4. validar equipamento, quando informado;
5. confirmar que equipamento pertence ao cliente;
6. validar branch;
7. validar responsável, quando informado;
8. gerar `work_order_number` transacional;
9. criar OS;
10. registrar auditoria.

Toda operação deve ocorrer de forma segura e consistente.

## 9. Interface web

Criar telas mínimas:

- `/app/work-orders`
- `/app/work-orders/new`
- `/app/work-orders/:id`

### Listagem

Exibir ao menos:

- número;
- cliente;
- equipamento;
- status;
- prioridade;
- responsável;
- data de abertura.

Permitir filtros básicos.

### Nova OS

Fluxo:

1. selecionar cliente;
2. carregar equipamentos somente daquele cliente;
3. selecionar equipamento opcionalmente;
4. selecionar branch quando necessário;
5. selecionar responsável quando permitido;
6. informar título/descrição do problema;
7. prioridade;
8. salvar.

Não permitir que o frontend injete tenant.

### Detalhe

Exibir:

- número da OS;
- cliente;
- equipamento;
- status;
- prioridade;
- responsável;
- descrição relatada;
- notas técnicas;
- datas relevantes;
- ações de atualização;
- mudança de status permitida.

Não implementar ainda timeline avançada, chat, fotos, orçamento ou peças.

## 10. Testes

Adicionar cobertura DB/API suficiente para validar o OS-01.

Testar pelo menos:

### Banco

- migration;
- sequência de OS por tenant;
- concorrência do contador;
- FKs same-tenant;
- RLS;
- relacionamento cliente/equipamento;
- isolamento entre tenants.

### API

- criação válida;
- criação sem autorização;
- leitura;
- listagem;
- paginação/filtros;
- atualização;
- mudança válida de status;
- transição de status inválida;
- equipamento de outro cliente;
- cliente de outro tenant;
- equipamento de outro tenant;
- branch de outro tenant;
- responsável inválido;
- isolamento entre tenants.

## 11. Seed

Adicionar dados mínimos idempotentes para desenvolvimento:

- pelo menos uma OS no tenant Alpha;
- pelo menos uma OS no tenant Beta;
- associadas aos customers/assets já existentes no seed.

Não criar dependência frágil baseada em IDs fixos se o projeto já utiliza resolução por chave natural.

## 12. Documentação

Criar:

`docs/architecture/OS01_WORK_ORDERS.md`

Documentar:

- modelo;
- sequência;
- workflow;
- permissions;
- RLS;
- relacionamentos;
- endpoints;
- decisões adotadas;
- limites explícitos do OS-01.

## 13. Validação final obrigatória

Executar e reportar:

- `docker compose up -d --build`
- migrations
- seed
- lint
- typecheck
- testes DB
- testes API
- health da API
- HTTP da aplicação web
- logs recentes dos containers relevantes

Confirmar explicitamente:

- nenhuma migration antiga foi modificada;
- `vetoros1` não foi alterado;
- AUTH-01 não foi alterado estruturalmente;
- nenhuma funcionalidade de OS-02/orçamento/peças/financeiro/fiscal foi implementada;
- nenhum commit foi criado.

## Gate

Ao final, produzir um resumo objetivo contendo:

- arquivos/migrations principais;
- endpoints;
- telas;
- permissions;
- testes executados;
- resultado da stack;
- eventuais limitações.

Encerrar com apenas uma das classificações:

**Gate OS-01: APROVÁVEL**

ou

**Gate OS-01: NÃO APROVÁVEL**

Não criar commit.