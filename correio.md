# PDV-ADV-01 — Frente de Caixa Operacional Completa

Data: 2026-09-10

## Objetivo

Executar o marco **PDV-ADV-01 — Frente de Caixa Operacional Completa**, transformando o núcleo atual de vendas, estoque, pagamentos e caixa em uma operação de balcão realmente utilizável.

O PDV **não deve criar um segundo domínio de vendas**.

A venda realizada pelo PDV deve continuar usando, sempre que tecnicamente adequado, as estruturas canônicas já existentes:

* `sales`;
* `sale_items`;
* `payments`;
* `payment_methods`;
* `cash_registers`;
* `cash_sessions`;
* `cash_movements`;
* `stock_movements`;
* `financial_transactions`;
* recebíveis quando aplicável.

O objetivo é criar uma **experiência operacional especializada de frente de caixa sobre o domínio existente**, e não duplicar entidades ou regras já resolvidas.

---

# 1. Regra obrigatória: descoberta antes da implementação

Antes de alterar qualquer arquivo, faça uma auditoria completa do estado atual relacionado ao PDV.

Revisar obrigatoriamente:

* VEN-01;
* VEN-02;
* VEN-03;
* VEN-03.1;
* VEN-ADV-01;
* FIN-01;
* CAI-01 a CAI-05;
* FIN-04;
* FIN-ADV-01;
* EST-01;
* EST-02;
* estrutura atual de produtos/peças;
* fluxo de `payments`;
* fluxo de abertura e fechamento de caixa;
* telas Web de vendas;
* permissões existentes;
* testes de concorrência e idempotência relacionados.

Não implementar uma funcionalidade apenas porque ela está listada abaixo.

Primeiro verificar se ela:

1. já existe;
2. existe parcialmente;
3. está resolvida por outra estrutura;
4. realmente constitui uma lacuna.

Evitar duplicação arquitetural.

---

# 2. Princípio arquitetural

O PDV deve ser tratado prioritariamente como uma **interface operacional especializada**.

Não criar tabelas como:

* `pos_sales`;
* `pdv_sales`;
* `checkout_sales`;

se `sales` já representa corretamente a transação comercial.

Também não criar estrutura paralela para:

* itens;
* pagamentos;
* baixa de estoque;
* movimentação de caixa;
* cancelamentos.

Reutilizar o núcleo existente.

Uma nova estrutura só é aceitável se representar um conceito operacional que realmente não pertença às entidades atuais.

---

# 3. Acesso ao PDV

Criar ou validar uma rota dedicada de operação, preferencialmente:

`/app/pos`

ou equivalente já adotado pelo projeto.

A tela deve ser pensada para uso contínuo no balcão.

Não reproduzir simplesmente o CRUD administrativo de vendas.

---

# 4. Caixa aberto

Descobrir como o sistema atualmente vincula:

* usuário;
* filial;
* caixa;
* sessão aberta.

Determinar se uma venda feita pelo PDV deve exigir sessão de caixa aberta.

Para operações que gerem recebimento físico ou financeiro pelo caixa, o comportamento esperado é:

* não permitir finalizar a venda sem sessão válida;
* informar claramente ao operador quando não houver caixa aberto;
* permitir navegar para abertura do caixa quando autorizado.

Não duplicar regras já existentes no módulo de caixa.

---

# 5. Identificação operacional

O PDV deve conhecer corretamente:

* tenant;
* company;
* branch;
* usuário operador;
* sessão de caixa;
* caixa físico quando aplicável.

Esses valores devem vir do contexto operacional e da sessão autenticada sempre que já forem definidos pelo sistema.

Não solicitar manualmente informações que o sistema já conhece.

---

# 6. Venda em rascunho

Avaliar se o modelo atual de `sales.status = draft` atende adequadamente ao carrinho operacional.

Preferencialmente utilizar a própria venda `draft` como estado temporário da operação.

O operador deve conseguir:

* iniciar venda;
* adicionar itens;
* remover itens;
* alterar quantidade;
* alterar preço quando permitido;
* aplicar desconto quando permitido;
* selecionar cliente opcional;
* abandonar/cancelar rascunho sem movimentar estoque ou caixa.

Verificar o comportamento atual para rascunhos abandonados.

