# COM-01 — Fornecedores

## Objetivo

Implementar o domínio de **Fornecedores** do VetorOS 2, preservando integralmente os marcos já aprovados:

* DB-01;
* AUTH-01;
* CORE-01;
* CRM-01;
* CRM-02;
* OS-01;
* OS-02;
* CRM-03;
* EST-01;
* EST-02.

Esta etapa deve criar o cadastro mestre de fornecedores que servirá de base para os futuros módulos de compras e recebimento de mercadorias.

Não alterar `vetoros1`.

Não criar commit ao final. Entregar para revisão.

---

## 1. Descoberta obrigatória antes da implementação

Antes de criar migration ou alterar código, revisar obrigatoriamente:

* estrutura atual de `customers`;
* padrões adotados para PF/PJ, CPF/CNPJ, endereços e contatos;
* `inventory_parts`;
* `stock_movements`;
* contexto Tenant / Company / Branch;
* RLS e políticas fail-closed existentes;
* RBAC e permissões;
* auditoria append-only;
* padrões de API e frontend dos módulos CRM já concluídos.

Responder explicitamente no relatório:

1. Existe alguma entidade atual que represente fornecedores de forma inequívoca?
2. `customers` pode ser reutilizado sem misturar os domínios CRM e Suprimentos?
3. Fornecedor pertence ao Tenant, Company ou Branch?
4. Há necessidade real de vínculo fornecedor × Branch nesta etapa?
5. Quais padrões existentes podem ser reutilizados sem duplicação?

Nenhuma migration deve ser criada antes dessa análise.

---

## 2. Decisão arquitetural esperada

Fornecedor deve ser uma entidade própria do domínio de Suprimentos.

Não reutilizar `customers` apenas porque cliente e fornecedor podem compartilhar características cadastrais como:

* razão social;
* nome fantasia;
* CPF/CNPJ;
* endereço;
* telefone;
* e-mail.

A semelhança cadastral não implica identidade de domínio.

Nesta etapa, o fornecedor deve pertencer ao **Tenant**.

Não criar vínculo obrigatório com Branch sem necessidade operacional comprovada.

Não criar ainda:

* pedido de compra;
* recebimento;
* contas a pagar;
* condições de pagamento;
* custo médio;
* lote;
* serialização;
* movimentação de estoque automática;
* integração fiscal.

---

## 3. Persistência

Criar estrutura mínima para fornecedores.

Sugestão de entidades:

* `suppliers`;
* `supplier_addresses`;
* `supplier_contacts`.

A implementação deve seguir os padrões já consolidados em CRM-01 quando aplicáveis, sem acoplar fornecedores a clientes.

### `suppliers`

Campos mínimos esperados:

* `id`;
* `tenant_id`;
* `supplier_number`;
* `person_type`;
* `legal_name`;
* `trade_name`;
* CPF/CNPJ normalizado;
* inscrição estadual;
* inscrição municipal;
* observações;
* status ativo/inativo;
* `created_at`;
* `updated_at`.

O número do fornecedor deve ser sequencial por Tenant e gerado de forma transacional.

### Endereços

Permitir múltiplos endereços, seguindo padrão semelhante ao já utilizado para clientes.

Suportar ao menos:

* comercial;
* cobrança;
* entrega;
* outro.

Deve existir mecanismo inequívoco para endereço principal.

### Contatos

Permitir múltiplos contatos.

Suportar ao menos:

* telefone;
* celular;
* WhatsApp;
* e-mail;
* outro.

Normalizar os dados quando aplicável.

Deve existir mecanismo para contato principal por tipo ou regra equivalente já consolidada no projeto.

---

## 4. Integridade

Implementar:

* FKs same-tenant;
* constraints adequadas;
* unicidade de CPF/CNPJ por Tenant quando juridicamente/cadastralmente aplicável;
* proteção contra referências cross-tenant;
* validações de PF/PJ;
* normalização de documentos;
* validação de CPF/CNPJ seguindo o mesmo padrão de CRM-01.

Evitar duplicar lógica existente de normalização e validação quando houver utilitários reutilizáveis.

---

## 5. RLS

Todas as novas tabelas devem possuir:

* RLS habilitado;
* RLS forçado;
* políticas fail-closed;
* isolamento por `tenant_id`.

