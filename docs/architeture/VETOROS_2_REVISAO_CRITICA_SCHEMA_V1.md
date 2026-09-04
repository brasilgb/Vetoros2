# VetorOS 2 — Revisão Crítica do Schema Lógico PostgreSQL v1

**Status:** revisão arquitetural pré-migration  
**Data:** 2 de setembro de 2026  
**Base:** VETOROS_2_SCHEMA_LOGICO_POSTGRESQL_V1.md  
**Resultado:** aprovado conceitualmente, com ajustes obrigatórios antes das migrations.

---

# 1. Resumo executivo

A hierarquia principal está correta:

```text
Identity → Tenant → Empresa → Filial
```

Também estão corretas as decisões centrais de:

- `tenant_id` obrigatório no data plane;
- Empresa como limite jurídico/fiscal/financeiro;
- Filial como limite operacional;
- grants hierárquicos;
- RLS como segunda barreira;
- FKs compostas;
- orçamento independente da OS;
- estoque e financeiro baseados em fatos/ledger;
- numeração humana separada da PK;
- fiscal desacoplado de provider.

Entretanto, foram identificados pontos que precisam ser corrigidos antes da criação das migrations.

---

# 2. BLOCKER-001 — `parties`: unicidade física conflita com exceção auditada

O schema lógico propôs:

```text
UNIQUE(tenant_id, document_type, document_normalized)
WHERE document_verified_at IS NOT NULL ...
```

Mas o ADR-003 também aprovou a possibilidade excepcional de duplicidade justificada.

Uma constraint `UNIQUE` rígida impediria a própria exceção.

## Correção

Separar:

```text
document_normalized
document_verified_at
duplicate_exception_reason NULL
duplicate_exception_approved_by NULL
```

e não usar uma unicidade física que torne a exceção impossível.

A prevenção de duplicidade será feita por:

1. serviço de domínio;
2. busca de correspondência;
3. bloqueio normal para documento verificado;
4. capability administrativa específica para exceção;
5. auditoria obrigatória.

Se no futuro for desejada proteção adicional no banco, utilizar mecanismo compatível com a exceção explicitamente aprovada, e não um UNIQUE absoluto.

**Severidade:** BLOCKER.

---

# 3. BLOCKER-002 — Roles de sistema e roles de Tenant na mesma tabela exigem isolamento explícito

A proposta permite:

```text
roles.tenant_id = NULL
```

para templates do sistema e `tenant_id != NULL` para roles customizadas.

Isso é válido, mas uma policy RLS simplista:

```sql
tenant_id = current_setting('app.tenant_id')
```

ocultaria roles globais.

Por outro lado, simplesmente liberar `tenant_id IS NULL` em qualquer operação poderia permitir alteração indevida.

## Correção

Separar conceitos logicamente:

```text
SYSTEM_ROLE_TEMPLATE
TENANT_ROLE
```

Pode continuar na mesma tabela, desde que:

- templates de sistema sejam read-only para o data plane;
- RLS permita leitura de `tenant_id IS NULL`;
- `INSERT/UPDATE/DELETE` de templates globais seja impossível para o usuário da aplicação;
- grants tenant-owned nunca referenciem role customizada de outro Tenant.

Constraint/policy de domínio:

```text
role.tenant_id IS NULL
OR role.tenant_id = grant.tenant_id
```

Essa regra precisa ser reforçada por service layer e, quando possível, por FK/modelagem física.

**Severidade:** BLOCKER.

---

# 4. BLOCKER-003 — `access_grants` precisa impedir role customizada cross-tenant

Hoje:

```text
access_grants.role_id -> roles.id
```

sozinho não é suficiente.

Um bug poderia tentar:

```text
Tenant A grant
→ role customizada do Tenant B
```

## Correção recomendada

Adicionar identidade de ownership à referência de role.

Opções físicas a avaliar:

### Opção A — tabela separada

```text
system_role_templates
tenant_roles
```

### Opção B — roles unificada com chave candidata

```text
roles(tenant_scope_key, id)
```

e referência validada.

### Opção C — enforcement por trigger/service

Menos desejável para uma invariância tão importante.

**Recomendação:** considerar seriamente separar roles de sistema/templates das roles efetivas de Tenant.

**Severidade:** BLOCKER.

---

# 5. BLOCKER-004 — `users` e `tenant_memberships` precisam de cardinalidade explícita

O desenho atual possui:

```text
Identity
  → tenant_membership
      → user
```

e:

```text
UNIQUE(tenant_id, membership_id)
```

Isso implica praticamente 1:1 entre membership e user, mas essa invariância precisa ser declarada como decisão.

## Decisão recomendada

Adotar:

```text
1 Identity
  → N TenantMemberships

1 TenantMembership
  → exatamente 1 UserProfile operacional
```

O `users` não representa nova identidade; representa o perfil daquela identidade dentro daquele Tenant.

Sugestão de nomenclatura futura:

```text
tenant_users
```

pode ser mais clara que simplesmente `users`.

Não é obrigatório renomear, mas o domínio deve deixar isso inequívoco.

**Severidade:** ALTA.

---

# 6. BLOCKER-005 — Contexto RLS deve falhar fechado quando não existir Tenant

O exemplo conceitual usa:

```sql
current_setting('app.tenant_id', true)::uuid
```

Com `missing_ok=true`, o resultado pode ser NULL.

Precisamos garantir que ausência de contexto resulte sempre em **zero linhas / zero escrita**, sem erro inesperado e sem fallback.

## Regra definitiva

Data-plane tenant-owned:

```text
sem app.tenant_id válido
→ DENY
```

Além disso:

- usuário da aplicação não possui `BYPASSRLS`;
- owner das tabelas não deve ser usado pelo runtime normal;
- avaliar `FORCE ROW LEVEL SECURITY`;
- migrations/control-plane usam credencial separada.

**Severidade:** BLOCKER.

---

# 7. BLOCKER-006 — Transações obrigatórias para instalação de contexto RLS

Foi recomendado `SET LOCAL`, o que está correto.

Mas isso cria uma consequência arquitetural:

> toda operação que consulta dados tenant-owned deve ocorrer dentro de transação onde o contexto foi instalado.

Caso contrário, `SET LOCAL` não oferece a garantia desejada.

## Correção

Criar abstração única:

```ts
withTenantTransaction(context, async (tx) => {
   ...
})
```

Repositories tenant-owned recebem somente `tx` contextualizado.

Proibir:

```text
db.query...
```

direto em use cases tenant-owned fora desse wrapper.

**Severidade:** BLOCKER.

---

# 8. ALTA-001 — `company_customers` deve reforçar Party do mesmo Tenant

Além de:

```text
company_id
party_id
```

a FK deverá carregar Tenant nos dois lados:

```text
(tenant_id, company_id)
  → companies(tenant_id,id)

(tenant_id, party_id)
  → parties(tenant_id,id)
```

A existência de `tenant_id` na tabela não basta sem FK composta.

---

# 9. ALTA-002 — `equipment` deve preservar ownership e compartilhamento corretamente

O equipamento foi aprovado como entidade mestre ligada à Party no Tenant.

Logo:

```text
equipment.tenant_id
equipment.party_id
```

não deve receber `company_id` obrigatório.

Históricos transacionais fazem o isolamento comercial.

Isso está conceitualmente correto e deve ser mantido no schema físico.

Também é necessário decidir se um equipamento pode mudar de proprietário.

Recomendação:

- permitir transferência de ownership somente por caso de uso explícito;
- manter histórico de ownership em tabela de eventos ou relação temporal;
- nunca reescrever silenciosamente o dono histórico usado por OS antigas.

---

# 10. ALTA-003 — Numeração de OS/Orçamento deve ser alocada no evento correto

Como números por Empresa podem ter lacunas, o número pode ser reservado na criação do agregado.

Entretanto:

- Draft de orçamento pode consumir número;
- cancelamentos podem deixar lacunas;
- rollback pode deixar lacuna dependendo do mecanismo.

Isso foi aceito conceitualmente.

A implementação deverá priorizar:

```text
atomicidade > ausência de lacunas
```

Nunca tentar compensar reutilizando número antigo.

---

# 11. ALTA-004 — `number_sequences` precisa definir semântica inequívoca de `next_value`

Evitar ambiguidade:

```text
next_value = próximo ainda não usado
```

Algoritmo recomendado:

```sql
UPDATE number_sequences
SET next_value = next_value + 1
...
RETURNING next_value - 1 AS allocated_value;
```

ou equivalente mais claro no código.

O importante é existir teste concorrente.

---

# 12. ALTA-005 — `stock_balances` não deve ser fonte histórica oficial

Fonte oficial:

```text
stock_movements
```

