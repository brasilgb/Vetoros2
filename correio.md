# UX-05 — Padronização Final de Botões de Ação e Tabs

Antes de continuar o fechamento operacional do `PILOT-08`, executar uma revisão completa da interface Web.

Existe uma pendência visual ainda não resolvida:

1. botões de ações das telas;
2. tabs/abas das telas.

Esta rodada deve corrigir isso de forma transversal e consistente no VetorOS 2.

Não iniciar funcionalidades novas.

Não alterar regras de negócio.

Não trabalhar em módulo fiscal.

`FIS-NFCE-01` permanece suspenso.

---

# 1. Auditoria completa

Revisar todas as telas Web existentes, incluindo no mínimo:

* Dashboard;
* Clientes;
* Equipamentos;
* Ordens de Serviço;
* Orçamentos;
* Agenda;
* Estoque;
* Fornecedores;
* Compras;
* Vendas;
* PDV;
* Caixa;
* Contas a Receber;
* Contas a Pagar;
* Tesouraria;
* Relatórios;
* Usuários;
* Papéis/permissões;
* Empresas;
* Filiais;
* Auditoria;
* Configurações/contexto operacional.

Inspecionar:

* listagens;
* create;
* edit;
* detalhes;
* telas com tabs;
* telas com ações no header;
* ações por linha de tabela;
* ações destrutivas;
* ações secundárias;
* ações condicionadas por estado ou permissão.

---

# 2. Botões de ações

Hoje os botões de ações ainda não estão suficientemente padronizados.

Criar ou consolidar um padrão único.

## Ações principais

Exemplos:

* Novo;
* Salvar;
* Confirmar;
* Aprovar;
* Finalizar;
* Registrar;
* Receber;
* Pagar.

Devem possuir destaque visual de ação principal.

Em telas de formulário, normalmente:

```text
Cancelar                              Salvar
```

ou equivalente.

A ação principal deve ficar visualmente evidente.

---

# 3. Ações secundárias

Exemplos:

* Editar;
* Visualizar;
* Histórico;
* Imprimir;
* Duplicar;
* Voltar;
* Exportar.

Usar tratamento visual secundário consistente.

Não transformar todas as ações em botões primários.

---

# 4. Ações destrutivas ou críticas

Exemplos:

* Cancelar venda;
* Estornar;
* Excluir quando permitido;
* Reverter;
* Fechar caixa quando irreversível ou crítico.

Devem possuir representação visual claramente distinta.

Preservar `ConfirmDialog` existente.

Não utilizar:

```javascript
alert()
confirm()
```

do navegador.

---

# 5. Ações em tabelas

Padronizar a coluna:

```text
Ações
```

Evitar diversas palavras/botões grandes ocupando espaço excessivo em cada linha.

Preferência:

* ícones consistentes;
* tooltip;
* menu de ações (`...`) quando houver várias opções;
* ação principal direta quando necessário.

Exemplo conceitual:

```text
[ visualizar ] [ editar ] [ ... ]
```

ou:

```text
[ abrir ] [...]
```

Não deixar cada CRUD utilizando um padrão diferente.

Em mobile, garantir que as ações continuem acessíveis sem quebrar layout.

---

# 6. Ícones

Auditar os ícones disponíveis atualmente no projeto.

Usar a biblioteca já adotada.

Não adicionar nova biblioteca de ícones se não houver necessidade.

Padronizar significado:

* olho → visualizar;
* lápis → editar;
* mais → criar;
* impressora → imprimir;
* download → exportar;
* histórico/clock → histórico;
* trash → excluir;
* X/circle-x → cancelar;
* check → confirmar/aprovar;
* menu `...` → mais ações.

Ícone sozinho deve ter:

* `aria-label`;
* tooltip quando apropriado;
* estado hover/focus.

---

# 7. Tabs / abas

Auditar todas as telas que possuem navegação interna por tabs.

As tabs devem apresentar padrão visual único.

Exemplo conceitual:

```text
[ Geral ] [ Itens ] [ Financeiro ] [ Histórico ]
  ━━━━━
```

ou padrão equivalente compatível com a identidade atual.

A aba ativa deve ser claramente identificável.

Não depender apenas de mudança sutil de cor.

---

# 8. Comportamento das tabs

Garantir:

* tab ativa evidente;
* hover consistente;
* focus acessível;
* cursor correto;
* responsividade;
* navegação por teclado quando o componente permitir;
* nenhuma tab aparentemente clicável quando estiver desabilitada.

Em telas pequenas, usar solução adequada:

* scroll horizontal;
* overflow controlado;
* ou quebra planejada.

Não permitir que as tabs destruam o layout mobile.

---

# 9. Tabs não devem substituir rotas quando não fizer sentido

Preservar a regra de UX já definida:

CRUD principal continua separado em:

```text
/list
/create
/edit
```

Tabs devem servir para subdivisão lógica da mesma entidade ou tela.

Não transformar create/edit/list em tabs artificiais.

---

# 10. Componentes compartilhados

Verificar se já existem componentes reutilizáveis para:

* `Button`;
* `IconButton`;
* `ActionMenu`;
* `Tabs`;
* `TabList`;
* `Tab`;
* `PageActions`;
* componentes equivalentes.

Se existirem, consolidá-los.

Se não existirem e houver duplicação significativa, criar componentes compartilhados.

Evitar:

```tsx
className="..."
```

