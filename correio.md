# VetorOS 2 — ASSET-01 Customer Assets / Equipamentos

## Objetivo

Implementar a primeira camada de equipamentos vinculados ao cliente no VetorOS 2, reutilizando integralmente DB-01, AUTH-01, CORE-01 e CRM-01.

A cadeia de domínio passa a ser:

```text
Tenant
 └── Customer
      ├── Addresses
      ├── Contacts
      └── Assets / Equipments
```

O equipamento deve existir independentemente de qualquer orçamento ou ordem de serviço.

Nenhum módulo de orçamento, OS, estoque, financeiro ou fiscal deve ser iniciado nesta etapa.

---

# 1. Princípios obrigatórios

## 1.1 Ownership

O equipamento pertence ao:

```text
Tenant → Customer → Asset
```

Não pertence à Branch.

Company e Branch podem registrar a origem operacional do cadastro, seguindo o mesmo princípio já adotado em Customers.

Nunca aceitar ownership sensível diretamente do frontend sem validação pelo contexto autenticado.

---

## 1.2 Histórico

O mesmo equipamento deverá futuramente poder possuir múltiplos atendimentos:

```text
Customer
   ↓
Asset
   ├── Quote #...
   ├── Service Order #...
   └── Service Order #...
```

Não duplicar os dados principais do equipamento a cada OS futura.

---

## 1.3 Multitenancy

Todas as tabelas novas devem:

* possuir `tenant_id`;
* ter RLS habilitado;
* usar `FORCE ROW LEVEL SECURITY`;
* impedir acesso cross-tenant;
* impedir associação do asset a customer de outro tenant;
* derivar tenant exclusivamente do TenantContext autenticado.

UUID conhecido de outro tenant jamais deve permitir leitura ou alteração.

---

# 2. Tabela principal

Criar uma migration posterior à CRM-01.

Nome sugerido:

```text
0006_customer_assets.sql
```

Criar tabela:

```text
customer_assets
```

Campos mínimos:

```text
id
tenant_id
customer_id

asset_number

type
brand
model

serial_number
imei

color
notes

status

origin_company_id
origin_branch_id

created_at
updated_at
```

Utilizar UUID para PK/FKs conforme padrão atual do VetorOS 2.

---

# 3. Asset number

Implementar:

```text
asset_number
```

incremental por tenant.

Não utilizar:

```sql
MAX(asset_number) + 1
```

Reutilizar ou adaptar o padrão transacional já criado para `customer_number`.

O contador deve ser seguro para concorrência.

Exemplo lógico:

```text
Tenant Alpha

Customer #1001
  Equipment #1
  Equipment #2

Customer #1002
  Equipment #3
```

O número é do tenant, não reiniciado por customer.

Criar unicidade apropriada:

```text
UNIQUE (tenant_id, asset_number)
```

---

# 4. Tipo do equipamento

Não limitar o VetorOS apenas a celulares ou informática.

O sistema deverá suportar assistência técnica de segmentos diferentes.

Exemplos:

```text
smartphone
tablet
notebook
desktop
printer
monitor
television
appliance
electronic
machine
other
```

Não é necessário criar uma tabela complexa de tipos nesta etapa.

Pode-se utilizar vocabulário controlado simples, desde que extensível no futuro.

Evitar estruturas que tornem obrigatório modificar migrations para cada novo segmento.

---

# 5. Identificadores

`serial_number` e `imei` devem ser opcionais.

Nem todo equipamento possui IMEI.

Não criar dependência estrutural de IMEI.

Aplicar normalização razoável.

Quando houver valor, considerar índices de busca.

Não exigir unicidade global.

Se houver regra de unicidade, ela deve ser no máximo tenant-aware e tecnicamente justificada.

Evitar bloquear cenários reais como:

* serial ausente;
* etiqueta ilegível;
* equipamento antigo;
* dois registros históricos com identificação incompleta.

---

# 6. Customer relation

`customer_id` é obrigatório.

Criar FK tenant-aware equivalente ao padrão já utilizado:

```text
(tenant_id, customer_id)
```

de forma que seja impossível associar asset a customer pertencente a outro tenant.

O frontend não define tenant.

---

# 7. Company / Branch de origem

Registrar, quando houver contexto operacional ativo:

```text
origin_company_id
origin_branch_id
```

Esses valores devem:

* ser obtidos do contexto autenticado;
* ser validados;
* pertencer ao mesmo tenant;
* ser definidos na criação;
* não ser editáveis por PATCH posteriormente.

Não transformar o equipment em propriedade da Branch.

