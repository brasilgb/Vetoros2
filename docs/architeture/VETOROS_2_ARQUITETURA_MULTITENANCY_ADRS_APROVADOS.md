# VetorOS 2 — Arquitetura Definitiva de Multitenancy, Ownership e Decisões de Produto

**Status:** aprovado para derivação do schema PostgreSQL v1  
**Data:** 2 de setembro de 2026  
**Produto:** VetorOS 2  
**Escopo:** multitenancy, ownership, autorização, clientes, produtos, estoque, orçamento, OS, caixa, financeiro, fiscal, LGPD, suporte, quotas e configuração.

---

## 1. Objetivo

Este documento consolida a arquitetura de multitenancy e ownership do VetorOS 2 e encerra as decisões de produto que estavam pendentes antes do desenho do schema PostgreSQL.

A arquitetura adota:

```text
Plataforma VetorOS
└── Identity
    └── Tenant
        └── Empresa
            └── Filial
```

As fronteiras são:

- **Tenant:** limite absoluto de segurança SaaS.
- **Empresa:** limite jurídico, fiscal, financeiro e comercial.
- **Filial:** limite operacional.
- **Identity:** identidade de autenticação capaz de participar de mais de um Tenant.
- **Membership/Grant:** vínculo autorizado entre identidade, tenant e escopo operacional.

Nenhuma decisão deste documento substitui autorização server-side. RLS, constraints e isolamento de infraestrutura são defesa em profundidade.

---

## 2. Invariantes arquiteturais

1. `tenant_id` é obrigatório em todas as tabelas tenant-owned.
2. `tenant_id` nunca é aceito como autoridade a partir de body, query string ou header arbitrário.
3. Toda operação nasce de um `TenantContext` validado.
4. `company_id` representa a entidade jurídica responsável.
5. `branch_id` representa a unidade operacional.
6. Toda relação crítica deve impedir associação cruzada entre Tenant, Empresa e Filial.
7. Repositories tenant-owned não operam sem contexto.
8. PostgreSQL RLS será utilizado como segunda barreira de isolamento.
9. FKs compostas repetirão `tenant_id` e, quando necessário, `company_id`.
10. Cache, storage, locks, filas, idempotency keys e objetos externos usam namespace de Tenant.
11. Financeiro, estoque, fiscal e auditoria usam fatos imutáveis ou reversões explícitas; não há edição destrutiva de histórico.
12. Frontend nunca é tratado como barreira de segurança.
13. Identidades administrativas da plataforma ficam separadas do data plane dos tenants.
14. Segredos nunca são retornados depois de cadastrados e nunca entram em logs.
15. Documentos históricos armazenam snapshots dos dados relevantes ao momento da operação.

---

# ADRs aprovados

## ADR-001 — Identidade global com participação em múltiplos Tenants

### Decisão

A autenticação será baseada em uma identidade global separada da participação no Tenant.

```text
Identity
 ├── Membership → Tenant A
 ├── Membership → Tenant B
 └── Membership → Tenant C
```

O mesmo login poderá participar de múltiplos tenants.

A sessão operacional seleciona exatamente um Tenant ativo e somente tenants nos quais exista membership válida podem ser selecionados.

### Contexto operacional mínimo

```ts
interface TenantContext {
  identityId: string;
  tenantId: string;
  userId: string;
  activeCompanyId?: string;
  activeBranchId?: string;
}
```

Grants e capabilities são resolvidos pelo backend.

### Consequências

- contador, consultor ou prestador pode atuar em diferentes clientes VetorOS;
- não há duplicação obrigatória de credencial por tenant;
- trocar de tenant exige validação de membership;
- a troca de contexto é auditável.

---

## ADR-002 — Diretório mestre de clientes compartilhável no Tenant

### Decisão

A identidade da pessoa/organização cliente fica no Tenant por meio de um cadastro mestre (`party`), enquanto o relacionamento comercial pertence à Empresa.

```text
party
 ├── company_customer Empresa A
 └── company_customer Empresa B
```

