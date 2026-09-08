Antes de continuar qualquer trabalho de UX/UI, faça uma auditoria funcional completa do VetorOS2.

O objetivo desta etapa NÃO é implementar alterações.

Precisamos primeiro descobrir exatamente o que o sistema possui hoje, quais campos existem, quais operações são permitidas e onde os módulos estão rasos ou incompletos para utilização real por uma empresa.

## Contexto

O VetorOS2 pretende ser um sistema operacional/ERP especializado para empresas de assistência técnica e serviços, envolvendo:

* cadastros;
* clientes;
* equipamentos;
* ordens de serviço;
* orçamentos;
* agenda;
* produtos;
* estoque;
* fornecedores;
* compras;
* vendas;
* caixa;
* recebimentos;
* financeiro;
* relatórios;
* usuários e permissões.

Alguns módulos aparentemente foram implementados com profundidade insuficiente.

Exemplos já percebidos:

* Ordem de Serviço não apresenta todas as operações esperadas, como edição completa e tratamento adequado de exclusão/cancelamento;
* Pedido de Compra aparentemente possui apenas fornecedor, custo/frete e observações, sem representar adequadamente aquilo que será comprado;
* podem existir outros módulos com CRUD ou fluxos excessivamente simplificados.

Não assuma que esses são os únicos problemas.

## Etapa 1 — Inventário do sistema atual

Percorra o projeto inteiro e produza um inventário por módulo.

Para cada entidade/módulo, documente:

### Cadastro

* tabela(s) envolvidas;
* campos existentes no banco;
* campos obrigatórios;
* campos opcionais;
* relacionamentos;
* enums/status;
* constraints relevantes;
* índices relevantes.

### API

Liste:

* endpoints existentes;
* operações disponíveis;
* create;
* read;
* update;
* delete;
* cancel;
* reopen;
* confirm;
* approve;
* finalize;
* reverse;
* outras ações específicas.

Informe claramente quando determinada ação NÃO existir.

### Interface

Liste:

* página de listagem;
* página create;
* página detail;
* página edit;
* modais;
* ações disponíveis;
* filtros;
* buscas;
* campos exibidos;
* campos editáveis.

### Regras

Identifique:

* validações;
* transições de estado;
* bloqueios;
* permissões;
* dependências entre módulos.

## Etapa 2 — Classificação

Classifique cada módulo como:

* COMPLETO;
* UTILIZÁVEL COM AJUSTES;
* RASO;
* INCOMPLETO;
* ESTRUTURAL APENAS.

Não considere um módulo completo apenas porque possui tabela, API e tela.

Avalie se ele representa uma operação empresarial real.

## Etapa 3 — Cadastros primeiro

Analise primeiro os cadastros fundamentais.

Exemplos:

* clientes;
* equipamentos;
* produtos;
* fornecedores;
* usuários;
* empresas;
* filiais;
* demais cadastros auxiliares existentes.

Para cada cadastro, identifique quais campos fundamentais para operação real estão faltando.

Não implemente ainda.

## Etapa 4 — Operações

Depois analise profundamente os processos transacionais.

### Ordem de Serviço

Verifique se existe suporte adequado para:

* abertura;
* edição;
* cliente;
* equipamento;
* defeito/reclamação;
* diagnóstico;
* solução;
* técnico/responsável;
* prioridade;
* status;
* datas;
* itens;
* serviços;
* peças;
* quantidades;
* valores;
* descontos;
* observações;
* histórico;
* orçamento relacionado;
* cancelamento;
* encerramento;
* reabertura quando aplicável;
* impressão/documentos;
* auditoria.

Não presuma que todos precisam existir; classifique o que é realmente necessário.

### Compras

Audite:

* fornecedores;
* pedido de compra;
* itens do pedido;
* produto;
* descrição;
* unidade;
* quantidade;
* quantidade recebida;
* preço unitário;
* desconto;
* subtotal;
* frete;
* outras despesas;
* total;
* previsão de entrega;
* status;
* aprovação;
* recebimento parcial;
* recebimento total;
* entrada no estoque;
* vínculo financeiro;
* cancelamento;
* observações.

Um pedido de compra sem itens não deve ser considerado um fluxo de compras completo.

### Estoque

Verifique:

* saldo;
* movimentações;
* entrada;
* saída;
* reserva;
* ajuste;
* transferência;
* origem da movimentação;
* custo;
* estoque mínimo;
* unidade;
* localização quando aplicável;
* rastreabilidade.

### Venda

Verifique:

* cabeçalho;
* cliente;
* itens;
* quantidades;
* preços;
* descontos;
* totais;
* pagamentos;
* estoque;
* caixa;
* cancelamento;
* reversão.

### Financeiro / Caixa

Verifique profundidade equivalente de:

* contas;
* lançamentos;
* recebimentos;
* pagamentos;
* formas de pagamento;
* caixa;
* abertura;
* fechamento;
* conciliação;
* transferências;
* reversões;
* histórico.

### Agenda

Verifique se representa adequadamente:

* compromisso;
* OS;
* cliente;
* equipamento;
* responsável;
* horário;
* duração;
* situação;
* observações;
* reagendamento;
* cancelamento.

## Etapa 5 — Fluxos entre módulos

Mapeie também os fluxos reais entre módulos.

Exemplos:

Cliente
→ Equipamento
→ Orçamento
→ Ordem de Serviço
→ Peças/Serviços
→ Estoque
→ Recebimento
→ Caixa
→ Financeiro

Fornecedor
→ Pedido de Compra
→ Itens
→ Recebimento
→ Estoque
→ Contas a pagar / financeiro

Venda
→ Itens
→ Estoque
→ Recebimento
→ Caixa
→ Financeiro

Identifique onde esses fluxos estão completos e onde estão interrompidos.

## Etapa 6 — Análise de lacunas

Produza uma tabela por módulo contendo:

* situação atual;
* campos existentes;
* operações existentes;
* campos ausentes;
* operações ausentes;
* impacto;
* prioridade;
* recomendação.

Prioridades:

* P0 — impede operação real;
* P1 — necessário antes de comercialização;
* P2 — importante para maturidade;
* P3 — melhoria futura.

## Etapa 7 — Não confundir DELETE com regra de negócio

Avalie cuidadosamente exclusões.

Nem toda entidade transacional deve possuir DELETE físico.

Para documentos como:

* OS;
* venda;
* compra;
* financeiro;
* caixa;

determine quando o correto é:

* excluir;
* cancelar;
* estornar;
* inativar;
* preservar histórico.

Cadastros e documentos transacionais devem ser tratados de maneiras diferentes.

## Entrega

Não modifique código.

Não crie migration.

Não altere roadmap ainda.

Não implemente telas.

Entregue somente um relatório estruturado contendo:

1. visão geral do sistema atual;
2. inventário dos módulos;
3. inventário de campos;
4. inventário de ações;
5. profundidade funcional de cada módulo;
6. lacunas encontradas;
7. fluxos incompletos;
8. classificação P0/P1/P2/P3;
9. proposta de sequência de correções.

A proposta de sequência deve começar pelos cadastros fundamentais e depois avançar para operações transacionais.

Não abra nenhum novo marco automaticamente.

Ao terminar, pare e apresente o diagnóstico para decisão.
