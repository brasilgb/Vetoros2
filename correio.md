# FIN-01 — Caixa e Recebimentos

## Objetivo

Implementar o primeiro núcleo financeiro operacional do VetorOS 2:

* caixas por filial;
* abertura e fechamento de caixa;
* recebimentos;
* formas de pagamento;
* vínculo de recebimentos com vendas e, quando arquiteturalmente adequado, Ordens de Serviço;
* histórico financeiro imutável e auditável;
* saldo calculado a partir de movimentações reais.

Preservar integralmente todos os marcos já aprovados, em especial:

* DB-01;
* AUTH-01;
* CORE-01;
* CRM-01/02/03;
* OS-01/02;
* EST-01/02;
* COM-01 em diante;
* UX;
* ADM-01/02/03.

Não alterar `vetoros1`.

Não implementar emissão fiscal, Mercado Pago, contas bancárias, conciliação bancária ou contas a pagar nesta rodada.

Não criar commit ao final. Entregar para revisão.

---

## 1. Descoberta obrigatória

Antes de criar migrations ou alterar código, revisar a implementação existente e responder explicitamente:

1. Existe hoje alguma entidade que represente caixa financeiro?
2. Existe alguma tabela que represente recebimento/pagamento?
3. Como `sales` representa total, cancelamento e status?
4. Há informação de pagamento já persistida em venda?
5. Service Order possui atualmente algum conceito de pagamento?
6. Existe alguma forma de pagamento já cadastrada ou codificada no projeto?
7. Company ou Branch é a unidade correta para possuir um caixa?
8. O contexto operacional ativo da sessão é suficiente para determinar a filial?
9. Há alguma estrutura existente que possa funcionar como ledger financeiro?
10. Qual é o modelo atual de auditoria que deve ser reutilizado?
11. Quais permissões financeiras já existem?
12. Existem regras de cancelamento de venda que precisarão interagir com recebimentos?
13. Há alguma possibilidade de duplicar recebimentos por retry/requisição repetida?
14. Quais operações precisam obrigatoriamente ser transacionais?

Não criar schema antes de responder essas perguntas com base no código real.

---

## 2. Princípio arquitetural

O financeiro deve seguir o mesmo princípio adotado no estoque:

**movimentações são a verdade histórica; saldo é consequência.**

Não persistir um campo de saldo mutável como única fonte da verdade.

Se uma projeção de saldo for necessária por desempenho, ela deverá ser reconstruível a partir das movimentações financeiras.

---

## 3. Caixa

Modelar, somente se a descoberta confirmar a necessidade, uma entidade equivalente a `cash_registers`.

Um caixa deve pertencer inequivocamente a:

`tenant → company → branch`

Campos mínimos esperados:

* id;
* tenant;
* company;
* branch;
* nome;
* status ativo/inativo;
* timestamps.

Não assumir que haverá somente um caixa por filial.

---

## 4. Sessão de caixa

Uma abertura física/lógica de caixa deve possuir uma sessão própria, por exemplo `cash_sessions`.

Campos conceituais:

* caixa;
* usuário responsável pela abertura;
* data/hora de abertura;
* valor inicial;
* status `open` / `closed`;
* data/hora de fechamento;
* usuário responsável pelo fechamento;
* valor informado no fechamento, quando aplicável.

Regras:

* uma sessão fechada não volta para aberta;
* impedir duas sessões abertas para o mesmo caixa, se essa for a regra de domínio confirmada;
* abertura e fechamento devem ser transacionais;
* valores financeiros devem usar `numeric`, nunca `float`.

---

## 5. Formas de pagamento

Verificar primeiro se já existe estrutura correspondente.

Caso não exista, criar modelo simples para formas como:

* dinheiro;
* PIX;
* cartão de débito;
* cartão de crédito;
* transferência;
* outras.

Não implementar adquirentes, bandeiras, taxas, parcelamento financeiro complexo ou integração externa nesta fase.