O Tenant pode habilitar localização compartilhada de pessoas já cadastradas, sem compartilhar automaticamente histórico comercial ou operacional.

### Regra

Compartilhar o diretório não significa compartilhar:

- OS;
- orçamento;
- preço;
- condição comercial;
- observação interna;
- financeiro;
- documento fiscal;
- atendimento;
- histórico de outra Empresa.

---

## ADR-003 — CPF/CNPJ verificado logicamente único com exceção auditada

### Decisão

Documento válido e verificado deve apontar para cadastro já existente no mesmo Tenant.

Duplicidade será tratada em três níveis:

1. **Documento verificado:** reutilizar cadastro existente.
2. **Documento não verificado/suspeito:** sugerir possível duplicidade e permitir revisão.
3. **Exceção administrativa/legado:** permitir duplicidade somente com permissão específica, justificativa e auditoria.

Não será criada unicidade absoluta incapaz de tratar cadastros provisórios, estrangeiros, dados ausentes ou migrações legadas.

### Normalização

- CPF/CNPJ: somente dígitos;
- e-mail: lowercase + trim;
- telefone: formato canônico;
- CEP: formato normalizado.

---

## ADR-004 — Histórico cross-company isolado

### Decisão

O cadastro mestre pode ser compartilhado no Tenant, porém o histórico de transações permanece no escopo da Empresa/Filial de origem.

A leitura consolidada entre empresas exige permissão explícita, por exemplo:

```text
customer.history.cross_company.read
```

Equipamentos podem pertencer ao cadastro mestre do cliente, porém suas manutenções e transações continuam isoladas por Empresa/Filial.

---

## ADR-005 — Numeração de Orçamento e OS por Empresa

### Decisão

Orçamentos e Ordens de Serviço terão numeração humana sequencial no escopo da Empresa, não da Filial.

```text
Empresa A
  OS 000001
  OS 000002

Empresa B
  OS 000001
```

A Filial fica registrada separadamente como unidade responsável pela operação.

### Escopos aprovados

| Documento | Escopo |
|---|---|
| Cliente comercial | Empresa |
| Orçamento | Empresa |
| Ordem de Serviço | Empresa |
| Venda/PDV | Filial |
| Caixa | Filial/Terminal |
| Movimento de estoque | Filial |
| Movimento financeiro | Empresa |
| Documento fiscal | Empresa + estabelecimento + modelo + série |

Nunca será utilizado `MAX(numero) + 1`.

---

## ADR-006 — Caixa por Terminal com Sessões

### Decisão

O caixa físico é modelado como:

```text
Filial
 └── Terminal
      └── Sessão de Caixa
           └── Operador
```

Deve existir no máximo uma sessão aberta para o mesmo terminal no mesmo escopo operacional.

### Elementos

- `cash_terminals`
- `cash_sessions`
- `cash_entries`

A sessão registra abertura, fechamento, operador, saldo inicial, valor apurado, diferença e auditoria.

Troca de operador deve ser registrada como evento auditável ou ocorrer por fechamento e nova abertura, de acordo com política operacional.

---

## ADR-007 — Estoque negativo proibido operacionalmente

### Decisão

Estoque negativo será proibido no fluxo normal.

Inconsistências de implantação ou legado serão corrigidas por movimentos explícitos de ajuste, nunca pela simples permissão de saldo negativo.

Exemplo:

```text
AJUSTE_DE_IMPLANTACAO
+5
motivo: saldo legado não registrado
```

Todo ajuste exige origem, ator, motivo e auditoria.

---

## ADR-008 — Reserva após aprovação e criação da OS

### Decisão

Enviar orçamento não reserva estoque.

A reserva padrão ocorre quando:

```text
Orçamento aprovado
+
OS criada
=
Reserva
```

### Conceitos

```text
physical
reserved
available = physical - reserved
```

A reserva não baixa estoque físico.

Consumo, venda ou saída efetiva gera movimento de estoque.

Reservas manuais específicas podem existir, desde que tenham origem, justificativa e expiração quando aplicável.

---

