# FIS-ADV-01 — Fiscal Operacional Completo

Data: 2026-09-10

## 1. Objetivo

Executar o próximo marco avançado do VetorOS 2:

**FIS-ADV-01 — Fiscal Operacional Completo**

O objetivo é descobrir e, somente onde houver lacuna real, completar a infraestrutura fiscal necessária para que o sistema consiga representar corretamente documentos fiscais originados das operações já existentes.

O marco deve considerar principalmente:

* Vendas / PDV;
* Ordens de Serviço;
* clientes;
* empresas e filiais;
* produtos/peças;
* serviços;
* pagamentos e financeiro;
* futura integração com provedor fiscal, especialmente Focus NFe.

Não implementar emissão fiscal "de fachada".

O domínio fiscal deve se apoiar nas operações reais já existentes.

---

## 2. Estado consolidado que NÃO deve ser refeito

Considere concluídos e preserve:

* COM-ADV-01 — Compras Operacionais Completas;
* FIN-ADV-01 — Financeiro Operacional Completo;
* VEN-ADV-01 — Vendas Operacionais Completas;
* PDV-ADV-01 — Frente de Caixa Operacional Completa;
* OS-ADV-01 / OS-ADV-02;
* estoque;
* caixa;
* recebíveis;
* pagáveis;
* tesouraria;
* clientes;
* empresas;
* filiais;
* fornecedores;
* equipamentos;
* RBAC;
* auditoria.

Não criar estruturas fiscais paralelas para substituir `sales`, `service_orders`, `payments`, `customers`, `companies`, `branches` ou `inventory_parts`.

---

# 3. DESCOBERTA OBRIGATÓRIA

Antes de qualquer código ou migration, auditar integralmente o estado atual.

Responder objetivamente.

### 3.1 Estruturas fiscais existentes

Localizar qualquer estrutura relacionada a:

* fiscal;
* invoice;
* nota fiscal;
* NF-e;
* NFC-e;
* NFS-e;
* Focus NFe;
* SEFAZ;
* prefeitura;
* série;
* número fiscal;
* chave de acesso;
* XML;
* DANFE;
* RPS;
* CNAE;
* NCM;
* CEST;
* CFOP;
* CST;
* CSOSN;
* ICMS;
* IPI;
* PIS;
* COFINS;
* ISS;
* inscrição estadual;
* inscrição municipal;
* regime tributário.

Não assumir que algo não existe sem pesquisar migrations, schema, API, Web, contratos e testes.

---

## 4. Cadastro da empresa emissora

Auditar `companies` e `branches`.

Confirmar quais dados fiscais já existem e quais realmente faltam.

Avaliar, no mínimo:

* razão social;
* nome fantasia;
* CNPJ;
* IE;
* IM;
* endereço;
* município;
* UF;
* CEP;
* código IBGE;
* telefone;
* e-mail;
* regime tributário;
* CNAE;
* ambiente fiscal homologação/produção.

Não criar tabela separada de "emitente" se `companies`/`branches` puderem representar isso corretamente.

Determinar explicitamente se a emissão fiscal pertence à:

```text
Tenant
  └── Company
       └── Branch
```

A decisão deve refletir a operação real do VetorOS.

---

# 5. Cliente / destinatário

Auditar `customers` e seus endereços/contatos.

Confirmar capacidade de representar:

### Pessoa física

* CPF;
* nome;
* endereço;
* município;
* UF;
* CEP;
* e-mail;
* telefone.

### Pessoa jurídica

* CNPJ;
* razão social/nome;
* IE;
* indicador de contribuinte, caso necessário;
* endereço;
* município;
* UF;
* CEP.

Não duplicar cadastro de cliente dentro do módulo fiscal.

O documento fiscal poderá possuir **snapshot fiscal do destinatário**, caso necessário para preservar histórico.

---

# 6. Produtos e peças

Auditar `inventory_parts`.

Determinar quais campos fiscais já existem.

Avaliar necessidade real de:

* NCM;
* CEST;
* origem da mercadoria;
* unidade tributável/comercial;
* GTIN/EAN;
* CFOP padrão;
* CST/CSOSN;
* alíquotas ou classificação tributária.

