# FIN-04 — Contas Financeiras / Bancárias e Movimentações de Tesouraria

Data: 2026-09-07.

## Objetivo

Implementar no VetorOS 2 a fundação de **Contas Financeiras / Bancárias e Tesouraria**, permitindo representar de forma inequívoca:

* contas bancárias;
* contas financeiras internas, quando arquiteturalmente justificadas;
* saldos financeiros;
* entradas e saídas;
* transferências entre contas;
* histórico imutável de movimentações;
* rastreabilidade e auditoria.

Este marco deve preparar a futura integração com:

* FIN-01 — Caixa;
* FIN-02 — Contas a Receber;
* FIN-03 — Contas a Pagar;

mas **não deve integrar automaticamente esses domínios nesta rodada**, salvo se a descoberta demonstrar que já existe contrato aprovado e inequívoco para isso.

Não alterar `vetoros1`.

Não criar commit ao final.

Entregar para revisão.

---

# 1. Descoberta obrigatória antes da implementação

Antes de criar migration ou alterar código, revisar integralmente:

* `cash_registers`;
* `cash_sessions`;
* `cash_movements`;
* `receivables`;
* ledger de pagamentos/alocações de FIN-02;
* `payables`;
* `payable_installments`;
* `payable_payments`;
* `payment_methods`;
* Tenant / Company / Branch;
* RLS;
* RBAC;
* auditoria ADM-03;
* padrões `security definer`;
* migrations FIN-01, FIN-02 e FIN-03;
* testes correspondentes.

Responder explicitamente no `executed.md`:

1. Existe hoje alguma entidade que represente inequivocamente uma conta bancária ou conta financeira?

2. `cash_registers` representa:

   * uma conta financeira;
   * um caixa físico;
   * ou somente um dispositivo/local operacional de caixa?

3. `cash_movements` pode ou não ser reutilizado legitimamente como ledger geral financeiro?

4. Existe conceito persistido de banco, agência, número de conta, PIX ou instituição financeira?

5. Existe algum campo atual que represente saldo financeiro fora de uma sessão de caixa?

6. `payment_methods` possui alguma relação com conta de destino/origem ou representa apenas a forma de pagamento?

7. Há alguma estrutura que permita registrar:

   * transferência bancária;
   * PIX;
   * TED;
   * boleto pago;
   * débito automático;
   * depósito;
   * tarifa;
   * ajuste financeiro?

8. Existe alguma arquitetura previamente aprovada para integração de FIN-02 ou FIN-03 com caixa/banco?

9. Há alguma razão inequívoca para a conta financeira pertencer:

   * ao Tenant;
   * à Company;
   * à Branch?

10. Qual escopo deve ser usado para uma conta bancária corporativa que possa ser utilizada por mais de uma filial?

Não assumir respostas.

Não criar entidades redundantes se uma estrutura inequívoca já existir.

---

# 2. Princípio arquitetural

Não reutilizar `cash_movements` como ledger bancário apenas porque ambos possuem entradas e saídas.

FIN-01 representa **Caixa operacional/físico** e sua sessão.

FIN-04 deve representar **Tesouraria / patrimônio financeiro disponível**, independentemente de existir sessão de caixa aberta.

Uma transferência bancária ou pagamento via conta corrente não pode depender artificialmente de um `cash_session`.

Se a descoberta confirmar essa separação semântica, criar domínio próprio.

---

# 3. Conta financeira

A modelagem deve avaliar uma entidade equivalente a:

`financial_accounts`

O nome final pode ser ajustado durante a descoberta se já existir convenção melhor no projeto.

Cada conta deve representar de forma inequívoca um local financeiro onde valores podem existir.

Avaliar suporte inicial aos tipos:

* `bank_account`;
* `cash_equivalent`.

Não criar enumeração excessiva sem necessidade real.

Se `cash_equivalent` conflitar semanticamente com FIN-01, manter apenas `bank_account` nesta rodada.

## Campos candidatos

Avaliar pelo menos:

* `id`;
* `tenant_id`;
* `company_id`;
* `branch_id`, se realmente necessário;
* `name`;
* `type`;
* `bank_code`;
* `bank_name`;
* `branch_number`;
* `account_number`;
* `account_digit`;
* `pix_key`, somente se houver justificativa;
* `active`;
* timestamps;
* campos de autoria/auditoria conforme padrão do projeto.

