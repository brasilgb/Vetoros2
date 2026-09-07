# NOVA DECISÃO DE ROADMAP — AUTORIZAR REL-02

Data: 2026-09-07

O roadmap atual está integralmente concluído até `REL-01` e não possui marco `NEXT`.

Esta instrução constitui a nova decisão explícita necessária para continuar o desenvolvimento.

## 1. Novo marco autorizado

Adicionar ao `docs/ROADMAP.md`:

**REL-02 — Exportação CSV de Relatórios**

Status inicial:

`NEXT`

Não iniciar nenhum marco posterior.

---

## 2. Objetivo

Permitir a exportação em CSV dos dados já disponibilizados pelo núcleo de relatórios implementado em `REL-01`.

O objetivo é exportação operacional dos relatórios existentes.

Não adicionar novas métricas.

Não criar novos agregados.

Não criar novo ledger.

Não implementar PDF neste marco.

Não criar infraestrutura genérica de BI/exportação além do necessário.

---

## 3. Descoberta obrigatória antes da implementação

Antes de alterar código funcional, analisar o estado atual de Reports e registrar:

1. endpoints existentes;
2. filtros aceitos atualmente;
3. formato dos dados retornados;
4. agregados existentes;
5. permission `reports.read`;
6. aplicação atual de tenant/company/branch;
7. implementação da página `/app/reports`;
8. contratos compartilhados existentes;
9. bibliotecas CSV já presentes no monorepo, se houver;
10. convenção existente no projeto para downloads HTTP.

Verificar se a exportação pode reutilizar diretamente a mesma camada de consulta do REL-01.

**Não duplicar a lógica SQL do relatório** se for possível compartilhar a mesma função/query.

---

## 4. Regra arquitetural principal

A visualização e a exportação devem consumir a **mesma fonte lógica dos dados**.

Os filtros de:

* tenant;
* company;
* branch;
* período;
* demais filtros já existentes no REL-01

devem produzir exatamente o mesmo conjunto lógico de dados tanto na tela quanto no CSV.

Não criar uma segunda implementação independente do relatório.

---

## 5. API

Criar o endpoint de exportação seguindo as convenções existentes do projeto.

Sugestão conceitual:

`GET /reports/export.csv`

ou outra rota consistente com a arquitetura já existente.

O endpoint deve:

* exigir autenticação;
* exigir contexto operacional ativo quando REL-01 assim exigir;
* exigir `reports.read`;
* aplicar tenant/company/branch;
* aceitar os mesmos filtros relevantes do relatório;
* retornar CSV válido;
* utilizar headers HTTP adequados para download;
* possuir nome de arquivo previsível e seguro.

Não criar uma nova permission somente para exportar CSV nesta fase, salvo se a arquitetura existente demonstrar uma necessidade concreta e isso for justificado na descoberta.

Por padrão, quem pode ler o relatório pode exportar os mesmos dados.

---

## 6. Segurança

Provar que exportação não permite escapar dos controles do REL-01.

Obrigatório:

* isolamento por tenant;
* isolamento por empresa;
* isolamento por filial;
* `403` para usuário autenticado sem `reports.read`;
* `401` para acesso anônimo;
* rejeição de contexto inválido.

Não confiar em tenant/company/branch fornecidos livremente por query string caso o REL-01 derive esses valores do contexto da sessão.

---

## 7. CSV

Definir formato determinístico.

Requisitos:

* `UTF-8`;
* cabeçalho explícito;
* escaping correto de vírgulas, aspas, quebras de linha e campos textuais;
* datas em formato inequívoco;
* números não devem sofrer formatação visual que prejudique processamento posterior;
* resultado vazio deve gerar CSV válido com cabeçalhos, sem erro;
* nenhuma fórmula ou conteúdo potencialmente perigoso deve ser interpretável por planilhas quando proveniente de campos textuais.

Investigar e proteger contra **CSV Injection / Formula Injection** em campos iniciados por caracteres como:

`=`, `+`, `-`, `@`

quando aplicável aos valores exportados.

---

## 8. Volume e memória

Não introduzir arquitetura de streaming complexa sem necessidade.

Porém, avaliar o volume potencial da consulta atual.

Se a implementação atual puder exportar uma quantidade razoável de registros com segurança usando a infraestrutura existente, manter simples.

Caso haja risco real de carregar volumes ilimitados em memória, implementar o mínimo necessário para tornar o endpoint seguro e documentar a decisão.

Não criar filas/background jobs neste marco.

---

## 9. Interface Web

Na página:

`/app/reports`

adicionar ação clara de:

**Exportar CSV**

Ela deve respeitar os filtros atualmente selecionados.

UX esperada:

* botão claramente identificável;
* estado de processamento;
* tratamento de erro;
* impedir cliques duplicados enquanto a exportação estiver sendo solicitada;
* manter a interface consistente com o padrão atual do VetorOS2.

Não redesenhar a página inteira.

---

## 10. Testes específicos obrigatórios

Cobrir pelo menos:

### Exportação válida

Usuário autorizado exporta CSV e recebe:

* status `200`;
* content-type apropriado;
* content-disposition apropriado;
* cabeçalhos corretos;
* conteúdo esperado.

### Filtros

Os mesmos filtros usados pelo relatório devem refletir corretamente na exportação.

### Período vazio

Exportação de período sem movimentos deve ser válida e zero-safe.

### RBAC negativo

Usuário autenticado sem:

`reports.read`

recebe:

`403`.

### Anônimo

Recebe:

`401`.

### Multi-tenant

Dados de outro tenant não aparecem no CSV.

### Company/Branch

Dados fora da empresa/filial ativa não aparecem.

### CSV escaping

Adicionar fixture que prove tratamento correto de pelo menos:

* vírgula;
* aspas;
* quebra de linha, caso campos exportáveis permitam;
* possível formula injection em conteúdo textual.

---

## 11. Validação final

Depois da implementação executar:

1. testes específicos de REL-02;
2. testes de REL-01;
3. suíte DB completa;
4. suíte API completa;
5. testes Web relevantes, se existentes;
6. lint;
7. typecheck;
8. build de produção;
9. `git diff --check`.

Não mascarar eventuais regressões.

---

## 12. Roadmap

Somente com todos os gates verdes:

* mudar `REL-02` de `NEXT` para `DONE`.

Não definir automaticamente outro marco `NEXT`.

O marco posterior dependerá de nova decisão explícita.

---

## 13. Entrega

No `executed.md`, registrar:

1. descoberta do estado anterior;
2. arquitetura escolhida para reutilizar a consulta do REL-01;
3. endpoint criado;
4. formato do CSV;
5. proteção contra CSV Injection;
6. comportamento com resultado vazio;
7. RBAC;
8. isolamento tenant/company/branch;
9. alterações Web;
10. arquivos alterados;
11. testes específicos e resultados;
12. resultado REL-01;
13. DB global;
14. API global;
15. lint/typecheck/build/diff-check;
16. eventuais limitações;
17. confirmação se `REL-02` pôde ser marcado como `DONE`.

Não implementar PDF.

Não iniciar REL-03.

Não criar commit.