---

# 8. Status

Não implementar DELETE físico.

Criar status simples e explícito.

Sugestão mínima:

```text
active
inactive
```

Se houver razão forte no domínio, pode ser incluído:

```text
archived
```

Alteração de status deve ser auditada.

---

# 9. Permissions

Adicionar permissions explícitas:

```text
assets.read
assets.create
assets.update
```

ou, caso o projeto já tenha convenção mais específica:

```text
customer_assets.read
customer_assets.create
customer_assets.update
```

Escolher uma única convenção e mantê-la consistentemente.

Reutilizar o mecanismo de AUTH-01.

Não criar mecanismo paralelo de autorização.

---

# 10. Scope

Reutilizar os scopes existentes.

Não elevar automaticamente acesso de Company/Branch para tenant-wide.

A consulta deve respeitar:

```text
permission
+
scope
+
RLS
```

---

# 11. Auditoria

Usar o mecanismo append-only existente.

Auditar pelo menos:

```text
customer_asset.created
customer_asset.updated
customer_asset.status_changed
```

Registrar somente informações necessárias.

Não persistir secrets ou conteúdo sensível desnecessário no audit log.

---

# 12. API

Criar módulo dedicado, seguindo padrão de Customers.

Endpoints mínimos:

```text
GET    /customer-assets
POST   /customer-assets
GET    /customer-assets/:id
PATCH  /customer-assets/:id
```

Também permitir consulta dos equipamentos do customer de maneira clara.

Pode ser:

```text
GET /customers/:customerId/assets
```

ou através de filtro oficial em:

```text
GET /customer-assets?customerId=...
```

Escolher a alternativa que melhor respeitar a arquitetura atual.

Não criar duas APIs redundantes para a mesma finalidade sem necessidade.

---

# 13. Criação

POST deverá aceitar somente dados editáveis de negócio.

Exemplo conceitual:

```json
{
  "customerId": "...",
  "type": "smartphone",
  "brand": "Samsung",
  "model": "Galaxy A13",
  "serialNumber": "...",
  "imei": "...",
  "color": "preto",
  "notes": "..."
}
```

Não aceitar do cliente:

```text
tenant_id
asset_number
origin_company_id
origin_branch_id
created_by
identity_id
profile_id
```

Esses campos devem ser derivados server-side quando aplicáveis.

---

# 14. PATCH

Permitir edição dos dados do equipamento.

O PATCH não pode alterar:

```text
tenant_id
asset_number
customer_id
origin_company_id
origin_branch_id
created_at
```

Neste primeiro gate, o equipamento permanece associado ao cliente que o cadastrou.

Transferência de equipamento entre clientes, se um dia necessária, deverá ser fluxo explícito e auditável, não um PATCH comum.

---

# 15. Busca

Implementar busca simples e eficiente.

Pesquisar pelo menos por:

```text
asset_number
type
brand
model
serial_number
imei
```

Busca textual deve ser segura, paginada e deterministicamente ordenada.

Não fazer full-text search complexo nesta fase.

---

# 16. Paginação

Seguir o padrão definido em Customers.

Ordenação estável e determinística.

Evitar resultados inconsistentes entre páginas.

---

# 17. Índices

Criar índices apropriados para:

```text
tenant_id
customer_id
asset_number
serial_number
imei
status
```

Evitar índices desnecessários.

Índices compostos devem considerar o tenant como primeira dimensão quando adequado.

---

# 18. Frontend

Criar interface mínima operacional.

## Dentro do customer

Na página:

```text
/app/customers/:id
```

incluir seção:

```text
Equipamentos
```

com:

* lista dos equipamentos;
* asset number;
* tipo;
* marca;
* modelo;
* serial/IMEI quando houver;
* status;
* botão para cadastrar equipamento;
* acesso aos detalhes.

---

## Cadastro

Criar página ou diálogo coerente com a arquitetura atual.

Sugestão:

```text
/app/customers/:id/assets/new
```

Campos:

```text
Tipo
Marca
Modelo
Número de série
IMEI
Cor
Observações
```

Não exigir campos que não façam sentido para todos os segmentos.

---

## Detalhes

Criar:

```text
/app/customers/:customerId/assets/:assetId
```

ou rota equivalente consistente com o App Router atual.

Permitir:

* visualizar;
* editar;
* alterar status.

Ainda não mostrar orçamento ou OS reais.

Pode existir somente uma área futura visualmente neutra, sem implementar módulos posteriores.

---

# 19. UX

Implementar estados mínimos:

```text
loading
empty
error
success
validation errors
```