Nenhuma consulta deve depender exclusivamente de filtro aplicado pela aplicação.

Testar explicitamente acesso cross-tenant.

---

## 6. RBAC

Criar apenas as permissões necessárias.

Sugestão:

* `suppliers.read`;
* `suppliers.create`;
* `suppliers.update`.

Não criar permissões de compras ou estoque nesta etapa.

Aplicar as permissões de forma consistente na API e interface.

---

## 7. Auditoria

Registrar eventos relevantes no mecanismo append-only já existente.

Auditar no mínimo:

* criação;
* alteração cadastral;
* ativação;
* inativação;
* inclusão/alteração de endereço;
* inclusão/alteração de contato.

Não criar mecanismo paralelo de auditoria.

---

## 8. API

Implementar endpoints mínimos para:

* listar fornecedores;
* consultar fornecedor;
* criar fornecedor;
* atualizar fornecedor;
* listar endereços;
* adicionar/atualizar endereço;
* listar contatos;
* adicionar/atualizar contato.

A listagem deve suportar, seguindo os padrões do projeto:

* busca;
* paginação;
* ordenação;
* filtro por status.

Busca deve considerar pelo menos:

* número;
* razão social;
* nome fantasia;
* CPF/CNPJ.

Não implementar exclusão física de fornecedor.

A desativação deve ocorrer por status.

---

## 9. Frontend

Criar:

* `/app/suppliers`;
* `/app/suppliers/new`;
* `/app/suppliers/:id`.

A listagem deve exibir de forma objetiva:

* número;
* nome/razão social;
* nome fantasia quando houver;
* CPF/CNPJ;
* contato principal;
* status.

A tela de detalhe deve permitir:

* consultar dados cadastrais;
* editar;
* visualizar endereços;
* visualizar contatos;
* incluir/editar endereços;
* incluir/editar contatos;
* ativar/inativar quando autorizado.

Manter padrões visuais e de interação já usados nos módulos existentes.

---

## 10. Compatibilidade futura

A modelagem deve permitir futuramente relacionar fornecedor com:

* peças;
* códigos próprios do fornecedor;
* pedidos de compra;
* recebimentos;
* notas fiscais de entrada;
* custos;
* prazos;
* condições comerciais.

Porém **nenhuma dessas funcionalidades deve ser implementada no COM-01**.

Não adicionar campos especulativos sem necessidade atual.

---

## 11. Testes obrigatórios

Criar testes dedicados de banco e API.

### Banco

Validar no mínimo:

* criação de fornecedor PF;
* criação de fornecedor PJ;
* CPF válido/inválido;
* CNPJ válido/inválido;
* normalização;
* numeração sequencial por Tenant;
* concorrência na geração do número;
* unicidade;
* FKs same-tenant;
* RLS;
* isolamento cross-tenant;
* endereços;
* contatos;
* status.

### API

Validar no mínimo:

* criação sem autenticação/contexto;
* criação sem permissão;
* payload inválido;
* criação válida;
* listagem;
* busca;
* paginação;
* detalhe;
* atualização;
* tentativa cross-tenant;
* ativação/inativação;
* endereços;
* contatos.

---

## 12. Validação final

Executar e registrar:

* build Docker de produção;
* migrations;
* seed;
* lint;
* typecheck;
* testes DB;
* testes API;
* health da API;
* disponibilidade do frontend;
* revisão dos logs finais.

Nenhum warning ou erro novo deve ser ignorado.

---

## 13. Restrições de escopo

Não iniciar nesta etapa:

* pedido de compra;
* cotação de fornecedores;
* recebimento;
* entrada automática de estoque;
* contas a pagar;
* financeiro;
* custo médio;
* FIFO/LIFO;
* lote;
* serialização unitária;
* transferência de estoque;
* fiscal;
* NF-e de entrada;
* comissão;
* contratos;
* automações.

---

## Gate COM-01

Ao final, preencher `executed.md` com:

* descoberta realizada;
* decisões arquiteturais;
* migrations;
* entidades criadas;
* endpoints;
* frontend;
* RLS;
* RBAC;
* auditoria;
* testes;
* validação final;
* itens explicitamente não implementados.

Encerrar com:

**Gate COM-01: para revisão.**