Não transformar `inventory_parts` em um motor tributário completo sem necessidade.

Separar claramente:

```text
dados cadastrais fiscais do produto
```

de:

```text
tributação efetivamente aplicada no documento
```

A tributação aplicada deverá ser preservada como snapshot quando houver emissão.

---

# 7. Serviços

Auditar como serviços são atualmente representados em:

* `service_order_items`;
* `sale_items`;
* demais estruturas existentes.

Determinar como representar os dados necessários para NFS-e, incluindo somente quando aplicável:

* código de serviço;
* item da lista LC 116;
* CNAE;
* município de incidência;
* alíquota ISS;
* retenção.

Não inventar catálogo paralelo de serviços se uma estrutura existente puder ser estendida com clareza.

---

# 8. Tipos de documento fiscal

Avaliar separadamente:

### NFC-e

Principal candidato para venda de balcão / PDV.

### NF-e

Principal candidato para vendas que necessitem documento modelo 55.

### NFS-e

Principal candidato para serviços.

Não tratar NF-e, NFC-e e NFS-e como se fossem o mesmo documento.

Descobrir quais conceitos podem ser compartilhados e quais necessariamente precisam ser específicos.

---

# 9. Origem operacional

Todo documento fiscal deverá possuir origem inequívoca.

Avaliar vínculos como:

```text
fiscal_document
  -> sale
```

e, quando aplicável:

```text
fiscal_document
  -> service_order
```

ou outra estrutura já existente.

Nunca copiar a venda inteira para uma segunda estrutura operacional.

O fiscal deve registrar o documento emitido e seus snapshots necessários, não criar outra venda.

---

# 10. Modelo de documento fiscal

Somente após a descoberta, determinar se é necessária estrutura persistida para documentos fiscais.

Caso exista lacuna real, considerar conceitos equivalentes a:

```text
fiscal_documents
fiscal_document_items
```

mas os nomes finais devem seguir os padrões existentes do projeto.

O documento precisa conseguir representar, quando aplicável:

* tenant;
* company;
* branch;
* origem;
* modelo;
* série;
* número;
* ambiente;
* status;
* destinatário snapshot;
* totais;
* chave de acesso;
* protocolo;
* XML;
* URL/PDF/DANFE quando fornecido pelo provedor;
* código/identificador externo;
* motivo de rejeição;
* timestamps relevantes.

Não persistir campos apenas porque existem no layout oficial se o VetorOS não os utiliza.

---

# 11. Estados fiscais

Definir uma máquina de estados explícita.

Avaliar estados equivalentes a:

```text
draft
pending
authorized
rejected
cancelled
```

e outros somente se forem necessários pelo fluxo real/provider.

Uma nota autorizada não pode simplesmente voltar para rascunho.

Rejeição não pode destruir o histórico da tentativa.

Cancelamento fiscal não deve significar exclusão do documento.

---

# 12. Imutabilidade e snapshots

Após autorização fiscal, os dados fiscais relevantes devem permanecer historicamente reproduzíveis mesmo que:

* cliente seja alterado;
* produto seja alterado;
* preço cadastral mude;
* endereço mude;
* empresa altere cadastro posteriormente.

Descobrir quais snapshots são necessários.

Não duplicar dados sem justificativa histórica/fiscal.

---

# 13. Numeração fiscal

Não usar `sale_number`, `service_order_number` ou qualquer contador comercial como número fiscal.

Descobrir como série/número devem ser controlados.

Se o provedor fiscal for responsável pela numeração, preservar esse modelo.

Não criar contador local sem necessidade comprovada.

---

# 14. Focus NFe

Auditar se já existe qualquer integração ou contrato relacionado à Focus NFe.

Caso não exista:

projetar uma abstração mínima de provider para impedir que regras de negócio fiquem espalhadas pelo código.

Exemplo conceitual:

```text
FiscalProvider
  issue(...)
  consult(...)
  cancel(...)
```

O nome/arquitetura final deve seguir os padrões do código existente.

Não criar uma framework genérica para dezenas de provedores.

O sistema pode começar com Focus NFe como provider concreto.

---

# 15. Credenciais

