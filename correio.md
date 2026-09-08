Você é o responsável por consolidar a UX/UI do VetorOS2.

O sistema já possui arquitetura, módulos e regras de negócio implementados. Seu trabalho agora é elevar a interface para um padrão profissional, consistente, clean, moderno e extremamente fácil de usar por clientes que trabalham diariamente com assistência técnica, ordens de serviço, estoque, compras, vendas, caixa e financeiro.

## Objetivo principal

Criar uma linguagem visual única para todo o VetorOS2, preservando os fluxos existentes e melhorando:

* clareza;
* velocidade de operação;
* consistência;
* hierarquia visual;
* legibilidade;
* previsibilidade dos fluxos;
* responsividade;
* sensação de produto maduro.

A interface deve lembrar um ERP/SaaS profissional moderno, mas sem excesso de elementos visuais ou efeitos decorativos.

## Direção visual

Adote uma identidade visual clean baseada em azul tecnológico.

Paleta sugerida:

* Primary: `#2563EB`
* Primary hover/active: `#1D4ED8`
* Sidebar / superfícies escuras opcionais: `#0F172A`
* Background principal: `#F8FAFC`
* Cards/superfícies: `#FFFFFF`
* Bordas: tons frios próximos a `#E2E8F0`
* Texto principal: tons próximos a `#0F172A`
* Texto secundário: tons próximos a `#64748B`

Cores semânticas:

* sucesso: verde;
* atenção: âmbar;
* erro/perigo: vermelho;
* informação: azul.

Não espalhar a cor primária por todos os elementos. O azul deve ser usado principalmente em:

* CTA principal;
* item ativo;
* foco;
* links;
* indicadores importantes;
* elementos selecionados.

Evitar:

* gradientes desnecessários;
* sombras exageradas;
* glassmorphism;
* excesso de bordas;
* componentes muito arredondados;
* ícones decorativos;
* animações supérfluas;
* aparência de landing page dentro do ERP.

## Sidebar

Criar uma sidebar retrátil e extremamente funcional.

Requisitos:

* modo expandido com ícone + nome;
* modo recolhido somente com ícones;
* tooltip no modo recolhido;
* item ativo claramente identificável;
* grupos funcionais bem separados;
* preservar estado expandido/recolhido quando apropriado;
* excelente comportamento em telas menores;
* navegação rápida e sem menus confusos.

Organizar os módulos de forma lógica, por exemplo:

### Operação

* Dashboard
* Clientes
* Equipamentos
* Ordens de Serviço
* Agenda

### Comercial

* Orçamentos
* Vendas

### Suprimentos

* Produtos
* Estoque
* Compras
* Fornecedores, caso exista

### Financeiro

* Caixa
* Recebimentos
* Financeiro

### Gestão

* Relatórios
* Empresas / Filiais
* Usuários / Permissões
* Configurações

Adapte os nomes apenas ao que realmente existe no projeto.

Não invente módulos.

## Cabeçalho

O cabeçalho deve ser simples e funcional.

Deve acomodar de forma limpa:

* título/contexto da página;
* empresa e filial ativas;
* ações globais relevantes;
* usuário logado;
* menu de conta/logout.

Evitar duplicação de informações entre sidebar e header.

## Padrão de páginas CRUD

Quando o cadastro possuir quantidade relevante de campos ou uso frequente, adotar o padrão:

1. listagem;
2. página de criação;
3. página de edição/detalhe.

Exemplos esperados:

* Clientes
* Equipamentos
* Ordens de Serviço
* Produtos
* Compras
* Vendas
* Usuários

Não transformar CRUDs grandes em modais.

Para entidades pequenas ou auxiliares, modais podem ser usados quando melhorarem o fluxo.

## Listagens

Padronizar todas as tabelas.

Cada listagem deve ter, quando aplicável:

* título;
* descrição curta;
* CTA principal;
* busca;
* filtros;
* ordenação;
* paginação;
* estado vazio;
* loading;
* erro;
* menu de ações por linha;
* indicação visual de status.

Manter espaçamento confortável sem desperdiçar área útil.

Tabelas precisam funcionar bem em resolução de notebook.

Priorizar densidade de informação equilibrada.

Não usar cards no lugar de tabela quando a informação for naturalmente tabular.

## Formulários

Padronizar formulários com:

* labels claras;
* ajuda contextual somente quando necessária;
* mensagens de erro próximas ao campo;
* agrupamento lógico de informações;
* espaçamento consistente;
* ações Salvar / Cancelar previsíveis;
* indicação clara de campos obrigatórios;
* máscaras e formatos quando existentes.

Em formulários longos, utilizar seções.

Evitar páginas com dezenas de inputs soltos em uma única coluna.

Não modificar validações de negócio sem necessidade.

## Ordem de Serviço

A Ordem de Serviço é um dos fluxos centrais do produto.

Dar atenção especial à sua usabilidade.

A tela de detalhe/edição deve organizar informações de forma clara, considerando o que já existe no sistema:

* identificação da OS;
* cliente;
* equipamento;
* situação/status;
* descrição/problema;
* itens/serviços/peças;
* valores;
* histórico;
* ações relevantes.

Não inventar dados ou regras.

Se houver muitas informações, usar seções, tabs ou estrutura equivalente, desde que não esconda ações essenciais.