## ADR-009 — Um Orçamento gera no máximo uma OS

### Decisão

A relação inicial será:

```text
1 Orçamento aprovado → 0..1 Ordem de Serviço
```

A criação será idempotente.

Chamadas repetidas para criação a partir do mesmo orçamento retornam a OS já criada.

Aprovação parcial deve resultar em nova versão do orçamento antes da aprovação definitiva.

Não será implementada divisão automática de um orçamento em várias OS no primeiro desenho.

---

## ADR-010 — Transferência controlada de OS entre Filiais

### Decisão

Transferência é permitida somente enquanto os efeitos da operação forem reversíveis.

| Situação | Transferência |
|---|---|
| OS criada, sem movimentos | Permitida |
| Apenas reserva | Permitida com recriação/transferência da reserva |
| Estoque consumido | Processo controlado com estorno |
| Recebimento lançado | Restrita |
| Documento fiscal emitido | Bloqueada |
| OS encerrada | Bloqueada |

Nunca será feita simples alteração de `branch_id` depois da existência de fatos irreversíveis.

Toda transferência registra filial origem, filial destino, ator, instante e motivo.

---

## ADR-011 — Recebível pertence à Empresa

### Decisão

O credor jurídico é a Empresa/CNPJ.

A Filial representa a origem operacional.

```text
receivable
  tenant_id
  company_id   // credor
  branch_id    // origem
  source_type
  source_id
```

Relatórios podem consolidar por Empresa sem perder rastreabilidade por Filial.

---

## ADR-012 — Motor de Comissões versionado e hierárquico

### Decisão

Comissões serão calculadas por regras versionadas com escopos capazes de representar:

- Empresa;
- Filial;
- produto;
- serviço;
- categoria;
- beneficiário.

A regra mais específica e válida pode prevalecer, desde que o mecanismo não aceite combinações ambíguas.

### Evento padrão de aquisição

O padrão do VetorOS será **comissão por recebimento efetivo**.

Pagamento parcial pode gerar comissão proporcional.

### Histórico

A comissão grava snapshot da regra aplicada.

Estornos nunca apagam comissão anterior; criam fato reverso.

---

## ADR-013 — Herança explícita de configurações

### Decisão

Cada chave de configuração declara quais escopos aceita.

Categorias conceituais:

```text
GLOBAL_TENANT
INHERITABLE
COMPANY_ONLY
BRANCH_ONLY
SECURITY_CRITICAL
FISCAL_CRITICAL
```

A resolução `Filial → Empresa → Tenant → Sistema` somente é permitida para chaves declaradas como herdáveis.

Configurações fiscais, jurídicas e secrets nunca são herdadas implicitamente de outra Empresa.

A aplicação deve conseguir mostrar a origem da configuração efetiva.

---

## ADR-014 — Arquitetura fiscal preparada para NFS-e, NF-e e NFC-e

### Decisão

O domínio fiscal será preparado para os três modelos:

- NFS-e;
- NF-e;
- NFC-e.

Prioridade inicial de produto:

1. NFS-e;
2. NF-e;
3. NFC-e.

A prioridade reflete o foco operacional inicial do VetorOS em assistência técnica e prestação de serviços, sem impedir operações de mercadorias e PDV.

Uma OS não será modelada como obrigatoriamente equivalente a uma única nota.

### Provider

```ts
interface FiscalProvider {
  issue(command: IssueFiscalDocument): Promise<ProviderReceipt>;
  query(command: QueryFiscalDocument): Promise<FiscalStatus>;
  cancel(command: CancelFiscalDocument): Promise<ProviderReceipt>;
  correct?(command: CorrectionLetter): Promise<ProviderReceipt>;
}
```

Provider não decide:

- tributação;
- autorização do usuário;
- ownership;
- numeração interna;
- regras de domínio.

---

## ADR-015 — Armazenamento seguro de Certificado A1

### Decisão

O VetorOS poderá armazenar certificado A1 para permitir automação fiscal SaaS.

O certificado será tratado como segredo crítico.

### Regras