`stock_balances` é projeção/materialização operacional.

Portanto:

- pode ser reconstruída;
- divergência exige reconciliação;
- alteração manual direta é proibida;
- ajuste sempre gera `stock_movement`.

A regra deve ser explícita no schema/documentação.

---

# 13. ALTA-006 — `reserved_quantity <= physical_quantity` pode conflitar com reservas concorrentes em trânsito

A constraint é desejável para impedir overselling, mas a lógica de atualização precisa ocorrer atomicamente.

Recomendação:

```text
SELECT ... FOR UPDATE
```

ou update condicional otimista:

```text
UPDATE stock_balances
SET reserved_quantity = reserved_quantity + :q
WHERE ...
  AND physical_quantity - reserved_quantity >= :q
RETURNING ...
```

Não fazer:

```text
SELECT disponibilidade
→ verificar em memória
→ UPDATE depois
```

pois duas requests poderiam reservar a mesma peça.

---

# 14. ALTA-007 — Transferência de estoque entre Filiais precisa representar trânsito

Não modelar apenas:

```text
saída A
entrada B
```

instantâneas em todos os casos.

Estados recomendados:

```text
DRAFT
APPROVED
SHIPPED
IN_TRANSIT
RECEIVED
CANCELLED
```

Quando enviada:

```text
Filial A deixa de possuir
→ localização TRANSIT assume custódia
```

Quando recebida:

```text
TRANSIT sai
→ Filial B entra
```

Isso evita estoque desaparecer durante transporte.

---

# 15. ALTA-008 — Orçamento aprovado deve congelar exatamente a versão enviada

`quotes.current_version` é apenas conveniência.

A fonte da decisão deve ser:

```text
quote_decisions.quote_version_id
```

E a criação da OS deve copiar exatamente dessa versão.

Nunca:

```text
quote.current_version no momento da criação da OS
```

sem validar que é a versão aprovada.

---

# 16. ALTA-009 — Relação Quote → Work Order precisa incluir Tenant e Empresa na FK

O índice:

```text
UNIQUE(tenant_id,source_quote_id)
```

garante cardinalidade, mas a FK também deverá garantir escopo:

```text
(tenant_id, company_id, source_quote_id)
→ quotes(...)
```

e a versão:

```text
(tenant_id, source_quote_version_id)
→ quote_versions(...)
```

com coerência entre quote e versão.

---

# 17. ALTA-010 — Financeiro deve evitar `open_amount` como campo livremente editável

`receivables.open_amount` é útil como projeção, mas não pode ser mantido por CRUD comum.

Fonte econômica:

```text
original_amount
- receipt_allocations válidas
+ reversões
= open_amount
```

Pode existir coluna materializada por performance, desde que atualizada atomicamente e reconciliável.

Mesma filosofia do estoque.

---

# 18. ALTA-011 — Cash session fechada deve ser estruturalmente imutável

Após `status=CLOSED`:

- não atualizar opening amount;
- não atualizar lançamentos históricos;
- não remover entries;
- ajustes posteriores geram novos fatos.

A service layer deve bloquear e testes devem cobrir.

---

# 19. ALTA-012 — Fiscal Series e Number Sequence não devem disputar responsabilidade

Para documento fiscal:

```text
fiscal_series.next_number
```

pode ser responsável pela numeração fiscal.

`number_sequences` deve cuidar de numeração operacional.

Não duplicar o mesmo contador fiscal nas duas estruturas.

Decisão recomendada:

```text
number_sequences → OS, orçamento, venda, recibos internos etc.
fiscal_series    → numeração de documento fiscal
```

---

# 20. ALTA-013 — Fiscal Provider não pode ser coluna obrigatória de domínio histórico

`fiscal_documents.provider_code` pode registrar qual adapter transmitiu aquele documento, mas o agregado não deve depender do provider para identidade ou regras.

Deve ser possível trocar provider para novos documentos sem migrar o domínio.

Manter:

```text
provider_code
provider_reference
```

como metadados de transmissão.

---

# 21. ALTA-014 — Segredos devem ficar fora da tabela de domínio sempre que possível

Em vez de a entidade armazenar algo conceitualmente parecido com segredo criptografado diretamente, preferir:

```text
secret_ref
```

para vault/secret service.

Exemplo:

```text
fiscal_certificates:
  certificate_secret_ref
  password_secret_ref
```

O banco operacional guarda apenas referência e metadados.