Não transformar códigos fixos arbitrários em arquitetura permanente se o sistema claramente precisar de cadastro configurável.

---

## 6. Recebimentos

O sistema deve permitir registrar recebimentos reais.

Cada recebimento deverá possuir, no mínimo:

* tenant;
* company;
* branch;
* sessão de caixa, quando aplicável;
* valor;
* forma de pagamento;
* data/hora;
* usuário responsável;
* origem;
* entidade de origem;
* observação opcional.

A arquitetura deve permitir identificar inequivocamente se o recebimento nasceu de:

* venda;
* Ordem de Serviço;
* outra origem futura.

Não criar FK polimórfica frágil sem analisar alternativas.

---

## 7. Pagamento parcial

Não assumir que uma venda ou OS é sempre paga integralmente em uma única operação.

O modelo deve suportar:

* pagamento integral;
* pagamento parcial;
* múltiplas formas de pagamento;
* múltiplos recebimentos para a mesma origem.

Exemplo válido:

Venda de R$ 1.000,00:

* R$ 300,00 dinheiro;
* R$ 700,00 PIX.

O saldo pendente deve ser calculável de forma determinística.

---

## 8. Ledger financeiro

Criar ou reutilizar um ledger append-only para movimentações de caixa.

Exemplos conceituais:

* abertura;
* recebimento;
* estorno;
* suprimento;
* sangria;
* fechamento.

Não é obrigatório implementar todos esses tipos nesta etapa. Entretanto, a modelagem não deve inviabilizá-los.

Movimentações já efetivadas não devem ser editadas destrutivamente.

Correções devem ocorrer por movimentação compensatória/estorno quando aplicável.

---

## 9. Cancelamento / estorno

Investigar as regras já implementadas no módulo de vendas.

Uma venda cancelada que possua recebimento não pode simplesmente apagar registros financeiros.

Definir comportamento explícito e testável.

Preferir estorno financeiro append-only.

Não implementar automaticamente devolução bancária/cartão/PIX externo.

Nesta fase estamos tratando do registro financeiro interno.

---

## 10. Idempotência

Recebimentos são operações financeiras.

Avaliar necessidade de chave idempotente ou outra proteção contra duplicação decorrente de:

* retry HTTP;
* duplo clique;
* timeout;
* repetição acidental da mesma requisição.

Se houver risco real, implementar proteção estrutural no backend/banco.

Não depender apenas de botão desabilitado no frontend.

---

## 11. RLS

Todas as novas tabelas tenant-scoped devem seguir rigorosamente o padrão já aprovado:

* `tenant_id`;
* FKs same-tenant quando aplicável;
* RLS;
* `FORCE ROW LEVEL SECURITY`;
* contexto operacional existente.

Um tenant jamais pode visualizar ou movimentar caixa de outro tenant.

Uma Branch não pode ser associada a Company incompatível.

---

## 12. RBAC

Realizar descoberta das permissions existentes antes de criar novas.

Se não houver permissions adequadas, utilizar códigos semanticamente específicos, por exemplo:

* `cash.read`;
* `cash.open`;
* `cash.close`;
* `payments.read`;
* `payments.create`;
* `payments.refund`.

Não conceder automaticamente permissões financeiras sensíveis a papéis operacionais apenas porque possuem alguma permission `.read`.

Documentar explicitamente o mapa final de papéis × permissions.

---

## 13. Auditoria

Reutilizar ADM-03.

Devem gerar eventos de auditoria as ações administrativas/financeiras relevantes, incluindo pelo menos:

* abertura de caixa;
* fechamento;
* criação de recebimento;
* estorno.

Nunca gravar:

* token;
* credencial;
* dados completos de cartão;
* segredo de integração.

A auditoria é histórica e append-only.

---

## 14. API

A API deverá oferecer somente os endpoints necessários ao fluxo desta etapa.

Esperado, sujeito à descoberta:

### Caixas

* listar;
* criar;
* editar configuração básica.

### Sessões

* consultar sessão atual;
* abrir;
* fechar;
* histórico.

### Recebimentos

* listar;
* consultar detalhe;
* criar;
* estornar, caso essa operação seja incluída no escopo final.

Paginação, ordenação e filtros devem ocorrer no backend.

---

## 15. Interface

Manter o padrão visual já definido para VetorOS 2.

Adicionar área financeira coerente na sidebar.

Sugestão:

**Financeiro**

* Caixa
* Recebimentos

Para CRUDs de maior volume:

* tabela;
* create;
* edit/detalhe.

Para operações pontuais e pequenas, como abertura ou fechamento de caixa, preferir modal/dialog quando isso resultar em fluxo mais rápido e claro.

Não transformar cada pequena ação em uma página independente.

---

## 16. Tela de Caixa

A tela deve permitir entender imediatamente:

* caixa selecionado;
* filial;
* aberto/fechado;
* responsável;
* horário de abertura;
* saldo esperado;
* movimentações recentes.

Quando fechado:

* ação principal: `Abrir caixa`.

Quando aberto:

* ação principal adequada ao fluxo;
* acesso às movimentações;
* `Fechar caixa`.

Evitar dashboard cheio de cards sem função operacional.

---

## 17. Tela de Recebimentos

Tabela operacional com colunas úteis como:

* data;
* origem;
* documento;
* cliente, quando resolvível;
* forma de pagamento;
* valor;
* status;
* operador.

Filtros:

* período;
* filial;
* forma de pagamento;
* origem;
* status;
* busca textual.

Não exibir UUID como informação principal.

---

## 18. Concorrência

Criar testes para situações financeiras concorrentes relevantes.

No mínimo avaliar:

* duas tentativas simultâneas de abrir o mesmo caixa;
* duas requisições concorrentes do mesmo recebimento;
* fechamento enquanto ocorre movimentação.

As invariantes críticas devem ser garantidas pelo banco/transação sempre que possível, e não apenas por verificações antecipadas na aplicação.

---

## 19. Testes

Criar suíte dedicada de banco e API.

Cobrir pelo menos:

* criação/configuração de caixa;
* isolamento de tenant;
* contexto Company/Branch;
* abertura;
* impossibilidade de abertura concorrente indevida;
* recebimento;
* pagamento parcial;
* múltiplas formas de pagamento;
* cálculo de total recebido;
* saldo pendente;
* estorno, se implementado;
* tentativa sem permission;
* auditoria;
* proteção contra duplicidade;
* fechamento;
* imutabilidade de movimentos históricos.

Criar E2E do fluxo principal.

---

## 20. Validação final

Executar obrigatoriamente:

* migrations desde banco vazio;
* seed;
* lint;
* typecheck;
* build;
* testes DB;
* testes API;
* E2E relacionado.

Registrar números exatos de testes aprovados.

Não considerar a tarefa concluída apenas porque a interface funciona.

---

## 21. Fora de escopo

Não implementar nesta rodada:

* NF-e;
* NFC-e;
* NFS-e;
* Focus NFe;
* Mercado Pago;
* adquirentes;
* TEF;
* PIX automático;
* boleto;
* contas bancárias;
* conciliação;
* contas a pagar;
* DRE;
* fluxo de caixa projetado;
* comissão;
* split;
* cobrança recorrente.

Esses pontos serão tratados em marcos próprios.

---

## 22. Entrega

Preencher `executed.md` com:

1. descoberta realizada;
2. decisões arquiteturais;
3. migrations;
4. modelo de caixa;
5. modelo de sessões;
6. modelo de recebimentos;
7. ledger financeiro;
8. regras de estorno;
9. idempotência;
10. RLS;
11. RBAC;
12. auditoria;
13. frontend;
14. testes;
15. pendências.

Não criar commit.

Entregar para revisão.