Dados bancários opcionais devem continuar opcionais quando não forem necessários ao tipo da conta.

Não armazenar credenciais bancárias, tokens, senhas ou segredos.

---

# 4. Escopo Tenant / Company / Branch

Esta decisão é obrigatória antes da migration.

Não assumir automaticamente `branch_id`.

Uma conta corrente pode pertencer à empresa e ser utilizada por várias filiais.

Preferência arquitetural, caso os contratos existentes não determinem o contrário:

`Tenant → Company → FinancialAccount`

e não:

`Tenant → Company → Branch → FinancialAccount`

`branch_id` pode existir somente se houver necessidade operacional inequívoca.

Toda FK deve preservar integridade same-tenant.

Quando houver `company_id`, proteger também consistência entre tenant e company utilizando o padrão já adotado no projeto.

---

# 5. Ledger financeiro

O saldo não deve ser uma coluna livremente editável.

Implementar um ledger append-only equivalente a:

`financial_transactions`

ou nomenclatura mais adequada encontrada na descoberta.

Cada movimentação deve representar uma alteração econômica real no saldo da conta.

Avaliar campos:

* `id`;
* `tenant_id`;
* `company_id`;
* `financial_account_id`;
* `type`;
* `amount`;
* `occurred_at`;
* `description`;
* `reference`;
* `created_by`;
* `created_at`.

O valor deve usar `numeric`, seguindo os padrões financeiros já aprovados.

Não utilizar `float`/`double`.

---

# 6. Entrada e saída

Evitar valores negativos quando isso comprometer legibilidade/integridade do domínio.

Preferir:

* `type = credit`;
* `type = debit`;
* `amount > 0`.

Saldo:

`credits - debits`

Avaliar cuidadosamente se essa convenção é compatível com FIN-01/FIN-02/FIN-03.

A decisão final deve ser registrada no `executed.md`.

---

# 7. Imutabilidade

Movimentações financeiras devem ser append-only.

Depois de criada uma movimentação:

* não permitir `UPDATE`;
* não permitir `DELETE`.

A proteção deve existir no PostgreSQL, não somente na aplicação.

Usar trigger equivalente aos ledgers já aprovados em FIN-01/FIN-02/FIN-03.

Correções devem ser realizadas por nova movimentação de estorno/reversão, nunca alterando histórico.

---

# 8. Estorno

Definir mecanismo inequívoco de estorno.

Preferência:

* nova movimentação;
* referência explícita à movimentação original;
* mesmo valor;
* natureza inversa;
* no máximo um estorno efetivo por movimentação, salvo se a arquitetura existente justificar outro comportamento.

Proteger contra:

* estorno de estorno;
* estorno duplicado;
* cross-tenant;
* alteração posterior do registro original.

Implementar idempotência quando a API puder sofrer retry.

---

# 9. Transferências

Transferência entre contas financeiras deve ser **atômica**.

Uma transferência deve gerar:

* débito na conta de origem;
* crédito na conta de destino;

na mesma transação PostgreSQL.

Nunca permitir que somente um lado seja persistido.

Avaliar uma entidade de cabeçalho equivalente a:

`financial_transfers`

se ela melhorar rastreabilidade e integridade.

Caso seja criada:

`financial_transfer`
→ debit transaction
→ credit transaction

As duas movimentações devem compartilhar referência inequívoca à mesma transferência.

## Regras mínimas

* origem diferente do destino;
* contas ativas;
* mesmo tenant;
* empresas compatíveis conforme decisão arquitetural;
* valor > 0;
* atomicidade;
* idempotência;
* auditoria.

Não criar transferência cross-tenant.

---

# 10. Saldo

O ledger deve ser a fonte histórica de verdade.

Avaliar duas estratégias:

### Opção A — saldo derivado

`SUM(credits) - SUM(debits)`

### Opção B — projeção de saldo

Tabela/materialização mantida transacionalmente.

Preferir inicialmente saldo derivado se o volume atual não justificar projeção.

Não introduzir cache/projeção prematura.

Caso uma projeção seja criada, o ledger continua sendo a fonte de verdade.

---