- criptografia por envelope;
- senha armazenada como segredo separado;
- acesso de descriptografia somente pelo worker fiscal;
- frontend, API geral e suporte não recebem conteúdo do certificado;
- fingerprint, emissor, validade e status podem ser mantidos como metadados;
- rotação, substituição e expiração são auditadas;
- suporte VetorOS não pode baixar certificado do cliente.

A implementação deverá usar uma abstração de cofre de segredos para permitir evolução futura para KMS/HSM.

---

## ADR-016 — LGPD e retenção por categoria

### Decisão

Não haverá uma única política de retenção para todos os dados.

Categorias mínimas:

- identidade e acesso;
- operacional;
- financeiro;
- fiscal;
- comunicação;
- auditoria;
- arquivos e anexos.

Cada categoria deverá possuir política própria de:

```text
legal_basis
minimum_retention
retention_policy
deletion_strategy
anonymization_strategy
```

Registros sujeitos a obrigação fiscal, financeira, estoque ou auditoria não serão destruídos para atender uma exclusão simples; dados pessoais poderão ser pseudonimizados quando juridicamente apropriado.

GPS/localização não será coletado sem finalidade de negócio definida.

Exportações e anonimizações são auditadas.

---

## ADR-017 — Impersonation de Suporte controlado

### Decisão

O suporte VetorOS poderá operar sessão impersonada somente quando necessário e mediante:

- motivo obrigatório;
- escopo;
- prazo;
- ator real;
- usuário impersonado;
- Tenant;
- auditoria completa.

A sessão deve deixar visualmente claro que existe impersonation.

### Ações bloqueadas mesmo durante impersonation

- baixar certificado A1;
- visualizar secrets;
- visualizar credenciais em claro;
- desativar auditoria;
- alterar owner sem fluxo administrativo dedicado;
- operações que a política de segurança declare não delegáveis.

Acesso administrativo da plataforma é temporário e separado da identidade comum do Tenant.

---

## ADR-018 — Entitlements, Quotas e Rate Limits separados

### Decisão

O SaaS separará:

```text
ENTITLEMENTS = o que pode usar
QUOTAS       = quanto pode usar
RATE LIMITS  = em qual velocidade pode usar
```

### Hard limits

Podem bloquear, por exemplo:

- número máximo de empresas;
- usuários ativos;
- feature não contratada.

### Soft limits

Devem inicialmente alertar e permitir política gradual, por exemplo:

- armazenamento;
- mensagens;
- API usage;
- uso de recursos.

Alertas recomendados:

```text
80%  alerta
90%  alerta importante
100% política específica do plano
```

Operações críticas não devem ser interrompidas abruptamente apenas por quota sem política explícita.

Quota comercial principal pertence ao Tenant, podendo existir métricas internas por Empresa ou Filial.

---

## ADR-019 — Timezone por Filial e moeda-base por Empresa

### Decisão

Cada Filial possui timezone operacional.

Timestamps técnicos são persistidos em UTC.

Datas de negócio podem guardar contexto local quando necessário para auditoria, fechamento, agenda e relatórios.

Cada Empresa possui uma moeda-base.

A primeira versão não implementará motor multi-moeda transacional completo dentro da mesma Empresa.

Valores monetários utilizam `numeric` e código de moeda explícito; nunca `float`.

---

## ADR-020 — Catálogo mestre no Tenant com habilitação local

### Decisão

Produto e SKU pertencem ao catálogo mestre do Tenant.

A Empresa controla habilitação e perfil fiscal.

A Filial controla disponibilidade operacional quando necessário.

```text
Product
 └── SKU
      └── CompanyProductProfile
           └── BranchAvailability
```

Devem ser conceitos distintos:

```text
VISÍVEL
HABILITADO
DISPONÍVEL
```

### Ownership

| Conceito | Escopo |
|---|---|
| Produto/SKU | Tenant |
| Perfil fiscal | Empresa |
| Preço | Empresa/Filial |
| Custo | Filial |
| Estoque | Filial |

---

# 3. Matriz consolidada de ownership