Credenciais fiscais nunca devem:

* aparecer em respostas comuns da API;
* aparecer integralmente em logs;
* aparecer em auditoria;
* ser enviadas ao Web;
* ficar hardcoded.

Descobrir o modelo de configuração já utilizado pelo projeto antes de criar solução nova.

---

# 16. Emissão

Avaliar operações explícitas equivalentes a:

```text
POST /fiscal-documents
POST /fiscal-documents/:id/issue
```

ou arquitetura mais adequada ao padrão atual.

Emissão deve ser uma ação explícita.

Não emitir nota automaticamente apenas porque uma venda foi confirmada, a menos que já exista regra inequívoca aprovada no domínio.

---

# 17. PDV

Integrar conceitualmente com o `PDV-ADV-01`.

Após uma venda finalizada, avaliar UX para:

```text
Finalizar venda
→ comprovante
→ Emitir NFC-e
```

ou emissão integrada quando configurada.

Mas não alterar o checkout atômico de venda/estoque/pagamento para torná-lo dependente da disponibilidade da SEFAZ/Focus.

Uma indisponibilidade fiscal não pode corromper:

* venda;
* estoque;
* pagamento;
* caixa.

Fiscal deve possuir seu próprio estado operacional recuperável.

---

# 18. Ordem de Serviço

Auditar como serviços concluídos/faturados poderiam originar NFS-e.

Não presumir que toda OS deve emitir nota.

Separar:

```text
conclusão operacional da OS
```

de:

```text
emissão fiscal
```

A indisponibilidade fiscal não deve impedir conclusão técnica da OS.

---

# 19. Cancelamento

Distinguir obrigatoriamente:

```text
cancelamento da venda
```

de:

```text
cancelamento do documento fiscal
```

Se uma venda com documento fiscal autorizado for cancelada, descobrir quais ações fiscais passam a ser necessárias.

Não implementar cancelamento fiscal apenas alterando `status='cancelled'` localmente.

Uma operação externa real deverá confirmar o cancelamento quando houver provider integrado.

---

# 20. Falhas e recuperação

Projetar o fluxo considerando:

* timeout;
* queda de rede;
* resposta desconhecida;
* rejeição;
* retry;
* provider indisponível;
* resposta duplicada;
* usuário clicando duas vezes.

Nunca assumir que timeout significa "nota não emitida".

Deve ser possível consultar/reconciliar o estado no provider utilizando identificador idempotente/referência apropriada.

---

# 21. Idempotência

Emissão não pode produzir duas notas fiscais por duplo clique/retry.

Descobrir o mecanismo de idempotência adequado ao provider e ao domínio.

Criar proteção estrutural/local onde necessário.

---

# 22. Concorrência

Testar situações como duas requisições tentando emitir o mesmo documento simultaneamente.

Somente uma operação fiscal lógica deve sobreviver.

---

# 23. Auditoria

Auditar as ações fiscais importantes utilizando o mecanismo já existente.

No mínimo avaliar eventos para:

* documento criado;
* emissão solicitada;
* autorizado;
* rejeitado;
* cancelamento solicitado;
* cancelado.

Não registrar:

* credenciais;
* XML completo desnecessariamente em metadata;
* tokens;
* informações sigilosas do provider.

---

# 24. RBAC

Antes de criar permissions, auditar o catálogo atual.

Reaproveitar permissions fiscais existentes se houver.

Somente criar novas quando existir lacuna inequívoca.

Avaliar semanticamente capacidades como:

```text
fiscal.read
fiscal.issue
fiscal.cancel
```

Não criar dezenas de permissões artificiais.

Testar RBAC negativo.

---

# 25. RLS e multitenancy

Qualquer nova tabela fiscal pertencente ao tenant deve seguir rigorosamente os padrões atuais de:

* RLS;
* fail-closed;
* FKs same-tenant;
* isolamento cross-tenant.

Testar explicitamente tentativa de leitura/manipulação cruzada.

---

# 26. Web

Caso a descoberta confirme necessidade de interface fiscal, manter os padrões UX atuais.

Avaliar:

```text
Fiscal
  └── Documentos fiscais
```

com:

* listagem;
* filtros;
* status;
* origem;
* número;
* cliente;
* valor;
* data;
* ações permitidas.

Detalhe do documento deve apresentar de maneira operacional:

* situação;
* origem;
* cliente;
* itens;
* totais;
* eventos;
* rejeição, quando houver;
* chave;
* protocolo;
* ações permitidas.

Não expor JSON bruto da Focus NFe como interface principal.

---

# 27. XML e DANFE

Descobrir exatamente o que a Focus NFe fornece.

Não gerar DANFE próprio se o provider já fornecer documento oficial adequado.

Definir estratégia de armazenamento/referência para XML baseada no padrão atual de arquivos do sistema.

Não armazenar grandes blobs no PostgreSQL automaticamente sem avaliar a arquitetura existente.

---

# 28. Ambiente de homologação

Qualquer integração real deve começar apta a trabalhar em homologação.

Não executar emissão real em produção durante os testes automatizados.

Testes automatizados de integração com provider devem utilizar mocks/fakes controlados, salvo suíte explicitamente destinada a sandbox/homologação.

---

# 29. Testes mínimos

Se houver implementação, criar cobertura para pelo menos:

1. criação a partir de venda válida;
2. cliente PF;
3. cliente PJ;
4. snapshots;
5. autorização;
6. rejeição;
7. retry idempotente;
8. duplo clique;
9. concorrência;
10. cancelamento;
11. cancelamento rejeitado;
12. isolamento cross-tenant;
13. RBAC negativo;
14. venda inexistente/de outro tenant;
15. imutabilidade após autorização;
16. falha externa sem corromper venda;
17. recuperação após timeout/estado desconhecido.

Adicionar testes específicos de NFC-e/NF-e/NFS-e somente para os tipos realmente implementados.

---

# 30. Gate final

Após implementação:

```bash
pnpm -r lint
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

Executar também todas as suítes de banco/API relevantes no ambiente PostgreSQL real utilizado pelo projeto.

Não enfraquecer testes existentes.

Não alterar teste apenas para fazer implementação incorreta passar.

Qualquer regressão provocada pela rodada deve ser corrigida.

---

# 31. Regra de execução

Executar autonomamente.

Não parar solicitando autorização entre descoberta, implementação, correções e testes.

Primeiro descobrir.

Depois implementar somente lacunas comprovadas.

Depois testar.

Corrigir regressões introduzidas pelo marco.

Não expandir para funcionalidades que não sejam necessárias ao FIS-ADV-01.

---

# 32. Regra bloqueante contra overengineering

Especialmente neste marco:

**NÃO implementar um ERP fiscal/tributário genérico.**

Não construir por antecipação:

* SPED;
* Sintegra;
* EFD;
* escrituração contábil;
* apuração tributária completa;
* GNRE;
* MDF-e;
* CT-e;
* manifesto do destinatário;
* carta de correção;
* inutilização;
* contingência própria;
* múltiplos providers;
* motor tributário nacional genérico;
* cálculo fiscal para todos os regimes brasileiros.

Esses assuntos somente entram quando houver marco específico e necessidade comprovada.

---

# 33. Resultado esperado

Ao final responder explicitamente:

```text
FIS-ADV-01 — Fiscal Operacional Completo

Descoberta:
...

Lacunas reais:
...

Implementado:
...

Reutilizado:
...

NF-e:
SIM / NÃO / PARCIAL

NFC-e:
SIM / NÃO / PARCIAL

NFS-e:
SIM / NÃO / PARCIAL

Integração Focus NFe:
SIM / NÃO / PARCIAL

PDV → Fiscal:
SIM / NÃO / PARCIAL

OS → Fiscal:
SIM / NÃO / PARCIAL

Idempotência:
...

Concorrência:
...

RBAC:
...

RLS:
...

Testes:
...

Gates finais:
...

Limitações reais restantes:
...
```

Se a descoberta demonstrar que uma área já está corretamente resolvida, **não reimplementar**.

O objetivo é sair desta rodada com uma arquitetura fiscal correta e operacionalmente utilizável, preservando integralmente o núcleo já consolidado de:

**OS → Vendas → PDV → Estoque → Caixa → Financeiro.**
