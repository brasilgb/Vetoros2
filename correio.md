# VetorOS 2 — OS-01 Núcleo de Ordens de Serviço

**Data:** 4 de setembro de 2026
**Projeto:** `vetoros2`
**Objetivo:** implementar exclusivamente o primeiro núcleo funcional de Ordens de Serviço.

## 1. Contexto obrigatório

O projeto já possui e deve reutilizar integralmente:

* DB-01 — multitenancy;
* AUTH-01 — autenticação, sessão, TenantContext e autorização;
* CORE-01 — Company, Branch e contexto operacional;
* CRM-01 — Customers;
* CRM-02 — Customer Assets.

A cadeia arquitetural existente é:

```text
Identity
→ Session
→ TenantMembership
→ TenantContext
→ Company / Branch
→ Customer
→ Customer Asset
→ Service Order
```

Não recriar mecanismos paralelos de autenticação, autorização, tenant resolution, auditoria, sequenciamento ou contexto operacional.

`vetoros1` é somente referência funcional e não deve ser alterado.

---

# 2. Escopo do OS-01

Implementar o cadastro base multitenant de Ordens de Serviço.

O OS-01 deve contemplar somente:

* criação da ordem de serviço;
* listagem;
* consulta detalhada;
* atualização dos dados básicos;
* vínculo obrigatório com Customer;
* vínculo opcional com Customer Asset;
* Company e Branch responsáveis;
* número sequencial da OS por tenant;
* lifecycle/status inicial;
* descrição do problema informado pelo cliente;
* observações básicas;
* prioridade;
* datas operacionais essenciais;
* permissões;
* RLS;
* auditoria append-only;
* API;
* frontend mínimo funcional;
* migrations;
* seed;
* testes.

Não avançar para orçamento, peças, produtos, estoque, financeiro, pagamento, emissão fiscal, comissão, checklist avançado, anexos, fotos ou outros módulos posteriores.

---

# 3. Persistência

Criar tabela principal para ordens de serviço seguindo os padrões existentes do projeto.

Sugestão conceitual:

```text
service_orders
```

Campos mínimos esperados:

```text
id
tenant_id
company_id
branch_id
customer_id
customer_asset_id nullable

service_order_number

status
priority

reported_issue
internal_notes nullable

opened_at
closed_at nullable

created_at
updated_at
```

Pode adicionar campos estritamente necessários para compatibilidade com os padrões técnicos já existentes, mas não ampliar o domínio funcional.

---

# 4. Numeração da OS

`service_order_number` deve ser:

* sequencial por tenant;
* gerado no backend/banco;
* transacional;
* concorrente;
* previsível somente dentro do tenant;
* independente dos IDs técnicos.

É proibido usar:

```sql
MAX(service_order_number) + 1
```

Reutilizar o mesmo padrão arquitetural adotado no `customer_number` do CRM-01 sempre que aplicável.

A combinação abaixo deve ser única:

```text
tenant_id + service_order_number
```

---

# 5. Customer e Asset

Toda OS deve obrigatoriamente pertencer a um Customer.

`customer_asset_id` pode ser nulo.

Quando houver equipamento vinculado:

```text
service_order.tenant_id
=
customer.tenant_id
=
customer_asset.tenant_id
```

E:

```text
customer_asset.customer_id
=
service_order.customer_id
```

Não confiar apenas na validação da aplicação.

Criar constraints/FKs same-tenant adequadas no banco sempre que tecnicamente possível.

Uma OS nunca pode vincular:

* cliente de outro tenant;
* equipamento de outro tenant;
* equipamento pertencente a outro cliente.

---

# 6. Company e Branch

Toda OS deve pertencer ao contexto operacional correto.

Aplicar:

```text
Tenant
→ Company
→ Branch
→ Service Order
```

Reutilizar CORE-01.

Não aceitar `tenant_id`, `company_id` ou `branch_id` arbitrários enviados pelo frontend se esses valores puderem ser derivados da sessão/contexto operacional.

O ownership sempre deve ser derivado de contexto autorizado.

---

# 7. Status

Criar lifecycle simples e fechado.

Status mínimos:

```text
OPEN
IN_PROGRESS
COMPLETED
CANCELLED
```

Não implementar ainda uma máquina de estados complexa.

Regras mínimas:

* nova OS inicia como `OPEN`;
* pode avançar para `IN_PROGRESS`;
* pode ser concluída como `COMPLETED`;
* pode ser cancelada como `CANCELLED`;
* `closed_at` deve ser preenchido quando atingir `COMPLETED` ou `CANCELLED`;
* reabertura ou workflows especiais ficam fora do OS-01.

Centralizar as transições em um único ponto do backend.

Não deixar lógica de lifecycle espalhada por controllers/routes.

---

# 8. Prioridade