| Domínio | Ownership principal |
|---|---|
| Conta SaaS | Tenant |
| Identity | Plataforma |
| Membership | Tenant |
| Usuário operacional | Tenant |
| Grants | Tenant/Empresa/Filial |
| Cliente mestre | Tenant |
| Relação comercial do cliente | Empresa |
| Equipamento | Tenant, com histórico transacional isolado |
| Produto/SKU | Tenant |
| Perfil fiscal de produto | Empresa |
| Preço | Empresa/Filial |
| Estoque | Filial |
| Orçamento | Filial, numeração por Empresa |
| Ordem de Serviço | Filial, numeração por Empresa |
| Agenda | Filial |
| PDV/Venda | Filial |
| Terminal/Caixa | Filial |
| Recebível | Empresa, origem Filial |
| Conta bancária | Empresa |
| Despesa | Empresa, alocação opcional em Filial |
| Comissão | Empresa/Filial conforme regra |
| Documento fiscal | Empresa + estabelecimento emissor |
| Certificado A1 | Empresa |
| Configuração tributária | Empresa |
| Série fiscal | Empresa/Filial conforme modelo |
| Template | Tenant com override permitido |
| Auditoria | Tenant + escopo do alvo |
| Plano SaaS | Plataforma |
| Assinatura/uso | Tenant |
| Timezone | Filial |
| Moeda | Empresa |

---

# 4. Fluxo principal Orçamento → OS

```text
Draft
  ↓
Sent
  ↓
Approved ───────────────┐
  ↓                     │
Create Work Order       │
  ↓                     │
Reserve Stock           │
  ↓                     │
Execution               │
  ↓                     │
Stock Consumption       │
  ↓                     │
Receipts / Finance      │
  ↓                     │
Fiscal                  │
  ↓                     │
Closed                  │
                        │
Rejected / Expired / Cancelled
```

Princípios:

- orçamento é agregado independente;
- versão enviada congela conteúdo;
- aprovação refere-se à versão exata;
- aprovação é idempotente;
- uma aprovação gera no máximo uma OS;
- OS direta continua permitida;
- aprovação não baixa estoque;
- reserva ocorre quando a OS é criada;
- consumo efetivo gera movimento;
- fiscal/financeiro tornam transferência entre filiais progressivamente mais restrita.

---

# 5. Modelo de autorização

Modelo recomendado:

```text
identities
tenant_memberships
users
roles
permissions
role_permissions
access_grants
branch_memberships
```

Escopos de grant:

```text
TENANT
COMPANY
BRANCH
```

Regra efetiva:

```text
permitir =
  identidade ativa
  AND membership ativa
  AND tenant da sessão = tenant do recurso
  AND permission válida
  AND grant vigente contém o recurso
  AND conditions de domínio satisfeitas
```

Herança de autorização é descendente e explícita:

```text
Tenant → Empresa → Filial
Empresa → Filial
Filial → somente aquela Filial
```

Negação explícita de grants não será suportada inicialmente.

---

# 6. Estratégia obrigatória de isolamento PostgreSQL

O schema v1 deverá implementar as seguintes regras:

### Tenant-owned

```sql
tenant_id NOT NULL
```

em toda tabela de dados do cliente SaaS.

### Chaves candidatas

Entidades hierárquicas deverão expor combinações adequadas para FKs compostas, conceitualmente:

```text
companies (tenant_id, id)
branches  (tenant_id, company_id, id)
```

### RLS

Toda tabela tenant-owned terá RLS baseado em contexto de conexão.

Conceitualmente:

```sql
tenant_id = current_setting('app.tenant_id')::uuid
```

A forma definitiva será decidida no schema/infra.

### Transação

O contexto de Tenant e ator é instalado no início da unidade transacional e limpo antes da conexão retornar ao pool.

### Testes obrigatórios

- tentativa de leitura cross-tenant;
- escrita cross-tenant;
- FK cruzada;
- contexto ausente;
- contexto residual de pool;
- alteração de Tenant em payload;
- cache cross-tenant;
- job/evento sem Tenant;
- object storage sem namespace.