---

# 22. ALTA-015 — Auditoria e Outbox têm requisitos de RLS diferentes

Ambas são tenant-owned, mas workers precisam consumir outbox de vários tenants.

Não resolver isso dando `BYPASSRLS` ao backend comum.

Criar:

```text
runtime role
worker role
migration role
control-plane role
```

com privilégios separados.

Worker cross-tenant:

- acessa somente tabelas operacionais necessárias;
- estabelece TenantContext antes de processar o payload;
- não ganha acesso arbitrário ao data plane.

---

# 23. ALTA-016 — Impersonation não deve alterar identidade do ator real

TenantContext de sessão impersonada deve carregar os dois:

```ts
{
  actorIdentityId: supportIdentity,
  effectiveUserId: customerUser,
  supportSessionId,
  tenantId
}
```

Policies podem usar o usuário efetivo, mas auditoria registra sempre o ator real.

---

# 24. MÉDIA-001 — Enum físico

Antes das migrations, recomenda-se usar predominantemente:

```text
text + CHECK
```

para estados de domínio que possam evoluir com frequência.

PostgreSQL ENUM deve ser reservado para tipos altamente estáveis.

Isso reduz atrito de migration em SaaS em evolução.

---

# 25. MÉDIA-002 — `jsonb` deve ser periférico

Usar JSONB para:

- snapshots;
- provider payload metadata;
- evidence;
- configuração extensível.

Não usar JSONB para invariantes centrais como:

- tenant;
- company;
- branch;
- status principal;
- valores financeiros;
- permissões;
- ownership;
- numeração;
- chaves fiscais.

---

# 26. MÉDIA-003 — Search indexes

Clientes e produtos provavelmente precisarão de:

- documento normalizado;
- nome normalizado;
- SKU;
- barcode;
- serial;
- telefone;
- talvez `pg_trgm`.

Não criar índices GIN/trigram preventivamente em tudo.

Adicionar depois das queries reais e `EXPLAIN ANALYZE`.

---

# 27. Decisões aprovadas após revisão

A revisão mantém:

```text
Identity global
Tenant = security boundary
Empresa = legal/fiscal/financial boundary
Filial = operational boundary
```

Mantém também:

- UUIDv7 como proposta preferencial de PK;
- banco compartilhado/schema compartilhado;
- RLS;
- `tenant_id` direto;
- FKs compostas;
- grants hierárquicos;
- Party no Tenant;
- company_customer na Empresa;
- produto/SKU no Tenant;
- estoque na Filial;
- OS/orçamento numerados por Empresa;
- caixa por terminal/sessão;
- financeiro por Empresa;
- fiscal Empresa + estabelecimento;
- A1 via secret vault;
- auditoria append-only;
- outbox;
- idempotência.

---

# 28. Mudanças obrigatórias para Schema Lógico v1.1

Antes de migrations, atualizar o schema com:

1. remover conflito entre `UNIQUE` de documento e exceção auditada;
2. definir estratégia física segura para system roles x tenant roles;
3. impedir grants com role customizada de outro Tenant;
4. explicitar 1 membership → 1 user profile;
5. RLS fail-closed;
6. `FORCE ROW LEVEL SECURITY` a avaliar/adotar no data plane;
7. wrapper obrigatório de transação TenantContext;
8. FKs compostas completas em Party/Customer/Quote/OS;
9. estoque com atualização concorrente atômica;
10. transferências com estado em trânsito;
11. OS criada exatamente da versão aprovada;
12. `open_amount` e `stock_balances` como projeções controladas;
13. fiscal sequence separado de number_sequences;
14. secrets por referências de vault;
15. papéis PostgreSQL separados para runtime/worker/migration/control plane;
16. impersonation com ator real + usuário efetivo.

---

# 29. Gate

**Resultado da revisão:**

```text
ARQUITETURA DE DOMÍNIO        APROVADA
MODELO DE OWNERSHIP           APROVADO
MULTITENANCY                  APROVADO
SCHEMA LÓGICO v1              APROVADO COM AJUSTES
MIGRATIONS                    AINDA NÃO LIBERADAS
```

Próxima etapa:

> produzir `VETOROS_2_SCHEMA_LOGICO_POSTGRESQL_V1_1.md` incorporando os ajustes desta revisão.

Depois da aprovação do v1.1:

> produzir plano de migrations + testes de isolamento + prompt de implementação para Codex/CTO.