Criar enum ou vocabulário fechado, por exemplo:

```text
LOW
NORMAL
HIGH
URGENT
```

Nova OS deve assumir `NORMAL` por padrão.

---

# 9. Descrição da ocorrência

Campo obrigatório:

```text
reported_issue
```

Representa aquilo que o cliente informou no recebimento.

Deve aceitar texto suficiente para descrição operacional normal.

Campo opcional:

```text
internal_notes
```

Este campo é interno.

Não criar ainda:

* diagnóstico técnico formal;
* laudo;
* solução técnica;
* checklist;
* orçamento.

Esses conceitos pertencem a etapas posteriores.

---

# 10. Datas

Manter no mínimo:

```text
opened_at
closed_at
created_at
updated_at
```

`opened_at` deve ser definido pelo backend.

`closed_at` deve permanecer `NULL` enquanto a OS estiver aberta/em andamento.

Datas devem seguir os mesmos padrões UTC/timestamp já utilizados no projeto.

---

# 11. RLS

RLS é obrigatório.

A tabela `service_orders` deve possuir:

```sql
ENABLE ROW LEVEL SECURITY
FORCE ROW LEVEL SECURITY
```

As policies devem usar o mecanismo já existente de TenantContext.

Nenhuma query de aplicação deve depender exclusivamente de:

```sql
WHERE tenant_id = ?
```

para segurança multitenant.

O banco deve continuar fail-closed.

---

# 12. Autorizações

Criar e integrar no mecanismo existente as permissions:

```text
service_orders.read
service_orders.create
service_orders.update
```

Se o projeto já tiver convenção melhor de naming, seguir a convenção existente.

Não implementar permission system paralelo.

A API deve verificar autorização explicitamente antes das operações.

---

# 13. Auditoria

Todas as alterações relevantes devem gerar auditoria append-only seguindo o mecanismo já existente.

Auditar ao menos:

```text
service_order.created
service_order.updated
service_order.status_changed
```

A auditoria deve registrar, seguindo o contrato existente:

* tenant;
* identidade/usuário;
* ação;
* entidade;
* entidade_id;
* dados pertinentes antes/depois, quando aplicável;
* timestamp.

Não permitir atualização ou remoção de registros históricos de auditoria.

---

# 14. API

Criar endpoints REST seguindo os padrões existentes.

No mínimo:

```http
GET /service-orders
GET /service-orders/:id
POST /service-orders
PATCH /service-orders/:id
```

Pode existir endpoint específico para alteração de status se isso preservar melhor a regra de domínio:

```http
POST /service-orders/:id/status
```

ou equivalente seguindo o padrão arquitetural existente.

## GET /service-orders

Suportar no mínimo:

* paginação;
* busca por número da OS;
* filtro por status;
* filtro por prioridade;
* filtro por customer;
* filtro por asset;
* ordenação.

A busca não deve permitir escape de tenant.

## POST /service-orders

Receber somente dados que realmente devem vir do cliente HTTP.

Não confiar em `tenant_id`.

Validar:

* customer existente e same-tenant;
* asset, quando informado;
* vínculo asset/customer;
* contexto Company/Branch;
* autorização.

Retornar a OS criada.

## PATCH /service-orders/:id

Permitir somente alteração dos campos pertencentes ao OS-01.

Não permitir troca arbitrária de:

```text
tenant_id
service_order_number
created_at
```

Mudanças de contexto estrutural devem ser restritas conforme as regras arquiteturais existentes.

---

# 15. Contratos e validação

Utilizar os padrões existentes em `packages/contracts`.

Criar schemas compartilhados para:

* create;
* update;
* filtros;
* paginação;
* response DTO;
* status;
* prioridade.

Não duplicar validações independentes entre API e frontend quando o projeto já possuir mecanismo compartilhado.

---

# 16. Frontend

Criar:

```text
/app/service-orders
/app/service-orders/new
/app/service-orders/:id
```

## Listagem

Exibir pelo menos:

```text
OS
Cliente
Equipamento
Status
Prioridade
Data de abertura
```

Incluir:

* busca;
* filtro de status;
* paginação;
* acesso ao detalhe;
* ação para nova OS.

## Nova OS

Permitir:

* selecionar Customer;
* selecionar Customer Asset daquele cliente;
* informar problema relatado;
* prioridade;
* observações internas opcionais.

O seletor de equipamentos deve mostrar somente assets pertencentes ao Customer selecionado.

Não carregar equipamentos de outros clientes.

## Detalhe

Exibir:

* número da OS;
* cliente;
* equipamento;
* status;
* prioridade;
* problema relatado;
* observações;
* datas;
* contexto operacional relevante.

Permitir edição dos campos autorizados.

Permitir alteração do status usando o lifecycle centralizado no backend.

Não implementar orçamento, peças ou financeiro nessa tela.

