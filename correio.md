Perfeito. Vamos abrir formalmente a próxima rodada.

## OS-02 — Itens e serviços da Ordem de Serviço

Execute **exclusivamente o OS-02** no projeto `vetoros2`, sem commit ao final.

### 1. Descoberta obrigatória antes de alterar código

Antes de criar migration ou modificar schema, revisar:

* `correio.md`;
* migration `0007_service_orders.sql`;
* estrutura atual de `service_orders`;
* rotas e contratos de OS;
* permissões `service_orders.*`;
* auditoria existente;
* padrões de RLS e FKs compostas usados em CRM-02 e OS-01;
* telas:

  * `/app/service-orders`;
  * `/app/service-orders/new`;
  * `/app/service-orders/:id`.

Confirmar primeiro se já existe alguma estrutura reutilizável para representar itens da OS.

**Não criar tabela nova sem justificar por que a estrutura existente não atende.**

---

## 2. Objetivo funcional

Permitir que uma Ordem de Serviço possua múltiplos itens, inicialmente de dois tipos:

* **serviço**
* **peça/produto**

O item deve pertencer obrigatoriamente à mesma:

`Tenant → Company/Branch → Service Order`

do contexto operacional permitido.

Não implementar ainda movimentação de estoque, baixa de estoque, reserva, compra, fiscal ou financeiro.

---

## 3. Modelo mínimo esperado

Caso a descoberta confirme necessidade de nova persistência, criar algo equivalente a:

`service_order_items`

Campos mínimos:

* `id`
* `tenant_id`
* `service_order_id`
* `type`

  * `service`
  * `part`
* `description`
* `quantity`
* `unit_price`
* `discount_amount` ou mecanismo equivalente
* `total_amount`
* `notes`, opcional
* `created_at`
* `updated_at`

Se o domínio atual já possuir `product_id` ou estrutura de produtos/peças apropriada, o vínculo poderá ser opcional.

Não criar agora um módulo inteiro de catálogo apenas para satisfazer OS-02.

### Valores monetários

Evitar `float`.

Utilizar o padrão monetário já adotado pelo projeto, por exemplo `numeric/decimal` com precisão apropriada.

O total do item deve ser determinístico:

`quantidade × valor unitário − desconto`

Não aceitar total arbitrário enviado pelo frontend se ele puder ser calculado pelo backend.

---

## 4. Integridade multitenant

OS-02 deve seguir o padrão forte já adotado no projeto.

Garantir:

* item nunca pode apontar para OS de outro tenant;
* eventual produto/peça vinculada deve pertencer ao mesmo tenant;
* FKs compostas sempre que forem necessárias para garantir isso no banco;
* RLS para leitura e escrita;
* contexto da sessão utilizado no backend;
* nenhuma confiança em `tenant_id` informado pelo cliente.

O usuário jamais deve conseguir escapar do tenant alterando UUIDs no payload.

---

## 5. Regras funcionais

Implementar pelo menos:

### Criar item

Permitir adicionar item a uma OS existente.

Validar:

* OS existente;
* acesso à OS;
* tipo válido;
* descrição obrigatória;
* quantidade maior que zero;
* valor unitário não negativo;
* desconto não negativo;
* desconto não pode tornar o total negativo.

### Atualizar item

Permitir alterar campos editáveis.

Não permitir alterar:

* `id`
* `tenant_id`
* `service_order_id`

por atualização normal.

### Remover item

Permitir remoção de item da OS, desde que o usuário possua autorização adequada.

A remoção deve seguir o padrão de auditoria definido no projeto.

### Listar itens

O detalhe da OS deve permitir recuperar seus itens.

Pode ser:

`GET /service-orders/:id/items`

ou inclusão estruturada no detalhe atual da OS, desde que a decisão fique consistente e documentada.

---

## 6. Totais da Ordem de Serviço

A OS deve expor, no mínimo:

* subtotal dos itens;
* descontos;
* total da OS.

Preferencialmente esses valores devem ser derivados dos itens, evitando duas fontes de verdade.

Se decidir persistir agregados na própria `service_orders`, justificar tecnicamente e garantir atualização transacional.

Se não houver necessidade real de persistência, calcular na consulta/API.

---

## 7. Status da OS

Revisar os status definidos pelo OS-01 antes de criar regras.

Não inventar novo workflow completo nesta rodada.

Apenas impedir operações sobre itens se algum estado já existente significar inequivocamente que a OS está fechada/cancelada e o domínio exigir imutabilidade.

Se isso ainda não estiver estabelecido no `correio.md`, **não criar regra de negócio nova por suposição**.