Não criar mecanismo paralelo de carrinho sem necessidade.

---

# 7. Busca rápida de itens

Auditar o cadastro atual de peças/produtos e seus identificadores.

O PDV deve permitir busca rápida por informações disponíveis no domínio, tais como:

* descrição;
* código interno;
* SKU;
* código de barras;
* identificadores existentes.

Se código de barras ainda não existir no cadastro canônico, documentar claramente a lacuna antes de implementar qualquer nova coluna.

Não inventar estrutura paralela de produto apenas para o PDV.

---

# 8. Código de barras

Verificar se já existe suporte a:

* EAN;
* GTIN;
* barcode;
* identificadores múltiplos por produto/peça.

Se já existir, reutilizar.

Se não existir e a descoberta demonstrar necessidade real, implementar da forma mais integrada ao cadastro canônico.

A entrada de scanner USB deve funcionar como teclado comum, sem exigir integração proprietária.

Fluxo desejável:

1. foco permanente ou facilmente recuperável no campo de leitura;
2. scanner envia código;
3. Enter conclui;
4. item é localizado;
5. item é adicionado ou sua quantidade incrementada;
6. foco retorna para leitura.

---

# 9. Inclusão rápida

Ao localizar um item:

* incluir imediatamente no carrinho;
* se já estiver presente, avaliar se incrementar quantidade é a melhor UX;
* manter possibilidade de edição manual;
* mostrar estoque disponível quando isso for relevante ao operador.

O fluxo deve exigir o mínimo possível de cliques.

---

# 10. Estoque

Preservar integralmente as regras já validadas em VEN-02/VEN-03.

O PDV:

* não baixa estoque durante o rascunho;
* baixa estoque apenas na confirmação;
* não permite estoque negativo quando a regra atual proíbe;
* mantém atomicidade;
* mantém proteção contra concorrência;
* mantém idempotência;
* restitui estoque corretamente no cancelamento.

Não duplicar lógica de baixa dentro da camada Web.

---

# 11. Quantidade

Permitir:

* incremento rápido;
* decremento;
* digitação direta;
* remoção do item.

Respeitar as regras atuais de tipo/precisão da quantidade.

Não alterar escala decimal do domínio sem necessidade comprovada.

---

# 12. Preço

O preço deve inicialmente vir do cadastro ou regra já utilizada atualmente em vendas.

O operador pode editar o preço somente se isso já for permitido pelo domínio/RBAC ou se a descoberta indicar necessidade de uma nova regra.

Não criar permission nova automaticamente.

Primeiro verificar o padrão existente.

---

# 13. Desconto

Permitir desconto conforme o modelo atual da venda/item.

Auditar se hoje o desconto é:

* por item;
* global;
* ambos.

Preservar o modelo canônico.

Se houver necessidade operacional não atendida, implementar de forma consistente com vendas administrativas.

---

# 14. Cliente

Cliente deve continuar opcional quando o domínio atual permitir.

O PDV deve oferecer:

* venda sem cliente;
* busca rápida de cliente;
* seleção;
* troca;
* remoção.

Não exigir cadastro para vendas de balcão que legalmente e funcionalmente possam ocorrer sem identificação.

---

# 15. Totais

Mostrar de forma muito clara:

* subtotal;
* descontos;
* total final;
* valor recebido;
* valor restante;
* troco.

Os valores devem ser derivados das regras canônicas.

Não recalcular de maneira divergente apenas no frontend.

---

# 16. Pagamento

Auditar profundamente o fluxo já existente de `payments`.

O PDV deve reutilizar essa estrutura.

Deve suportar, se já permitido pela arquitetura:

* uma forma de pagamento;
* várias formas de pagamento;
* pagamentos parciais na mesma finalização.

Exemplo:

Venda: R$ 150,00

* Dinheiro: R$ 50,00
* PIX: R$ 40,00
* Cartão: R$ 60,00

Não criar uma estrutura `payment_splits` se múltiplos `payments` já representam corretamente esse cenário.

---

# 17. Formas de pagamento

Listar apenas métodos disponíveis e válidos para o contexto.

Verificar se `payment_methods` já diferencia características como:

* dinheiro;
* cartão;
* PIX;
* transferência;
* outros.