---

# 17. UX

Manter interface coerente com:

```text
/app/customers
/app/assets
```

Não realizar redesign global.

Reutilizar:

* componentes;
* padrões de formulário;
* tabelas;
* loading;
* erro;
* empty state;
* paginação;
* navegação.

---

# 18. Seed

Adicionar seed idempotente mínimo para validar OS no ambiente local.

Criar algumas ordens para clientes/assets Alpha e Beta já existentes.

Garantir isolamento:

```text
Alpha não vê OS Beta
Beta não vê OS Alpha
```

O seed deve poder executar repetidamente sem duplicar dados indevidamente.

---

# 19. Testes de banco

Adicionar testes de DB cobrindo pelo menos:

1. criação de OS válida;
2. `service_order_number` único por tenant;
3. sequenciamento por tenant;
4. mesmo número permitido em tenants diferentes;
5. FK/customer same-tenant;
6. FK/asset same-tenant;
7. asset deve pertencer ao customer da OS;
8. company same-tenant;
9. branch same-tenant;
10. RLS bloqueia leitura cross-tenant;
11. RLS bloqueia escrita cross-tenant;
12. `closed_at` inicialmente nulo;
13. constraints de status/prioridade;
14. auditoria append-only permanece protegida.

---

# 20. Testes da API

Cobrir pelo menos:

1. listar OS autorizadas;
2. criar OS;
3. obter detalhe;
4. atualizar;
5. mudar status;
6. paginação;
7. busca por número;
8. filtros;
9. permission denied;
10. customer cross-tenant;
11. asset cross-tenant;
12. asset de outro customer;
13. isolamento Alpha/Beta;
14. tentativa de enviar `tenant_id` arbitrário;
15. alteração de campos imutáveis;
16. auditoria após criação;
17. auditoria após update;
18. auditoria após mudança de status.

Preservar todos os testes anteriores.

---

# 21. Migration

Criar migration nova.

Não editar migrations aprovadas:

```text
0001...
0002...
0003...
0004...
0005...
0006...
```

Seguir numeração subsequente atual do repositório.

Toda mudança de schema deve ser aditiva.

---

# 22. Documentação

Criar documentação arquitetural, por exemplo:

```text
docs/architecture/OS01_SERVICE_ORDERS.md
```

Documentar:

* objetivo;
* modelo;
* ownership;
* numeração;
* lifecycle;
* RLS;
* permissions;
* auditoria;
* API;
* frontend;
* invariantes;
* itens explicitamente fora do escopo.

---

# 23. Restrições absolutas

Não implementar nesta rodada:

```text
OS-02
orçamento
itens de orçamento
produtos
peças
estoque
serviços cobrados
financeiro
contas a receber
pagamentos
caixa
NFe
NFCe
NFSe
Focus NFe
comissões
garantia
fotos
anexos
assinaturas
WhatsApp
notificações
impressão/PDF
checklist técnico
diagnóstico estruturado
laudo técnico
workflow avançado
SLA
agendamento
```

Não alterar `vetoros1`.

Não alterar AUTH-01 salvo se existir bug objetivo e bloqueante; nesse caso interromper a implementação desse ponto e reportar antes de modificar arquitetura aprovada.

Não criar commit.

---

# 24. Validação obrigatória

Ao final executar:

```bash
docker compose up -d --build
```

Validar:

* migrations;
* seed;
* lint;
* typecheck;
* testes DB;
* testes API;
* frontend;
* health;
* logs recentes dos containers.

Confirmar também:

```text
/app/service-orders
/app/service-orders/new
```

e uma página real:

```text
/app/service-orders/:id
```

---

# 25. Resultado esperado

Ao terminar, entregar relatório contendo:

```text
1. resumo da implementação;
2. migration criada;
3. schema/tabelas;
4. invariantes de banco;
5. RLS;
6. permissions;
7. auditoria;
8. endpoints;
9. lifecycle;
10. frontend;
11. testes adicionados;
12. contagem total dos testes;
13. resultado lint/typecheck;
14. resultado docker;
15. URLs validadas;
16. arquivos criados;
17. arquivos alterados;
18. git status;
19. itens fora do escopo confirmados;
20. eventuais limitações encontradas.
```

Não criar commit.

O encerramento deve indicar explicitamente um dos gates:

```text
Gate OS-01: APROVÁVEL
```

ou

```text
Gate OS-01: NÃO APROVÁVEL
```

com justificativa objetiva.

---

## Regra principal

Implementar o menor núcleo sólido possível de Ordens de Serviço, preservando a arquitetura já aprovada.

Priorizar:

```text
integridade de dados
> isolamento multitenant
> autorização
> auditabilidade
> consistência de domínio
> API
> interface
> conveniência
```

Não antecipar funcionalidades das próximas fases.
