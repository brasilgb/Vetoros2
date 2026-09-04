# VetorOS 2 — CRM-02 Equipamentos / Devices do Cliente

## Objetivo

Implementar o cadastro multitenant de equipamentos/dispositivos pertencentes aos clientes, reutilizando integralmente as fundações já aprovadas:

* DB-01 Multitenancy;
* AUTH-01 Authentication/Authorization;
* CORE-01 Operational Context;
* CRM-01 Customers.

A CRM-02 deve preparar a base para a futura OS-01, mas **não deve implementar Ordens de Serviço nesta rodada**.

---

## 1. Princípio de domínio

A relação principal deve ser:

```text
Tenant
  └── Customer
        └── Customer Device
```

O equipamento pertence a um Customer e deve pertencer obrigatoriamente ao mesmo Tenant.

Nenhum `tenant_id`, `customer_id`, `company_id` ou `branch_id` deve ser aceito como fonte confiável diretamente do frontend quando puder ser derivado do contexto autenticado ou do recurso pai.

---

## 2. Entidade principal

Criar uma estrutura equivalente a:

```text
customer_devices
```

Campos mínimos:

* `id`;
* `tenant_id`;
* `customer_id`;
* `device_number`;
* `category`;
* `brand`;
* `model`;
* `serial_number`;
* `imei`;
* `asset_tag`;
* `color`;
* `notes`;
* `status`;
* `created_at`;
* `updated_at`.

Use UUID para o identificador principal, seguindo o padrão atual do projeto.

### device_number

Criar número sequencial por tenant, semelhante ao `customer_number`.

Requisitos:

* incremental;
* transacional;
* seguro sob concorrência;
* sem `MAX()+1`;
* independente entre tenants.

Exemplo:

```text
Tenant Alpha
EQ-000001
EQ-000002

Tenant Beta
EQ-000001
```

Se o padrão arquitetural atual utilizar apenas número inteiro para sequências internas, mantenha a mesma convenção e deixe a formatação visual para frontend/API.

---

## 3. Categoria do equipamento

A categoria deve ser um vocabulário controlado.

Exemplos iniciais:

```text
smartphone
tablet
notebook
desktop
printer
monitor
television
console
appliance
other
```

Evitar tabela de categorias nesta etapa se não houver necessidade real.

Use enum/check constraint ou abordagem equivalente já adotada no projeto.

Não criar um catálogo complexo de equipamentos nesta rodada.

---

## 4. Marca e modelo

Nesta primeira versão:

```text
brand
model
```

podem permanecer como texto normalizado.

Não criar tabelas globais `brands` ou `models` agora.

Motivo:

* evitar complexidade prematura;
* marcas/modelos variam conforme segmento;
* futura normalização poderá ocorrer quando existir necessidade de catálogo.

---

## 5. Identificadores físicos

Suportar:

* `serial_number`;
* `imei`;
* `asset_tag`.

Todos opcionais.

Normalizar valores antes da persistência.

Para IMEI:

* remover espaços e caracteres de formatação;
* aceitar apenas dígitos;
* quando informado, validar comprimento compatível com IMEI.

Não exigir IMEI porque vários tipos de equipamento não possuem esse identificador.

Não assumir unicidade global.

Quando houver constraint de unicidade, deve ser no mínimo tenant-aware.

Avaliar cuidadosamente se serial/IMEI devem ser únicos por tenant. Caso haja risco legítimo de duplicidade histórica ou equipamento compartilhado, priorizar índice para busca e não constraint rígida sem necessidade comprovada.

---

## 6. Customer ownership

Todo equipamento deve possuir `customer_id`.

Ao criar ou atualizar:

1. obter TenantContext da sessão;
2. verificar `customers.read` quando necessário;
3. localizar o Customer dentro do tenant corrente;
4. rejeitar Customer de outro tenant;
5. nunca confiar apenas no `customer_id` enviado;
6. deixar RLS como última barreira fail-closed.

Cross-tenant access deve resultar em comportamento equivalente a recurso inexistente ou acesso negado, de acordo com o padrão já usado no projeto.

---

## 7. Status

Criar estado simples.

Exemplo:

```text
active
inactive
```