---

# 7. Ledger e imutabilidade

Os seguintes domínios devem preferir fatos imutáveis:

- estoque;
- caixa;
- pagamentos;
- financeiro;
- comissão;
- fiscal;
- auditoria.

Correções ocorrem via movimento inverso/estorno.

Exemplo:

```text
Movimento original +100
Estorno           -100
Novo movimento      80
```

Não se altera retroativamente o fato original.

---

# 8. Numeração

Números humanos são separados das PKs técnicas.

Não usar:

```text
MAX(numero) + 1
```

Utilizar contador atômico por escopo ou mecanismo PostgreSQL apropriado.

Estrutura conceitual:

```text
number_sequences
  tenant_id
  scope_type
  scope_id
  document_type
  series
  next_value
  version
```

Lacunas em numeração operacional são aceitáveis.

Documentos fiscais seguem regras próprias e independentes da numeração operacional.

---

# 9. Segurança de segredos

Segredos incluem:

- certificado digital;
- senha do certificado;
- tokens fiscais;
- credenciais de API;
- webhook secrets;
- chaves privadas;
- secrets de integrações.

Regras:

1. nunca retornar segredo após criação;
2. nunca logar segredo;
3. armazenar material criptografado;
4. separar metadados de material sensível;
5. aplicar menor privilégio;
6. rotação auditada;
7. workers especializados recebem somente o segredo necessário;
8. suporte e frontend não têm acesso direto.

---

# 10. Requisitos para o schema PostgreSQL v1

O próximo artefato deve derivar deste documento e definir pelo menos:

1. schemas/namespaces PostgreSQL;
2. PK strategy;
3. Tenant/Identity/Membership;
4. Empresa/Filial;
5. roles/permissions/grants;
6. clientes/parties;
7. equipamentos;
8. produtos/SKUs;
9. perfis de produto por Empresa;
10. preços;
11. estoque/ledger/reservas;
12. orçamento/versões/itens/aprovação;
13. OS/itens/status/eventos;
14. agenda;
15. venda/PDV;
16. terminais/sessões/caixa;
17. recebíveis/pagamentos;
18. despesas;
19. comissão;
20. contas financeiras;
21. fiscal;
22. certificados;
23. configurações;
24. templates;
25. integrações;
26. auditoria;
27. number sequences;
28. entitlements/usage;
29. RLS;
30. FKs compostas;
31. índices;
32. uniques e índices parciais;
33. idempotência;
34. outbox/eventos;
35. lifecycle e soft-delete/inativação.

Nenhuma migration deverá ser escrita antes de revisar e aprovar esse schema lógico.

---

# 11. Decisões encerradas antes do schema

As vinte questões de produto anteriormente abertas estão agora resolvidas:

- [x] login em múltiplos tenants;
- [x] diretório mestre de clientes;
- [x] duplicidade CPF/CNPJ;
- [x] histórico cross-company;
- [x] numeração orçamento/OS;
- [x] caixa;
- [x] estoque negativo;
- [x] reserva;
- [x] orçamento → OS;
- [x] transferência de OS;
- [x] recebíveis;
- [x] comissão;
- [x] herança de configuração;
- [x] modelos fiscais;
- [x] certificado A1;
- [x] LGPD/retenção;
- [x] impersonation;
- [x] limites SaaS;
- [x] timezone/moeda;
- [x] catálogo.

---

# 12. Estado arquitetural aprovado

O VetorOS 2 passa a adotar oficialmente:

```text
Identity global
      │
      ▼
Tenant
segurança SaaS
      │
      ▼
Empresa
jurídico / fiscal / financeiro / numeração
      │
      ▼
Filial
operação / estoque / caixa / agenda / OS / PDV
```

A arquitetura está liberada para a próxima etapa:

> **Desenho do Schema PostgreSQL v1 do VetorOS 2.**

O schema deverá transformar cada ADR em:
- tabela/relacionamento;
- constraint;
- policy;
- índice;
- regra de domínio;
- teste de isolamento ou integridade correspondente.
