# FIS-ADV-02 — Fluxo Fiscal Operacional Integrado

## Objetivo

Executar autonomamente o próximo marco:

**FIS-ADV-02 — Fluxo Fiscal Operacional Integrado**

O objetivo deste marco é integrar o domínio fiscal já implementado ao fluxo operacional normal do VetorOS, principalmente:

* PDV → documento fiscal;
* Venda → documento fiscal;
* Ordem de Serviço → documento fiscal;
* configuração dos dados fiscais necessários;
* navegação e UX entre documentos de origem e documentos fiscais.

Este marco é exclusivamente de **domínio, aplicação, UX, validações internas, banco e testes**.

## Restrição obrigatória

Nesta rodada, NÃO trabalhar, pesquisar, documentar, alterar ou mencionar:

* APIs fiscais externas;
* provedores fiscais;
* Focus NFe;
* SEFAZ;
* endpoints externos;
* autenticação externa;
* credenciais;
* sandbox/homologação externa;
* payload de terceiros;
* comunicação HTTP fiscal;
* integração com serviços fiscais externos.

Se existir código previamente implementado relacionado a qualquer integração externa, ele deve permanecer intacto.

**Não alterar, ampliar, remover, refatorar ou testar essa camada nesta rodada.**

O foco é somente o funcionamento interno do VetorOS.

---

# 1. Descoberta obrigatória antes de alterar código

Antes de implementar qualquer coisa, auditar integralmente o estado atual de:

* FIS-ADV-01;
* PDV-ADV-01;
* VEN-ADV-01;
* OS-ADV-02;
* CAD-01;
* companies;
* branches;
* inventory_parts;
* sales;
* service_orders;
* fiscal_documents;
* fiscal_document_items;
* rotas Web relacionadas;
* permissions/RBAC;
* RLS;
* auditoria existente.

Identificar o que já está pronto e reutilizar.

Não duplicar estruturas existentes.

---

# 2. PDV → Fiscal

O operador deve conseguir sair da conclusão de uma venda do PDV diretamente para o fluxo fiscal.

Após uma venda ser confirmada/concluída no PDV:

* mostrar ação clara **Emitir documento fiscal**;
* se a venda já possuir documento fiscal, mostrar **Ver documento fiscal**;
* nunca criar documento duplicado para a mesma origem;
* manter link entre venda e documento fiscal;
* permitir retornar do documento fiscal para a venda;
* preservar integralmente o checkout existente.

O fluxo comercial deve continuar sendo:

```text
Venda
→ Estoque
→ Pagamento
→ Venda concluída
→ Documento fiscal
```

Fiscal não deve ser condição para concluir a venda.

Uma falha posterior no processo fiscal nunca pode:

* desfazer a venda;
* devolver estoque;
* remover pagamento;
* alterar caixa;
* corromper financeiro.

---

# 3. Venda → Fiscal fora do PDV

Na tela normal de uma venda confirmada:

* disponibilizar ação para criar/acessar seu documento fiscal;
* identificar visualmente quando já existe documento;
* impedir duplicidade;
* permitir navegação bidirecional:

```text
Venda → Fiscal
Fiscal → Venda
```

A ação não deve aparecer de forma incorreta para venda:

* draft;
* cancelada;
* ou em estado incompatível.

Reutilizar as regras já implementadas no FIS-ADV-01.

---

# 4. Ordem de Serviço → Fiscal

Na tela da Ordem de Serviço:

Para OS elegível conforme regras já existentes:

* disponibilizar ação **Emitir documento fiscal**;
* se já existir documento, mostrar **Ver documento fiscal**;
* impedir documento duplicado para a mesma origem;
* permitir navegação bidirecional:

```text
OS → Fiscal
Fiscal → OS
```

Não criar regra paralela.

Continuar respeitando exatamente os estados já definidos no FIS-ADV-01 para elegibilidade da OS.

Orçamento aprovado não deve ser tratado como documento fiscal.

---

# 5. Origem fiscal visível

Na listagem fiscal e na tela individual do documento deixar extremamente claro:

* tipo da origem;
* número da venda ou OS;
* cliente;
* empresa;
* filial;
* situação;
* valor;
* data;
* link para origem.

Evitar exibir apenas UUIDs quando houver um número comercial disponível.

Exemplos:

```text
Venda #000154
OS #000438
```

---

# 6. Dados fiscais da empresa

Auditar os campos fiscais já existentes em `companies`.

Garantir interface administrativa adequada para manutenção dos campos existentes necessários ao domínio fiscal.

Reutilizar os campos existentes.

Não criar segunda configuração fiscal da empresa.

A interface deve seguir o padrão visual do VetorOS 2:

* formulário responsivo;
* largura adequada;
* labels claros;
* validações;
* mensagens de erro;
* create/edit conforme arquitetura atual.

---

# 7. Dados fiscais da filial

Auditar `branches`.

Os dados relacionados ao estabelecimento/município já existentes no modelo devem estar disponíveis para manutenção quando aplicável.

Não duplicar identidade fiscal da empresa dentro da filial se o modelo definido no FIS-ADV-01 estabeleceu que ela pertence à empresa.

Respeitar a decisão arquitetural já registrada:

```text
Empresa = identidade fiscal
Filial = estabelecimento/endereço da operação
```

---

# 8. Dados fiscais dos produtos

Auditar `inventory_parts`.

Os campos fiscais já adicionados anteriormente devem poder ser mantidos pela interface administrativa quando aplicável.

Exemplos de informações já pertencentes ao cadastro:

* NCM;
* CEST;
* origem;
* CFOP padrão;
* GTIN/EAN já existente.

Não construir motor tributário.

Não inventar enquadramento fiscal automaticamente.

O sistema apenas armazena e utiliza os dados definidos pelo usuário.

---

# 9. Validação antes da ação fiscal

Antes de iniciar uma ação fiscal interna, validar os dados obrigatórios conhecidos pelo domínio.

Quando houver ausência de dados:

não retornar apenas erro técnico.

Apresentar mensagem operacional clara, por exemplo:

```text
Não foi possível continuar.

Verifique os seguintes dados:

- CNPJ da empresa
- regime tributário
- código IBGE da filial
- NCM do produto XPTO
```

Sempre que possível incluir link para corrigir o cadastro correspondente.

---

# 10. Idempotência interna

Garantir que múltiplos cliques ou refresh da interface não criem documentos fiscais duplicados.

Para uma mesma origem, deve existir no máximo o documento permitido pela modelagem atual.

Validar essa proteção também no banco quando apropriado, não apenas na UI.

---

# 11. Histórico e rastreabilidade

Garantir que as operações relevantes do fluxo fiscal continuem aparecendo na auditoria existente.

Não criar sistema paralelo de logs.

Quando o documento possuir origem:

* registrar vínculo corretamente;
* preservar o documento de origem;
* preservar snapshots;
* não permitir alteração retroativa da venda/OS refletir incorretamente no documento fiscal já congelado.

---

# 12. Permissões

Reutilizar exatamente as permissions já existentes:

```text
fiscal.read
fiscal.create
fiscal.issue
fiscal.cancel
```

Não criar permissions redundantes.

Testar pelo menos:

* usuário autorizado;
* usuário sem fiscal.read;
* usuário sem fiscal.create;
* tentativa cross-tenant.

Comportamento esperado de autorização:

```text
403
```

Cross-tenant deve continuar invisível:

```text
404
```

quando esse for o padrão já adotado no projeto.

---

# 13. UX

Manter os padrões definidos no VetorOS 2:

* sidebar existente;
* breadcrumbs;
* telas responsivas;
* tabelas consistentes;
* ações visíveis conforme estado;
* sem `alert()`;
* sem `confirm()`;
* usar componentes existentes de confirmação;
* mensagens de erro claras;
* evitar modais grandes para CRUD completo.

A integração fiscal deve parecer parte natural de:

```text
Venda
PDV
OS
```

e não um módulo isolado do restante do produto.

---

# 14. Não duplicar documento

Auditar especificamente a possibilidade de:

```text
PDV → cria documento
```

e depois:

```text
Fiscal → cria outro documento da mesma venda
```

Isso não pode acontecer.

O mesmo vale para OS.

Implementar proteção estrutural apropriada caso ainda não exista.

---

# 15. Testes obrigatórios

Adicionar cobertura automatizada proporcional às mudanças.

Cobrir no mínimo:

### Venda

* venda confirmada pode iniciar fluxo fiscal;
* venda draft não pode;
* venda cancelada não pode;
* documento existente não é duplicado;
* link venda → fiscal;
* link fiscal → venda.

### PDV

* após checkout concluído aparece ação fiscal;
* checkout permanece concluído independentemente do passo fiscal;
* refresh/duplo clique não duplica documento.

### OS

* OS elegível permite fluxo fiscal;
* OS inelegível não permite;
* documento existente é reutilizado;
* orçamento não é tratado como origem fiscal.

### Cadastros

* campos fiscais da empresa persistem;
* campos fiscais da filial persistem;
* campos fiscais dos produtos persistem;
* validações obrigatórias produzem mensagens operacionais.

### Segurança

* RBAC negativo;
* isolamento de tenant;
* RLS;
* tentativa de utilizar origem de outro tenant;
* acesso direto por UUID estrangeiro.

---

# 16. Descoberta antes de migration

Não criar migration automaticamente.

Antes:

1. auditar todas as constraints existentes;
2. verificar se já existe proteção de unicidade/origem;
3. verificar índices;
4. verificar foreign keys;
5. verificar checks;
6. verificar triggers.

Só criar migration se houver lacuna estrutural real.

Se a garantia já existir no banco, não duplicar.

---

# 17. Regressão

Nenhuma alteração deste marco pode quebrar:

* clientes;
* ativos;
* OS;
* orçamentos;
* estoque;
* compras;
* vendas;
* PDV;
* caixa;
* contas a pagar;
* contas a receber;
* tesouraria;
* agenda;
* relatórios;
* administração.

---

# 18. Gate final

Executar o ambiente oficial do projeto conforme documentação existente.

Rodar:

```text
DB tests
API tests
lint
typecheck
Web build
git diff --check
```

Se houver testes Web automatizados já estabelecidos para esses fluxos, executá-los também.

Todos os gates devem permanecer 100% verdes.

Não encerrar o marco com falhas novas.

---

# 19. Relatório final obrigatório

Ao terminar, registrar em `executed.md`:

```text
FIS-ADV-02 — Fluxo Fiscal Operacional Integrado
```

Informar objetivamente:

```text
PDV → Fiscal: SIM / PARCIAL / NÃO
Venda → Fiscal: SIM / PARCIAL / NÃO
OS → Fiscal: SIM / PARCIAL / NÃO
Configuração empresa: SIM / PARCIAL / NÃO
Configuração filial: SIM / PARCIAL / NÃO
Configuração produtos: SIM / PARCIAL / NÃO
Proteção contra duplicidade: SIM / PARCIAL / NÃO
RBAC: SIM / PARCIAL / NÃO
RLS: SIM / PARCIAL / NÃO
```

Também informar:

* descoberta realizada;
* estruturas reutilizadas;
* arquivos alterados;
* migrations criadas, se realmente necessárias;
* testes adicionados;
* resultados completos dos gates;
* limitações reais restantes.

---

# 20. Critério de conclusão

O marco só pode ser marcado:

```text
FIS-ADV-02 = DONE
```

quando o usuário conseguir seguir naturalmente:

```text
PDV
→ concluir venda
→ ação fiscal
→ consultar documento
→ voltar à venda
```

e:

```text
OS concluída
→ ação fiscal
→ consultar documento
→ voltar à OS
```

sem duplicidade, sem quebra financeira, sem quebra de estoque e sem violação de tenant.

## Regra final

Executar autonomamente até concluir o escopo permitido.

Não interromper para pedir autorização entre descoberta, implementação, testes e correções.

Não fazer commit.

**Não trabalhar em nenhuma integração fiscal externa nesta rodada.**