# 11. Saldo negativo

Não inventar regra universal de bloqueio.

Uma conta bancária pode tecnicamente operar com:

* limite;
* cheque especial;
* tarifas;
* liquidação posterior.

Portanto, salvo contrato de negócio existente em sentido contrário:

**não bloquear débito apenas porque produziria saldo negativo.**

Registrar explicitamente a decisão.

---

# 12. Saldo inicial

Não criar coluna editável `initial_balance` que fique fora do ledger.

Se for necessário informar saldo inicial, representá-lo por uma movimentação inequívoca de abertura, por exemplo:

`opening_balance`

ou mecanismo equivalente.

Essa movimentação passa a integrar o histórico.

Não permitir editar posteriormente o saldo inicial como simples atributo da conta.

---

# 13. Integração com FIN-01 — Caixa

Não integrar automaticamente nesta rodada.

Não criar:

`cash_movement → financial_transaction`

automaticamente sem contrato aprovado.

A descoberta deve apenas documentar como uma futura integração poderia funcionar.

FIN-01 continua preservado integralmente.

Nenhuma alteração deve mudar os invariantes já aprovados do caixa.

---

# 14. Integração com FIN-02 — Recebíveis

Não alterar FIN-02 nesta rodada.

Um recebimento existente continua sendo registrado no ledger próprio aprovado em FIN-02.

Não obrigar seleção de conta financeira agora.

Não gerar `financial_transaction` automaticamente.

Documentar como futura integração poderia associar:

`receivable payment/allocation`
→ `financial transaction`

sem duplicar o fato financeiro.

---

# 15. Integração com FIN-03 — Pagáveis

Mesma regra de FIN-02.

Não alterar `payable_payments`.

Não obrigar conta bancária no pagamento nesta rodada.

Não gerar movimento financeiro automático.

A futura arquitetura poderá associar:

`payable_payment`
→ saída de uma `financial_account`

mas somente em marco próprio.

---

# 16. Payment Methods

Revisar `payment_methods`.

Não transformar forma de pagamento em conta financeira.

Exemplos:

`PIX`, `dinheiro`, `cartão`, `boleto`

são **formas/meios**.

`Banco do Brasil - Conta 12345`

é **conta financeira**.

Não misturar os conceitos.

Não duplicar `payment_methods`.

---

# 17. Categorias financeiras

Não implementar plano de contas, centro de custo ou categorias completas nesta rodada, a menos que já exista arquitetura aprovada.

Se não existirem, registrar como limitação futura.

Não criar categorias genéricas prematuras apenas para "classificar" as movimentações.

FIN-04 deve primeiro estabelecer corretamente:

**onde está o dinheiro e como ele se movimenta.**

A classificação contábil/gerencial pode vir depois.

---

# 18. API

Implementar, caso confirmada a nova entidade, endpoints coerentes com os padrões atuais.

Esperado:

* `GET /financial-accounts`
* `POST /financial-accounts`
* `GET /financial-accounts/:id`
* `PATCH /financial-accounts/:id`

Movimentações:

* `GET /financial-accounts/:id/transactions`
* endpoint controlado para lançamento manual;
* endpoint para estorno;
* endpoint para transferência.

Não expor `DELETE` físico de movimentações.

Não permitir `PATCH` de movimentação financeira.

Para contas financeiras, preferir desativação a exclusão quando já houver histórico.

---

# 19. Lançamento manual

Lançamentos manuais devem exigir permissão própria.

Avaliar operações:

* crédito manual;
* débito manual.

Não criar uma API genérica que permita ao cliente montar arbitrariamente qualquer linha do ledger burlando regras.

Toda escrita deve passar por função/serviço transacional validado.

Preferir funções `security definer` quando necessário para manter o padrão dos ledgers financeiros atuais.

---

# 20. RBAC

Criar granularidade coerente com FIN-02/FIN-03.

Avaliar:

* `financial_accounts.read`
* `financial_accounts.create`
* `financial_accounts.update`
* `financial_accounts.transact`
* `financial_accounts.transfer`
* `financial_accounts.reverse`

Se existir nomenclatura melhor no padrão atual, seguir o padrão.

Adicionar ao seed e templates apropriados.

Garantir reconciliação idempotente.