Não codificar nomes fixos no frontend quando houver cadastro canônico.

---

# 18. Dinheiro e troco

Para pagamento em dinheiro, a operação precisa suportar valor entregue pelo cliente.

Exemplo:

Total: R$ 72,30

Valor entregue: R$ 100,00

Troco: R$ 27,70

Auditar primeiro se existe conceito equivalente no domínio.

O troco não deve ser confundido com desconto nem com pagamento adicional.

Determinar a forma correta de representar isso no caixa e no histórico sem distorcer o valor real da venda.

---

# 19. Pagamento acima do total

Bloquear pagamentos acumulados acima do total da venda, exceto no cenário específico de dinheiro em que a diferença representa troco e é tratada explicitamente.

Evitar contabilizar R$ 100 como receita de uma venda de R$ 72,30.

A receita deve continuar sendo R$ 72,30.

---

# 20. Venda à vista

Fluxo típico:

1. criar venda draft;
2. incluir itens;
3. definir cliente opcional;
4. escolher formas de pagamento;
5. confirmar operação;
6. baixar estoque;
7. registrar pagamentos;
8. movimentar caixa quando aplicável;
9. marcar venda confirmada;
10. disponibilizar comprovante.

A descoberta deve definir a melhor ordem transacional conforme o código existente.

---

# 21. Atomicidade da finalização

Este é um dos pontos críticos do marco.

A finalização do PDV não pode produzir estados como:

* venda confirmada sem pagamento que deveria existir;
* pagamento registrado sem venda confirmada;
* caixa movimentado sem venda válida;
* estoque baixado com falha posterior deixando operação inconsistente.

Auditar se as APIs atuais permitem uma finalização verdadeiramente transacional.

Se o frontend atualmente precisar executar diversas chamadas independentes como:

1. confirmar venda;
2. criar pagamento A;
3. criar pagamento B;

avaliar seriamente se isso deixa janela de inconsistência.

Se houver lacuna real, criar um **endpoint orquestrador transacional de checkout/finalização**, reutilizando internamente as regras existentes.

Exemplo conceitual:

`POST /sales/:id/checkout`

ou equivalente.

Esse endpoint não deve duplicar regras do domínio; deve apenas coordená-las atomicamente.

---

# 22. Concorrência na finalização

Cobrir cenários reais de concorrência quando aplicáveis.

Exemplos:

* dois requests tentando finalizar a mesma venda;
* operador dando duplo clique;
* retry após timeout;
* duas vendas concorrendo pelo último saldo disponível.

A proteção já existente no estoque deve ser preservada.

A finalização completa também deve ser idempotente ou estruturalmente protegida contra duplicação financeira.

---

# 23. Falha no meio da finalização

Criar teste se houver nova orquestração.

Simular erro após parte da operação e verificar rollback integral.

Por exemplo:

* estoque baixado;
* primeiro pagamento criado;
* segundo pagamento falha.

Resultado obrigatório:

nenhuma parte parcial deve permanecer caso a operação seja definida como uma única finalização atômica.

---

# 24. Cartão

Não implementar integração TEF/adquirente nesta etapa se ela não existir.

O objetivo inicial é registrar corretamente uma forma de pagamento configurada como cartão.

Não criar integração externa fictícia.

Preparar a arquitetura para futura integração sem acoplar o marco atual a fornecedor específico.

---

# 25. PIX

Mesma regra do cartão.

Registrar o pagamento corretamente usando `payment_methods`.

Não implementar gateway/banco/QR dinâmico sem marco específico.

---

# 26. Venda a prazo

Venda a prazo deve continuar utilizando o domínio financeiro existente.

Não representar parcelamento usando múltiplas formas de pagamento.

Se o fluxo correto atualmente for:

* confirmar venda;
* gerar recebíveis;

preservar essa decisão.

O PDV pode oferecer a ação operacional correspondente, mas não deve criar outro modelo de parcelas.

---

# 27. Pagamento parcial + prazo

Auditar a capacidade já validada no FIN-ADV-01.

Exemplo:

Venda: R$ 1.000

Entrada:

* R$ 300 no PIX

Restante:

* R$ 700 em recebíveis.

O sistema já deve evitar duplicidade entre o que foi pago e o que foi financiado.

