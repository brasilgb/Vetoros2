# VetorOS 2 — CRM-02 Customer Assets / Equipamentos

Implementar a próxima etapa do VetorOS 2, respeitando integralmente as bases já aprovadas: **DB-01, AUTH-01, CORE-01 e CRM-01**.

## Objetivo

Criar a base de equipamentos/bens dos clientes, permitindo que um mesmo cliente possua vários equipamentos e que cada equipamento possa futuramente ter vários orçamentos e várias ordens de serviço ao longo do tempo.

Não implementar orçamento, ordem de serviço, estoque, fiscal ou qualquer módulo posterior nesta etapa.

## Modelagem

Criar entidade de equipamento vinculada obrigatoriamente a um `customer` do mesmo tenant.

O equipamento deve suportar, no mínimo:

* identificação interna;
* `customer_id`;
* categoria/tipo do equipamento;
* marca;
* modelo;
* número de série;
* IMEI quando aplicável;
* patrimônio/tag interna quando aplicável;
* descrição livre;
* observações;
* status;
* timestamps;
* origem operacional por Company/Branch quando fizer sentido dentro do padrão CORE-01.

A estrutura não deve ser limitada a celulares. Deve suportar notebooks, desktops, impressoras, TVs, eletroeletrônicos, equipamentos industriais e outros tipos.

Para identificadores adicionais que possam variar conforme o tipo de equipamento, utilizar estrutura extensível e normalizada, evitando criar dezenas de colunas específicas no registro principal.

Exemplos futuros de identificadores:

* IMEI 1;
* IMEI 2;
* MAC Address;
* número de patrimônio;
* código do fabricante;
* service tag;
* serial secundário;
* outros.

## Multitenancy e segurança

O ownership deve seguir exclusivamente:

Session → TenantContext → Authorization → RLS.

Nunca confiar em `tenant_id`, `company_id`, `branch_id`, ownership ou campos de segurança recebidos diretamente no payload HTTP.

Garantir:

* equipamento pertence ao tenant;
* customer informado pertence ao mesmo tenant;
* bloqueio absoluto de associação com customer de outro tenant;
* RLS habilitado e `FORCE ROW LEVEL SECURITY`;
* isolamento cross-tenant testado;
* nenhuma elevação implícita de grants Company/Branch para tenant-wide;
* nenhuma regressão em AUTH-01, CORE-01 ou CRM-01.

## Permissions

Criar permissions seguindo o padrão existente:

* `customer_assets.read`;
* `customer_assets.create`;
* `customer_assets.update`.

Reutilizar o mecanismo central de autorização já existente.

Não criar sistema paralelo de roles ou permissions.

## Auditoria

Registrar auditoria append-only para:

* criação de equipamento;
* alteração de equipamento;
* inclusão/alteração/remoção lógica de identificadores adicionais;
* mudanças relevantes de status.

Não permitir alteração destrutiva do histórico de auditoria.

## Exclusão

Não implementar DELETE físico.

Caso seja necessária desativação, utilizar status/soft state compatível com a arquitetura existente.

## API

Implementar endpoints para:

* listar equipamentos;
* buscar equipamento por ID;
* cadastrar equipamento;
* editar equipamento;
* listar equipamentos de um customer;
* pesquisar por cliente, marca, modelo, serial, IMEI ou identificadores;
* paginação;
* ordenação;
* filtros por status, categoria/tipo e customer;
* manutenção dos identificadores adicionais.

Validar rigorosamente todos os UUIDs, enums, campos textuais e ownership.

## Frontend

Criar interface mínima e funcional seguindo o padrão visual atual do VetorOS 2.

Rotas sugeridas:

* `/app/assets`;
* `/app/assets/new`;
* `/app/assets/:id`.

Também integrar o cadastro do cliente com uma área de equipamentos, por exemplo na tela:

* `/app/customers/:id`.

A partir do cliente deve ser possível visualizar seus equipamentos e iniciar o cadastro de um novo equipamento já associado ao cliente.

Não criar ainda botões funcionais de orçamento ou ordem de serviço. Caso seja útil visualmente preparar o espaço, ele deve permanecer claramente fora do escopo funcional da CRM-02.

## Banco e migrations

Criar migrations somente aditivas.

Não alterar ou reescrever migrations já aprovadas.

Atualizar o schema Drizzle.

Preservar completamente os dados e estruturas existentes.

Se houver necessidade de seed, criar exemplos idempotentes seguindo o padrão Alpha/Beta já utilizado.

## Testes obrigatórios

Adicionar testes de integração cobrindo pelo menos:

* criação válida;
* edição válida;
* leitura;
* listagem;
* paginação;
* filtros;
* pesquisa por serial/IMEI;
* múltiplos equipamentos para o mesmo customer;
* customer inexistente;
* customer de outro tenant;
* leitura cross-tenant;
* alteração cross-tenant;
* permissions ausentes;
* RLS direto no banco;
* identificadores adicionais;
* duplicidades onde houver regra de unicidade;
* auditoria;
* ausência de DELETE físico.

Garantir que todos os testes existentes continuem passando.

## Documentação

Criar documentação arquitetural da CRM-02 explicando:

* propósito;
* modelo de dados;
* ownership;
* RLS;
* permissions;
* API;
* identificadores extensíveis;
* relação Customer → Asset;
* preparação futura para Asset → Budget → Work Order;
* decisões que foram propositalmente deixadas para módulos posteriores.

## Validação final

Executar obrigatoriamente:

```bash
docker compose up -d --build
```

Executar migrations e seed se aplicável.

Depois executar:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Validar também:

* frontend acessível;
* API health;
* containers saudáveis;
* migrations exit 0;
* seed exit 0 quando aplicável.

## Restrições

* Não alterar `vetoros1`.
* Não implementar orçamento.
* Não implementar ordem de serviço.
* Não implementar estoque.
* Não implementar fiscal.
* Não implementar financeiro.
* Não iniciar módulos posteriores.
* Não criar nova arquitetura paralela.
* Não reescrever migrations anteriores.
* Não criar commit.

## Entrega esperada

Ao final, entregar relatório contendo:

1. resumo da implementação;
2. arquivos criados;
3. arquivos alterados;
4. migrations;
5. modelo de dados;
6. endpoints;
7. frontend;
8. permissions;
9. RLS e segurança;
10. auditoria;
11. testes executados;
12. quantidade de testes aprovados;
13. estado dos containers;
14. confirmação de que `vetoros1` não foi alterado;
15. confirmação de que nenhum módulo posterior foi iniciado;
16. confirmação de que nenhum commit foi criado;
17. conclusão do gate:

`CRM-02 APROVÁVEL`

ou descrição objetiva de qualquer pendência que impeça aprovação.