copiado manualmente em dezenas de telas para implementar o mesmo botão.

O objetivo é haver uma fonte visual comum para ações e tabs.

---

# 11. Variantes de botão

Preferencialmente disponibilizar variantes semânticas equivalentes a:

```text
primary
secondary
outline
ghost
danger
```

Não é obrigatório utilizar exatamente esses nomes se o design system existente utilizar outra convenção.

O importante é eliminar variações arbitrárias entre telas.

---

# 12. Tamanho dos botões

Padronizar tamanhos para contextos diferentes.

Exemplo:

```text
normal
small
icon
```

Ações de tabela devem ser compactas.

Ações principais de página não devem parecer microbotões.

---

# 13. Cabeçalho das páginas

Revisar o padrão:

```text
Título da página                     [ ação principal ]
Descrição opcional                   [ ações secundárias ]
```

Evitar páginas onde:

* botão Novo aparece em local diferente;
* Salvar aparece no topo em umas telas e no rodapé em outras sem justificativa;
* Voltar utiliza formatos diferentes;
* várias ações competem visualmente.

---

# 14. Formulários

Padronizar footer/área de ações.

Exemplo:

```text
Cancelar                         Salvar alterações
```

ou:

```text
Voltar                           Criar cliente
```

Preservar comportamento adequado de submit/loading.

Durante submit:

* impedir duplo clique;
* mostrar estado de processamento;
* manter feedback visual.

---

# 15. Permissões

Botões não permitidos pelo RBAC não devem aparecer para usuários sem capability correspondente.

Preservar a correção feita no `UX-04`.

Não confiar somente na ocultação visual.

A API continua sendo a autoridade de autorização.

---

# 16. Estados da entidade

Ações também devem respeitar o estado operacional.

Exemplos:

Uma venda `cancelled` não pode mostrar novamente:

```text
Cancelar venda
```

Uma OS finalizada não deve apresentar ações incompatíveis com seu estado.

Um orçamento aprovado não deve exibir ações que façam sentido somente em `draft`.

Auditar os principais casos existentes.

---

# 17. Responsividade

Testar no mínimo:

* desktop;
* viewport intermediário;
* mobile.

Verificar especialmente:

* cabeçalho + ações;
* tabs largas;
* menu de ações;
* botões em tabelas;
* rodapé de formulários.

Não aceitar overflow horizontal da página causado pelos controles de ação.

---

# 18. Acessibilidade

Garantir:

* `aria-label` em botões somente com ícone;
* foco visível;
* elementos realmente interativos usando `button`/`a`;
* não usar `div` clicável sem semântica;
* tabs acessíveis conforme componente/base utilizada;
* contraste adequado.

---

# 19. Consistência visual

Manter o padrão visual já definido para VetorOS 2:

* interface clean;
* azul tecnologia como identidade principal;
* sidebar retrátil;
* header;
* breadcrumbs;
* formulários full width;
* responsividade;
* visual semelhante à evolução natural do VetorOS 1.

Não redesenhar o sistema inteiro.

Esta rodada é de consolidação.

---

# 20. Validação

Após as alterações executar:

```bash
pnpm --filter web build
```

e os testes Web existentes relevantes.

Se houver lint/typecheck separados, executar também conforme scripts existentes.

Validar que não foram introduzidos erros de:

* TypeScript;
* React;
* Next.js;
* hydration;
* rotas;
* permissões;
* build.

---

# 21. Evidência esperada

No relatório final listar:

## Componentes criados ou alterados

Exemplo:

```text
Button
IconButton
ActionMenu
Tabs
PageActions
```

Somente informar componentes realmente existentes/alterados.

## Telas revisadas

Listar módulos efetivamente auditados.

## Alterações

Separar:

* botões de página;
* botões de formulário;
* ações de tabela;
* ações destrutivas;
* tabs;
* responsividade;
* acessibilidade.

---

# 22. Critério de conclusão

`UX-05` somente pode ser considerado `DONE` quando:

| Item                 | Esperado     |
| -------------------- | ------------ |
| Ações principais     | Padronizadas |
| Ações secundárias    | Padronizadas |
| Ações destrutivas    | Padronizadas |
| Ações das tabelas    | Padronizadas |
| Ícones               | Consistentes |
| Tooltips/aria-label  | OK           |
| Tabs                 | Padronizadas |
| Tab ativa            | Evidente     |
| Tabs mobile          | OK           |
| Page headers         | Padronizados |
| Form actions         | Padronizados |
| RBAC visual          | Preservado   |
| Estados operacionais | Respeitados  |
| Build Web            | PASS         |

---

# 23. correio.md

Ao concluir, atualizar `correio.md` com o novo marco:

```markdown
# Execução de `correio.md`

Data: 2026-09-11

## Comparação

...

## UX-05 — Padronização Final de Botões de Ação e Tabs

### Auditoria

...

### Botões de ações

...

### Ações de tabelas

...

### Tabs

...

### Componentes compartilhados

...

### Responsividade e acessibilidade

...

### Permissões e estados

...

### Testes

...

### Correções realizadas

...

### Pendências

...

### Classificação

`UX-05 — DONE`
```

Se houver tela ainda fora do padrão, não marcar como `DONE`.

Não realizar commit.

Não iniciar `PILOT-08` automaticamente.

Executar auditoria, correções e testes diretamente, sem solicitar autorização intermediária.