Se houver padrão semelhante em CRM-01, reutilizá-lo.

Não implementar estados relacionados à Ordem de Serviço nesta etapa.

Não adicionar:

```text
in_repair
awaiting_parts
ready
delivered
```

Esses estados pertencem ao lifecycle da futura OS.

---

## 8. Banco e migration

Criar nova migration sequencial, sem alterar migrations anteriores.

Esperado:

```text
packages/db/migrations/0005_customer_devices.sql
```

ou o próximo número efetivamente disponível no repositório.

A migration deve contemplar:

* tabela;
* FKs;
* índices;
* contador da numeração;
* constraints;
* RLS;
* policies;
* permissions;
* grants mínimos necessários.

Nunca editar retroativamente migrations de DB-01, AUTH-01, CORE-01 ou CRM-01.

---

## 9. Integridade referencial

Garantir estruturalmente:

```text
customer_devices.tenant_id
customer_devices.customer_id
```

não possam formar uma combinação cross-tenant.

Preferir FK composta, caso o padrão existente permita:

```text
(tenant_id, customer_id)
→ customers(tenant_id, id)
```

A integridade multitenant não deve depender exclusivamente da aplicação.

---

## 10. RLS

Ativar e forçar RLS:

```sql
ENABLE ROW LEVEL SECURITY
FORCE ROW LEVEL SECURITY
```

As policies devem reutilizar o mecanismo de contexto PostgreSQL já definido pelo projeto.

Nenhuma nova forma paralela de resolução de tenant deve ser criada.

Fluxo obrigatório:

```text
Session
→ TenantContext
→ Authorization
→ PostgreSQL context
→ RLS
```

Testar explicitamente:

* leitura same-tenant;
* leitura cross-tenant;
* insert cross-tenant;
* update cross-tenant;
* delete cross-tenant, caso delete exista;
* ausência de contexto;
* contexto inválido.

---

## 11. Permissions

Adicionar permissions seguindo exatamente o sistema AUTH-01.

No mínimo:

```text
devices.read
devices.create
devices.update
```

Se houver exclusão:

```text
devices.delete
```

Não criar RBAC paralelo.

Integrar as novas permissions aos perfis/seed existentes usando o mecanismo oficial já adotado.

---

## 12. Auditoria

Registrar eventos append-only de:

* criação;
* atualização;
* mudança de status;
* eventual exclusão lógica/física.

Registrar no mínimo:

* tenant;
* usuário/identity;
* customer;
* device;
* ação;
* timestamp;
* alterações relevantes.

Reutilizar a infraestrutura de auditoria existente.

Não criar tabela de auditoria paralela específica para devices.

---

## 13. API

Criar endpoints REST alinhados ao padrão atual.

Sugestão:

```text
GET    /devices
GET    /devices/:id
POST   /devices
PATCH  /devices/:id
```

Opcionalmente permitir:

```text
GET /customers/:customerId/devices
```

somente se isso não duplicar desnecessariamente a lógica do endpoint principal.

O endpoint `/devices` deve suportar filtro por:

```text
customer_id
category
status
search
```

Busca deve considerar ao menos:

* `device_number`;
* `brand`;
* `model`;
* `serial_number`;
* `imei`;
* `asset_tag`.

Adicionar:

* paginação;
* ordenação;
* limites máximos;
* schemas de request/response;
* validação adequada.

---

## 14. Frontend

Criar interface mínima integrada ao CRM atual.

Rotas recomendadas:

```text
/app/devices
/app/devices/new
/app/devices/:id
```

E integrar também ao cliente:

```text
/app/customers/:id
```

Na tela do cliente deve existir uma seção:

```text
Equipamentos
```

com:

* quantidade;
* lista resumida;
* botão "Novo equipamento";
* link para abrir equipamento.

---

## 15. Cadastro

Formulário deve possuir:

* Cliente;
* Categoria;
* Marca;
* Modelo;
* Número de série;
* IMEI;
* Patrimônio/asset tag;
* Cor;
* Observações;
* Status.

O `device_number` deve ser gerado no backend e não editável.

Ao abrir cadastro a partir da tela de Customer, o cliente deve vir previamente selecionado.

---

## 16. Listagem

A tela `/app/devices` deve permitir:

* busca;
* filtro por cliente;
* filtro por categoria;
* filtro por status;
* paginação;
* ordenação.

Mostrar pelo menos:

```text
Número
Cliente
Categoria
Marca
Modelo
Serial/IMEI
Status
```

---

## 17. Tela de detalhe

A página `/app/devices/:id` deve mostrar:

* identificação;
* proprietário;
* categoria;
* marca/modelo;
* serial;
* IMEI;
* asset tag;
* cor;
* status;
* observações;
* datas;
* opção de edição.

Reservar visualmente uma futura seção:

```text
Histórico de Ordens de Serviço
```

mas **não implementar consultas de OS nesta rodada**.

Se necessário, apenas deixar o domínio preparado, sem UI fictícia ou dados simulados.

---

## 18. Seed

Adicionar devices para os tenants de desenvolvimento.

Exemplo:

```text
Alpha:
Customer PF → Smartphone Samsung
Customer PJ → Notebook Dell

Beta:
Customer PF/PJ → equipamento diferente
```

Seed deve continuar:

* idempotente;
* determinístico;
* tenant-safe.

Não utilizar IDs fixos frágeis quando o padrão atual usar lookup por identificadores naturais.

---

## 19. Testes de banco

Adicionar cobertura para:

* criação;
* contador sequencial;
* concorrência;
* isolamento Alpha/Beta;
* FK Customer/Tenant;
* RLS;
* ausência de tenant context;
* documento/identificadores opcionais;
* status inválido;
* enum/category inválido;
* auditoria.

Não reduzir ou remover testes anteriores.

---

## 20. Testes da API

Cobrir no mínimo:

```text
unauthenticated
permission denied
list
detail
create
update
search
filters
pagination
cross-tenant
customer ownership
invalid customer
invalid payload
```

A suíte completa anterior deve continuar verde.

---

## 21. Validação frontend

Executar:

```text
lint
typecheck
build
```

E validar pelo menos:

```text
/login
/app/customers
/app/devices
```

Realizar login com o faker local já existente e confirmar navegação autenticada.

---

## 22. Segurança

Preservar integralmente:

```text
Session
→ TenantMembership
→ TenantContext
→ Authorization
→ RLS
```

Não permitir:

* spoofing de tenant;
* acesso direto a device de outro tenant;
* alteração de customer para customer de outro tenant;
* bypass por ID conhecido;
* fallback silencioso sem tenant context.

---

## 23. Fora de escopo

NÃO implementar nesta rodada:

* Ordens de Serviço;
* orçamento;
* diagnóstico;
* defeito relatado;
* técnico responsável;
* peças;
* estoque;
* garantia;
* fotos;
* anexos;
* checklists;
* histórico de reparos;
* financeiro;
* fiscal;
* WhatsApp;
* notificações;
* IA.

Esses recursos serão tratados posteriormente.

---

## 24. Compatibilidade

Não alterar comportamento já aprovado de:

```text
DB-01
AUTH-01
CORE-01
CRM-01
```

`vetoros1` permanece somente como referência.

Nenhum arquivo do legado deve ser alterado.

---

## 25. Critério de conclusão

CRM-02 poderá ser considerada pronta quando:

```text
migrations       PASS
seed             PASS
DB tests         PASS
API tests        PASS
lint             PASS
typecheck        PASS
frontend build   PASS
Docker services  HEALTHY
```

Além disso, deve ser possível executar manualmente:

```text
Login
→ Clientes
→ abrir cliente
→ Novo equipamento
→ salvar
→ visualizar equipamento
→ editar
→ retornar ao cliente
→ visualizar equipamento na lista
```

---

## 26. Relatório final obrigatório

Ao concluir, retornar:

1. resumo da implementação;
2. migrations criadas;
3. tabelas/constraints/índices adicionados;
4. permissions;
5. endpoints;
6. páginas/componentes;
7. policies RLS;
8. auditoria;
9. seed;
10. quantidade de testes DB;
11. quantidade de testes API;
12. lint/typecheck/build;
13. status dos containers;
14. validação manual;
15. arquivos criados/modificados;
16. riscos ou pendências encontradas.

Não criar commit.

Aguardar revisão e aprovação antes do commit.
