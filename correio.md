Continue exclusivamente **OS-ADV-01 — Ordem de Serviço Operacional Completa e Retorno em Garantia**.

O gate atual demonstrou que existe implementação funcional, mas **não existe suíte específica identificável para OS-ADV-01**.

Não tente acessar Docker novamente neste executor. O acesso ao daemon já está comprovadamente bloqueado por política externa.

O objetivo desta rodada é **criar a cobertura automatizada específica do OS-ADV-01**, sem alterar o domínio salvo se os próprios testes revelarem defeitos reais.

## Criar suíte dedicada

Crie preferencialmente:

`apps/api/tests/service-order-warranty.integration.test.ts`

ou nome equivalente coerente com o padrão existente.

A suíte deve reutilizar helpers, fixtures, autenticação e infraestrutura de testes já existentes no projeto.

Não duplique infraestrutura de teste desnecessariamente.

## Cobertura obrigatória

### 1. Campos operacionais

Provar atualização e persistência de:

* prioridade;
* técnico responsável;
* diagnóstico;
* solução;
* datas operacionais pertinentes;
* conclusão;
* entrega.

Validar campos inválidos, UUIDs inexistentes e ownership.

### 2. Técnico

Provar que:

* técnico válido do mesmo tenant pode ser atribuído;
* usuário inválido é rejeitado;
* usuário de outro tenant é rejeitado/invisível;
* vínculos respeitam o modelo de membership/profile existente.

### 3. Garantia

Cobrir configuração da garantia e análise dos três estados:

* `within_warranty`;
* `expired`;
* `not_applicable`.

Provar os limites temporais de forma determinística, evitando dependência frágil do relógio quando possível.

### 4. Retorno em garantia

Provar:

* retorno só pode ser criado a partir de OS em estado permitido;
* OS ainda aberta/não entregue é rejeitada;
* retorno é uma nova OS;
* OS original permanece preservada;
* retorno possui referência inequívoca à origem;
* classificação/snapshot da garantia é persistida corretamente;
* dados históricos da origem não são sobrescritos.

### 5. Múltiplos retornos

Provar explicitamente:

* uma OS original pode possuir mais de um retorno quando permitido;
* cada retorno possui ID e número próprios;
* todos apontam para a mesma OS original correta;
* criar novo retorno não altera retornos anteriores;
* listagem de retornos retorna todos os vínculos esperados.

### 6. Histórico de status

Provar:

* mudanças relevantes geram registros no histórico;
* ordem cronológica/determinística;
* tenant correto;
* vínculo correto com a OS;
* registros anteriores não são editados.

### 7. Append-only

Executar tentativa direta de:

* `UPDATE` em `service_order_status_history`;
* `DELETE` em `service_order_status_history`.

Ambas devem ser rejeitadas pelo banco conforme a arquitetura implementada.

### 8. Tenant isolation / RLS

Criar ou reutilizar pelo menos dois tenants.

Provar:

* tenant A não lê OS/retorno/histórico de B;
* tenant A não cria retorno usando OS de B;
* tenant A não vincula técnico de B;
* UUID real conhecido de outro tenant não produz vazamento;
* consultas diretas com runtime/RLS também preservam o isolamento.

### 9. FK same-tenant

Tentar violar diretamente as relações compostas relevantes e confirmar rejeição física pelo PostgreSQL.

### 10. RBAC

Cobrir pelo menos:

* sem sessão -> 401;
* sessão/contexto válido sem permission -> 403;
* `service_orders.read` permite somente leitura;
* `service_orders.create` controla criação do retorno quando aplicável;
* `service_orders.update` controla alterações operacionais/garantia conforme a implementação atual.

Não invente novas permissions nesta rodada salvo se houver inconsistência arquitetural comprovada.

### 11. Regressão

A nova suíte não deve substituir:

* `service-orders.integration.test.ts`;
* `service-order-stock.integration.test.ts`;
* contratos DB existentes.

Preserve todos.

## Testes de contrato

Se houver regras físicas adequadas para teste sem PostgreSQL ativo, adicione também contrato DB para migration 0032, incluindo:

* colunas;
* constraints;
* FKs same-tenant;
* RLS;
* append-only;
* índices relevantes.

Mas não trate contratos textuais/estruturais como substitutos dos testes reais de integração.

## Restrições

* Não continuar CRM-02.
* Não reabrir CAD-01.
* Não criar próximo marco.
* Não marcar OS-ADV-01 como DONE.
* Não alterar `docs/ROADMAP.md` para DONE nesta rodada.
* Não fazer commit.
* Não adaptar testes para esconder defeitos.
* Não enfraquecer RLS, RBAC ou constraints.

## Validação possível neste executor

Execute tudo que não dependa do daemon Docker:

* lint;
* typecheck;
* build;
* testes de contrato;
* `git diff --check`.

Se a suíte nova exigir PostgreSQL e não puder rodar aqui, apenas registre isso objetivamente.

Ao final informe:

1. arquivos criados/alterados;
2. quantidade de testes específicos adicionados;
3. cenários cobertos;
4. contratos que passaram;
5. validações estáticas;
6. quais testes ainda precisam ser executados externamente no Docker;
7. mantenha OS-ADV-01 como `TODO`.