---

## 8. Permissões

Reutilizar as permissões do módulo sempre que suficiente.

Se for necessária granularidade adicional, justificar antes de adicionar algo como:

* `service_orders.items.create`
* `service_orders.items.update`
* `service_orders.items.delete`

Não proliferar permissões desnecessariamente.

A autorização continua obrigatoriamente no backend.

---

## 9. Auditoria

Registrar operações relevantes, seguindo o mecanismo append-only atual:

* item criado;
* item atualizado;
* item removido.

Não modificar `audit_logs` para representar estado atual.

---

## 10. API

Implementar contratos tipados e validação de payload.

Uma API aceitável seria:

```text
GET    /service-orders/:id/items
POST   /service-orders/:id/items
PATCH  /service-orders/:id/items/:itemId
DELETE /service-orders/:id/items/:itemId
```

Mas reutilize o padrão arquitetural já existente no projeto se houver alternativa melhor.

Respostas e erros devem manter a convenção atual da API.

---

## 11. Frontend

No detalhe:

`/app/service-orders/:id`

adicionar seção **Itens da OS**.

Interface mínima:

* lista de itens;
* descrição;
* tipo;
* quantidade;
* valor unitário;
* desconto;
* total;
* adicionar;
* editar;
* remover.

Exibir também resumo:

```text
Subtotal
Descontos
Total
```

Não transformar esta rodada em redesign da tela de OS.

---

## 12. Testes obrigatórios de banco

Criar suíte dedicada, preferencialmente:

`packages/db/tests/service-order-items-contract.test.ts`

Cobrir pelo menos:

* constraints de quantidade;
* valores monetários;
* tipo válido;
* vínculo com OS;
* FK same-tenant;
* eventual produto same-tenant;
* RLS;
* impossibilidade de associação cross-tenant.

---

## 13. Testes obrigatórios de API

Criar suíte dedicada para OS-02.

Cobrir:

* criar item de serviço;
* criar item de peça;
* payload inválido;
* quantidade zero/negativa;
* preço negativo;
* desconto inválido;
* OS inexistente;
* OS de outro tenant;
* listar itens;
* atualizar item;
* tentar alterar campos imutáveis;
* excluir item;
* item pertencente a outra OS;
* item pertencente a outro tenant;
* cálculo correto de subtotal/desconto/total;
* autorização.

Adicionar ao menos um cenário com múltiplos itens e valores fracionários para comprovar cálculo monetário correto.

---

## 14. Não fazer nesta rodada

Fora do OS-02:

* movimentação de estoque;
* reserva de peça;
* saldo de produto;
* compra;
* fornecedor;
* orçamento completo;
* aprovação de orçamento;
* contas a receber;
* caixa;
* pagamento;
* NF-e;
* NFC-e;
* NFS-e;
* comissão;
* agenda;
* técnico/execução avançada;
* anexos/fotos;
* WhatsApp;
* módulos posteriores.

Também não alterar `vetoros1`.

---

## 15. Validação final

Ao terminar executar:

* build Docker;
* migrations;
* seed;
* lint;
* typecheck;
* testes DB completos;
* testes API completos;
* testes dedicados OS-02;
* health da API;
* login do frontend;
* acesso à página de detalhe de OS;
* revisão de logs dos containers.

Nenhuma regressão em:

**DB-01 → AUTH-01 → CORE-01 → CRM-01 → CRM-02 → OS-01.**

---

## Critério do gate

Ao final, produzir `correio.md` com:

* descoberta realizada;
* decisão de persistência;
* migrations criadas;
* contratos;
* API;
* frontend;
* segurança multitenant;
* auditoria;
* testes acrescentados;
* contagem total das suítes;
* validação Docker;
* eventuais limitações;
* confirmação explícita de que módulos posteriores não foram iniciados.

**Não fazer commit.**

O resultado esperado é:

> **Gate OS-02: APROVÁVEL**

Pode executar essa rodada agora.

## Fechamento executado

Confirmada a ausência de estrutura reutilizável para itens; criada a migration
`0008_service_order_items.sql` com valores `numeric`, total calculado, checks,
FK same-tenant e RLS. A API de itens foi adicionada às rotas de OS e o detalhe
passou a exibir itens e totais. Foi criada a suíte dedicada
`packages/db/tests/service-order-items-contract.test.ts`. Totais: DB **39/39**,
API **38/38**; lint/typecheck, migration/seed, health e frontend passaram. Não
houve regressões nos módulos anteriores nem alteração de `vetoros1`.

**Gate OS-02: APROVÁVEL**