Formulários devem informar claramente campos inválidos.

Nunca confiar apenas na validação frontend.

Toda validação de segurança continua obrigatoriamente no backend.

---

# 20. Seed

Expandir seed idempotente.

Criar exemplos de assets para PF e PJ já existentes no seed da CRM-01.

Exemplos possíveis:

```text
PF Alpha
- smartphone
- notebook

PJ Alpha
- printer

PF/PJ Beta
- outro equipamento
```

Executar o seed duas vezes.

Segunda execução deve passar sem duplicação problemática ou erro.

Não depender apenas de IDs aleatórios para detectar registros existentes.

---

# 21. Testes obrigatórios

Criar testes de integração específicos.

Cobrir no mínimo:

## Criação

* cria equipamento para customer do tenant atual;
* gera `asset_number`;
* asset numbers incrementam corretamente;
* concorrência não gera número duplicado.

## Multitenancy

* tenant A não lê asset do tenant B;
* tenant A não altera asset do tenant B;
* UUID conhecido de outro tenant não ajuda;
* não associa customer de tenant B.

## Authorization

* sem `assets.read` não lê;
* sem `assets.create` não cria;
* sem `assets.update` não altera.

## Ownership

* payload com `tenant_id` é rejeitado ou ignorado conforme convenção segura atual;
* PATCH não altera customer;
* PATCH não altera Company/Branch de origem;
* PATCH não altera asset number.

## Status

* alteração válida funciona;
* gera auditoria;
* não existe DELETE físico.

## Busca

* asset number;
* marca/modelo;
* serial;
* IMEI;
* customer filter.

## Seed

* primeira execução;
* segunda execução idempotente.

---

# 22. Segurança

Revisar explicitamente:

```text
Session
→ TenantContext
→ Permission
→ Scope
→ RLS
→ Customer ownership
→ Asset
```

Não introduzir bypass administrativo silencioso.

Não confiar em IDs recebidos do frontend sem validar tenancy.

Não criar SQL dinâmico inseguro.

Não conceder acesso de banco além do necessário.

Manter PostgreSQL e Redis somente internos ao Compose.

---

# 23. Contratos

Atualizar schemas/contratos compartilhados caso o projeto atual utilize esse padrão.

Não duplicar validações incompatíveis entre API e frontend.

Preferir contratos compartilhados quando apropriado.

---

# 24. Documentação

Criar:

```text
docs/architecture/ASSET01_CUSTOMER_ASSETS.md
```

Registrar:

* ownership;
* relação Customer → Asset;
* estratégia de `asset_number`;
* RLS;
* permissions;
* scopes;
* origem Company/Branch;
* campos imutáveis;
* decisão de não implementar transferência entre customers;
* decisão de não implementar Quote/OS ainda.

---

# 25. Fora de escopo

Não implementar nesta etapa:

```text
Quotes
Budgets
Service Orders
Diagnostics
Defects
Technical reports
Parts
Products
Inventory
Labor
Technicians assignment
Warranty
Checklists
Equipment images
Attachments
Signatures
Fiscal
Finance
Payments
Notifications
WhatsApp
Customer portal
```

Não antecipar ASSET-02.

---

# 26. Validação final

Executar no ambiente Docker real:

```bash
docker compose up -d --build
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Aplicar migrations em banco real de desenvolvimento.

Executar seed duas vezes.

Validar containers.

Validar frontend e API.

Confirmar que `vetoros1` não foi alterado.

---

# 27. Relatório final obrigatório

Ao concluir, entregar relatório contendo:

```text
# VetorOS 2 — ASSET-01 executada

Data:
Status:

## Implementado

## Migration criada

## Estrutura de dados

## Permissions / Scope / RLS

## API

## Frontend

## Auditoria

## Seed

## Testes

## Segurança

## Validação Docker

## Arquivos criados

## Arquivos alterados

## Fora de escopo confirmado

## Legado

## Git status
```

Informar números reais dos testes.

Não declarar sucesso se algum teste, build, lint ou typecheck estiver falhando.

---

# 28. Git

Não fazer commit.

Deixar todas as alterações no working tree para revisão.

Ao final:

```bash
git status
git diff --stat
```

e incluir o resultado relevante no relatório.

---

## Gate esperado

Somente considerar:

```text
ASSET-01 APROVÁVEL
```

se migrations, RLS, permissions, API, frontend, auditoria, seed idempotente, testes e build estiverem todos validados.

Nenhuma migration anterior deve ser reescrita.

Nenhum arquivo de `vetoros1` deve ser alterado.