## Dashboard

O dashboard deve ser informativo, não decorativo.

Priorizar indicadores que já existam e sejam úteis à operação.

Evitar:

* gráficos vazios;
* KPIs fictícios;
* números inventados;
* visualização apenas para “encher espaço”.

## Estados visuais

Criar padrões reutilizáveis para:

* loading;
* skeleton;
* vazio;
* erro;
* sucesso;
* acesso negado;
* registro não encontrado;
* ações destrutivas;
* confirmações.

## Componentização

Antes de duplicar padrões, avaliar componentes reutilizáveis.

Exemplos:

* PageHeader;
* DataTable;
* EmptyState;
* StatusBadge;
* FilterBar;
* FormSection;
* ConfirmDialog;
* EntityCombobox;
* MetricCard;
* SidebarNavGroup.

Use os componentes e convenções já existentes no projeto quando forem adequados.

Não introduza uma nova biblioteca visual pesada sem justificativa.

## Design tokens

Centralizar, sempre que possível:

* cores;
* espaçamentos;
* radius;
* tipografia;
* estados;
* dimensões recorrentes.

Evitar estilos arbitrários repetidos página por página.

## Responsividade

O foco principal é desktop e notebook, mas a aplicação deve continuar utilizável em telas menores.

Não sacrificar a experiência desktop tentando transformar tudo em interface mobile.

## Acessibilidade

Garantir:

* contraste adequado;
* foco visível;
* labels associadas;
* navegação por teclado onde aplicável;
* botões com significado claro;
* não depender apenas de cor para indicar estados.

## Preservação funcional

Esta é uma consolidação UX/UI.

Não alterar:

* regras de negócio;
* RLS;
* RBAC;
* multitenancy;
* contratos da API;
* migrations;
* comportamento financeiro;
* regras de estoque;
* regras de vendas;
* regras de OS;

a menos que um erro real de integração da UI obrigue a correção.

Se encontrar problema funcional fora de UX/UI, registre a pendência em vez de expandir o escopo.

## Estratégia de execução

Primeiro faça um inventário das telas atuais.

Identifique:

* inconsistências;
* componentes repetidos;
* padrões conflitantes;
* problemas de navegação;
* CRUDs que deveriam usar páginas;
* cadastros que podem permanecer em modal;
* pontos onde a interface atual diverge desnecessariamente do padrão desejado.

Depois estabeleça o padrão visual base e aplique-o progressivamente.

Não redesenhe uma única página isoladamente e deixe as demais inconsistentes.

Priorize primeiro:

1. shell geral;
2. sidebar;
3. header;
4. tipografia;
5. buttons;
6. inputs;
7. tabelas;
8. formulários;
9. páginas principais;
10. refinamentos.

## VetorOS1

Os usuários atuais já estão acostumados com o VetorOS1.

Quando houver equivalência clara entre funcionalidades, preserve conceitos de navegação e organização que reduzam a curva de aprendizado.

Não copie limitações visuais antigas apenas por fidelidade.

O objetivo é:

**familiaridade funcional + qualidade visual moderna.**

## Critério final

O produto deve transmitir:

* confiança;
* estabilidade;
* tecnologia;
* organização;
* velocidade;
* profissionalismo.

A interface deve parecer um sistema comercial pronto para ser utilizado diariamente por empresas, e não um painel administrativo genérico ou um protótipo.

Faça todas as alterações de UX/UI necessárias dentro desse escopo.

Não faça commit.

Ao final, entregue um relatório contendo:

* diagnóstico inicial;
* padrão visual adotado;
* componentes criados ou consolidados;
* páginas alteradas;
* decisões de UX;
* diferenças relevantes em relação ao padrão antigo;
* validações realizadas;
* pendências que ficaram fora do escopo.

Execute sem solicitar autorização intermediária.


## Adendo obrigatório — largura e responsividade dos formulários

Todos os formulários devem utilizar a largura disponível de forma adequada.

Regras:

* containers de formulário devem trabalhar com `width: 100%`;
* inputs, selects, textareas, comboboxes e componentes equivalentes devem ocupar `width: 100%` dentro de sua coluna;
* evitar campos com larguras fixas arbitrárias;
* o layout deve ser totalmente responsivo;
* usar grid responsivo para distribuir campos conforme a largura da tela;
* em telas largas, campos relacionados podem ficar em duas, três ou mais colunas quando fizer sentido;
* em telas menores, o grid deve reduzir automaticamente até uma única coluna;
* campos longos, como nome, razão social, descrição, endereço e observações, podem ocupar a linha inteira;
* campos curtos, como número, UF, CEP, quantidade e datas, podem compartilhar colunas em desktop;
* não limitar todo formulário a uma coluna estreita centralizada quando houver espaço útil disponível;
* manter margens laterais e `max-width` apenas quando isso melhorar a leitura, sem desperdiçar excessivamente a área disponível;
* páginas de CRUD devem aproveitar bem a largura de notebooks e monitores;
* nenhuma tela deve gerar scroll horizontal por causa do formulário;
* ações como Salvar e Cancelar também precisam se adaptar corretamente em telas pequenas.

Objetivo visual:

**formulários largos, organizados, fluidos e responsivos, aproveitando 100% da área útil sem parecerem esticados ou desorganizados.**