Adicionar testes de autorização negativa reais com HTTP `403`.

Não aceitar somente teste textual de permission string.

---

# 21. RLS e integridade multitenant

Todas as novas tabelas tenant-scoped devem possuir:

* `ENABLE ROW LEVEL SECURITY`;
* `FORCE ROW LEVEL SECURITY`;
* policy pelo tenant corrente.

Também exigir integridade física.

Não depender somente de RLS.

FKs que relacionam entidades tenant-scoped devem utilizar o padrão same-tenant aprovado:

`(tenant_id, foreign_id) → target(tenant_id, id)`

quando aplicável.

Criar testes PostgreSQL reais tentando associação cross-tenant.

Os testes devem provar rejeição pelo banco, não apenas invisibilidade pela API.

---

# 22. Concorrência

Testar concorrência onde relevante.

Obrigatório para transferência/idempotência.

Garantir que retry concorrente com mesma idempotency key não gere duas transferências ou duas movimentações equivalentes.

Não implementar proteção baseada somente em:

`SELECT` → "não existe" → `INSERT`

sem constraint física apropriada.

---

# 23. Idempotência

Operações financeiras sensíveis devem tolerar retry seguro.

No mínimo avaliar:

* movimentação manual;
* transferência;
* estorno.

A chave deve possuir unicidade tenant-scoped adequada.

Retry da mesma operação deve retornar o resultado existente ou comportamento idempotente equivalente.

Não gerar:

* movimento duplicado;
* segundo estorno;
* segunda transferência;
* auditoria duplicada para mero retry.

---

# 24. Auditoria

Usar exclusivamente o mecanismo central ADM-03.

Eventos candidatos:

* `financial_account.created`
* `financial_account.updated`
* `financial_transaction.created`
* `financial_transaction.reversed`
* `financial_transfer.created`
* `financial_transfer.reversed`

A nomenclatura final deve seguir o padrão já existente.

Não criar sistema paralelo de auditoria.

Registrar:

* ator;
* tenant;
* entidade;
* operação;
* valores/referências relevantes conforme padrão existente.

---

# 25. Frontend / UX

Seguir o padrão UX já aprovado do VetorOS 2.

Adicionar item no grupo **Financeiro** da sidebar.

Estrutura recomendada:

## Contas financeiras

Página:

`/app/financial-accounts`

Tabela com:

* nome;
* instituição;
* identificação resumida;
* empresa;
* saldo;
* status.

## Cadastro

Como é entidade administrativa relevante e possui vários campos:

`/app/financial-accounts/new`

Não usar modal para o cadastro principal.

## Detalhe

`/app/financial-accounts/:id`

Mostrar:

* identificação da conta;
* saldo atual;
* histórico de movimentações;
* filtros;
* créditos;
* débitos;
* transferências;
* estornos;
* auditoria/histórico quando aplicável.

Ações operacionais de pequeno payload podem utilizar modal:

* lançar crédito;
* lançar débito;
* transferir;
* estornar.

Manter a UX consistente com o padrão já definido:

* listagem;
* create;
* detail/edit quando CRUD exigir;
* modal apenas para ações pequenas e contextualizadas.

---

# 26. Segurança de dados bancários

Não armazenar:

* senha;
* token bancário;
* certificado;
* segredo OAuth;
* chave privada;
* credencial Open Finance.

PIX, quando suportado, deve ser apenas informação cadastral operacional.

Integrações reais com bancos/Open Finance/CNAB ficam fora de escopo.

---

# 27. Fora de escopo

Não implementar nesta rodada:

* Open Finance;
* sincronização bancária;
* OFX;
* CNAB;
* PIX via API bancária;
* cobrança;
* conciliação bancária;
* adquirentes;
* cartão de crédito;
* gateway;
* integração automática com FIN-01;
* integração automática com FIN-02;
* integração automática com FIN-03;
* DRE;
* fluxo de caixa projetado;
* plano de contas;
* centros de custo;
* orçamento financeiro;
* multi-currency;
* contabilidade fiscal.

Não antecipar FIN-05 ou outros marcos.

---

# 28. Testes de banco

Criar suíte dedicada de contrato e integração.

Cobrir no mínimo:

* tabelas;
* constraints;
* `numeric`;
* tipos;
* FKs same-tenant;
* RLS;
* `FORCE RLS`;
* grants;
* ledger append-only;
* tentativa de update;
* tentativa de delete;
* estorno;
* estorno duplicado;
* saldo;
* saldo inicial, se implementado;
* transferência atômica;
* transferência origem=destino rejeitada;
* cross-tenant rejeitado;
* idempotência;
* concorrência.

Adicionar testes PostgreSQL reais para integridade física.

Não considerar regex da migration prova suficiente para isolamento cross-tenant.

---

# 29. Testes de API

Cobrir:

* CRUD permitido de conta;
* autenticação;
* contexto tenant/company;
* autorização;
* `403` real;
* conta inexistente;
* conta de outro tenant;
* lançamento;
* débito;
* crédito;
* estorno;
* estorno repetido;
* transferência;
* retry;
* concorrência;
* validação de payload;
* conta inativa;
* isolamento tenant.

Preservar integralmente os testes de FIN-01/FIN-02/FIN-03.

---

# 30. E2E

Criar spec dedicado.

Fluxo mínimo:

1. login;
2. acessar Financeiro;
3. abrir Contas Financeiras;
4. criar uma conta;
5. conferir listagem;
6. abrir detalhe;
7. registrar crédito;
8. verificar saldo;
9. registrar débito;
10. verificar saldo;
11. criar segunda conta;
12. transferir valor;
13. verificar débito da origem;
14. verificar crédito no destino;
15. estornar operação suportada pelo contrato;
16. validar histórico.

Não depender de sleeps arbitrários.

Usar waits determinísticos.

---

# 31. Regressão obrigatória

Ao finalizar:

* migrations;
* seed;
* lint;
* typecheck;
* testes DB;
* testes API;
* E2E do FIN-04;
* suíte E2E completa.

Como FIN-04 toca schema e fundação financeira, executar a regressão completa.

Não considerar o marco concluído se alguma suíte previamente verde ficar vermelha.

Não alterar testes anteriores apenas para fazê-los passar sem justificar uma mudança real de contrato.

---

# 32. executed.md

Entregar relatório detalhado contendo:

1. diagnóstico inicial;
2. resposta às perguntas da descoberta;
3. decisão Tenant/Company/Branch;
4. distinção Caixa × Conta Financeira;
5. modelo de conta;
6. modelo do ledger;
7. política de saldo;
8. política de saldo negativo;
9. saldo inicial;
10. política de lançamento;
11. política de transferência;
12. política de estorno;
13. idempotência;
14. concorrência;
15. integração ou não com FIN-01;
16. integração ou não com FIN-02;
17. integração ou não com FIN-03;
18. migrations;
19. constraints;
20. RLS;
21. RBAC;
22. auditoria;
23. API;
24. frontend;
25. testes;
26. E2E;
27. resultados numéricos completos;
28. limitações conhecidas;
29. arquivos alterados.

Informar números exatos:

* testes DB `X/X`;
* testes API `X/X`;
* specs/testes E2E `X/X`;
* lint;
* typecheck;
* migrations;
* seed.

Não escrever apenas "tudo passou".

---

# 33. Critério de aceite

FIN-04 só será considerado aprovável se:

* conta financeira possuir semântica inequívoca;
* Caixa permanecer semanticamente separado;
* ledger for append-only;
* saldo possuir fonte de verdade única;
* movimentações forem protegidas no banco;
* transferência for atômica;
* estorno não editar histórico;
* retry não duplicar fatos financeiros;
* integridade same-tenant existir fisicamente;
* RLS estiver habilitada e forçada;
* RBAC possuir testes negativos reais;
* auditoria utilizar ADM-03;
* FIN-01, FIN-02 e FIN-03 permanecerem íntegros;
* regressão completa estiver verde;
* limitações forem explicitadas.

---

# 34. Restrições finais

Não alterar `vetoros1`.

Não criar commit.

Não iniciar automaticamente outro marco.

Não implementar integrações bancárias externas.

Não modificar contratos anteriormente aprovados sem necessidade demonstrada pela descoberta.

Em caso de conflito entre uma implementação conveniente e a integridade financeira, preservar a integridade financeira.

Ao concluir, preencher `executed.md` e parar para revisão.