O PDV deve aproveitar essa capacidade, não reimplementá-la.

---

# 28. Cancelamento

Venda confirmada deve utilizar o cancelamento canônico de VEN-03.

Não criar cancelamento específico do PDV.

O cancelamento deve preservar:

* estorno de estoque;
* comportamento financeiro;
* comportamento de caixa;
* idempotência;
* auditoria.

Auditar especialmente o efeito sobre pagamentos já registrados.

Se houver uma lacuna entre cancelamento da venda e estorno financeiro/caixa, tratá-la explicitamente.

---

# 29. Estorno de pagamentos

Verificar como pagamentos ligados a uma venda cancelada são tratados hoje.

Não assumir que estornar estoque é suficiente.

Auditar:

* `payments`;
* `cash_movements`;
* `financial_transactions`;
* reversões.

O sistema precisa manter rastreabilidade financeira correta.

Se já estiver resolvido pelo FIN-ADV-01, apenas comprovar.

Se houver lacuna, implementar sem apagar histórico.

Preferir movimentos reversores/append-only.

---

# 30. Comprovante

Auditar o que já existe para impressão/PDF.

O PDV deve permitir ao menos uma saída de comprovante operacional após finalização.

Pode ser inicialmente:

* página imprimível;
* impressão via browser;
* PDF existente reutilizado.

Não implementar integração direta com impressora térmica sem necessidade neste marco.

A solução deve ser compatível com futura impressão em 58/80 mm.

---

# 31. Atalhos de teclado

A operação deve ser eficiente sem depender exclusivamente de mouse.

Avaliar atalhos para ações como:

* foco na busca;
* finalizar venda;
* cancelar operação;
* abrir seleção de cliente;
* editar quantidade;
* remover item.

Evitar atalhos conflitantes com navegador.

Documentar no próprio PDV os principais atalhos, de forma discreta.

---

# 32. Scanner

Garantir experiência adequada para scanner de código de barras do tipo teclado.

Não exigir plugin, driver ou integração nativa especial nesta etapa.

O operador deve conseguir realizar repetidas leituras sem precisar clicar novamente no campo a cada item.

---

# 33. Interface

Criar uma interface clean e operacional, consistente com o padrão do VetorOS 2.

Manter:

* azul tecnologia como cor principal;
* sidebar atual;
* responsividade;
* componentes visuais existentes;
* `ConfirmDialog`;
* sem `alert()`/`confirm()` nativos.

A tela do PDV pode usar mais espaço horizontal que os CRUDs tradicionais.

---

# 34. Layout sugerido

Desktop:

Área principal esquerda/central:

* busca/scanner;
* tabela ou lista dos itens;
* quantidade;
* preço;
* desconto;
* total do item.

Painel lateral direito:

* cliente;
* subtotal;
* desconto;
* total;
* pagamentos;
* valor recebido;
* restante;
* troco;
* botão de finalizar.

Em telas menores, reorganizar verticalmente.

Não sacrificar usabilidade do desktop em nome de um layout genérico.

---

# 35. Foco operacional

O operador deve conseguir fazer a maioria das vendas com fluxo semelhante a:

1. abrir PDV;
2. escanear itens;
3. eventualmente selecionar cliente;
4. pressionar finalizar;
5. informar pagamento;
6. concluir;
7. iniciar próxima venda.

Minimizar navegação entre páginas.

---

# 36. Próxima venda

Após finalização bem-sucedida:

* apresentar confirmação;
* disponibilizar comprovante;
* permitir iniciar imediatamente nova venda.

Evitar obrigar o operador a retornar manualmente para listagem administrativa.

---

# 37. Rascunho pendente

Descobrir se há necessidade real de:

* suspender venda;
* guardar venda;
* recuperar depois.

Não implementar automaticamente.

Se `draft` já permite isso naturalmente, verificar se basta uma listagem de vendas pendentes.

Evitar conceito paralelo de "venda suspensa" se não houver diferença de domínio.

---

# 38. Vendas pendentes

Se operacionalmente útil e simples sobre a estrutura existente, permitir acesso a drafts da filial/operador conforme regras atuais.

Garantir isolamento por tenant/company/branch.

---

# 39. RBAC

Auditar se as permissions existentes são suficientes:

* `sales.read`;
* `sales.create`;
* `sales.update`;
* `sales.confirm`;
* `sales.cancel`;
* permissions de caixa;
* permissions de pagamentos.

Não criar `pos.*` apenas porque existe uma tela nova.

Só criar namespace/permission específica se houver uma ação de negócio realmente distinta.

---

# 40. Segurança e isolamento

Toda API nova deve preservar:

* tenant isolation;
* RLS;
* company/branch context;
* RBAC;
* ownership quando aplicável;
* validação server-side.

Nunca confiar nos totais enviados pelo frontend.

---

# 41. Auditoria

Preservar rastreabilidade de:

* quem realizou venda;
* filial;
* caixa;
* sessão;
* pagamentos;
* cancelamento;
* movimentos de estoque;
* movimentos financeiros.

Não apagar registros para "corrigir" operações.

---

# 42. API

Antes de criar endpoints novos, verificar se os atuais são suficientes.

Endpoints específicos de PDV são aceitáveis quando funcionarem como **orquestradores transacionais**, principalmente na finalização.

Evitar endpoints que simplesmente dupliquem CRUDs existentes com prefixo `/pos`.

---

# 43. Web

A implementação deve priorizar produtividade operacional.

A página do PDV não deve parecer uma ficha de cadastro.

Elementos essenciais devem estar imediatamente acessíveis.

Campos e controles devem ser responsivos e ocupar largura adequada.

---

# 44. Testes mínimos esperados

Depois da descoberta, criar apenas os testes realmente necessários para lacunas ou novas implementações.

Caso seja criado checkout transacional, cobrir obrigatoriamente:

1. venda simples à vista;
2. múltiplas formas de pagamento;
3. dinheiro com troco;
4. tentativa de pagamento insuficiente quando a venda deveria ser integralmente quitada;
5. tentativa de pagamento acima do total;
6. estoque insuficiente;
7. duplo request/retry;
8. concorrência;
9. rollback integral em falha intermediária;
10. RBAC negativo;
11. tenant isolation;
12. caixa fechado;
13. venda cancelada;
14. venda já confirmada;
15. rastreabilidade caixa/pagamento/venda.

Não duplicar testes já existentes apenas para aumentar número de casos.

---

# 45. Gates

Executar os gates canônicos do projeto ao final.

No mínimo, conforme estrutura atual:

* migrations/DB tests;
* API tests;
* Web build;
* testes específicos novos;
* RBAC negativo;
* validações de TypeScript/lint se fizerem parte dos gates canônicos.

Todo erro causado pelas alterações deste marco deve ser corrigido.

Se surgirem falhas pré-existentes que impeçam o fechamento do marco, investigar causa raiz antes de classificá-las como externas.

---

# 46. Roadmap

Somente marcar:

`PDV-ADV-01 — DONE`

quando:

* descoberta estiver documentada;
* lacunas reais estiverem implementadas;
* integrações estiverem consistentes;
* testes necessários estiverem verdes;
* gates canônicos estiverem verdes.

Se a descoberta demonstrar que grande parte do PDV já existe, não reimplementar.

O resultado pode legitimamente ser pequeno se o sistema já possuir a maioria das capacidades.

---

# 47. Resultado esperado

Ao final, o sistema deve permitir uma operação real de balcão:

**Abrir caixa → iniciar venda → localizar/escanear produtos → ajustar itens → selecionar cliente opcional → receber em uma ou várias formas → calcular troco quando houver → finalizar atomicamente → baixar estoque → registrar caixa/financeiro → emitir comprovante → iniciar próxima venda.**

Tudo isso sobre o mesmo núcleo de vendas já consolidado pelo VEN-ADV-01.

---

# 48. Regra final de execução

Execute autonomamente.

Não pedir autorização entre etapas.

Descobrir primeiro.

Implementar somente lacunas reais.

Não recriar funcionalidades maduras.

Não criar arquitetura paralela ao domínio existente.

Não parar após encontrar a primeira lacuna: revisar o fluxo operacional completo do PDV.

Corrigir regressões introduzidas durante o marco.

Somente reportar conclusão quando houver um diagnóstico completo do estado encontrado, alterações realmente necessárias e resultado dos gates finais.
