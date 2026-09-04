# Prompt de Execução — VetorOS 2 — Ciclo 1: Baseline + Fundação Multitenant DB-01

Você é o CTO/engenheiro principal responsável pela implementação do VetorOS 2.

## Missão

Executar **somente** o primeiro ciclo aprovado:

```text
FASE 0 — Descoberta/Baseline
+
FASE DB-01 — Fundação Multitenant e Segurança
```

Não avance para clientes, produtos, estoque, orçamento, OS, caixa, financeiro ou fiscal nesta rodada.

## Documentos normativos

Considere como fonte de verdade arquitetural, nesta ordem:

1. `VETOROS_2_ARQUITETURA_MULTITENANCY_ADRS_APROVADOS.md`
2. `VETOROS_2_SCHEMA_LOGICO_POSTGRESQL_V1_1.md`
3. `VETOROS_2_PLANO_FINAL_IMPLEMENTACAO.md`
4. `VETOROS_2_REVISAO_CRITICA_SCHEMA_V1.md`
5. `MULTITENANCY_AND_DATA_OWNERSHIP.md`

Se o repositório divergir, não descarte código silenciosamente: relate a divergência e adapte preservando comportamento útil quando compatível com a nova arquitetura.

---

# PARTE A — Baseline obrigatório

Antes de alterar código:

1. identifique estrutura do monorepo;
2. identifique package manager e versões reais;
3. mostre versões de Node/Fastify/Next/Drizzle/Postgres relevantes;
4. localize:
   - schema Drizzle;
   - migrations;
   - auth;
   - users/roles;
   - Docker;
   - tests;
5. liste tabelas/migrations atuais;
6. identifique assumptions single-tenant;
7. execute:
   - install (somente se necessário);
   - typecheck;
   - lint;
   - tests;
   - build;
8. registre falhas preexistentes.

Crie:

```text
docs/architecture/VETOROS_2_BASELINE_REPOSITORIO.md
```

ou localização documental equivalente já usada pelo projeto.

Não use falha preexistente como justificativa para esconder nova regressão.

---

# PARTE B — Fundação DB-01

Implementar, respeitando convenções reais do projeto:

```text
identities
tenants
tenant_memberships
tenant_user_profiles
companies
branches

permissions
system_role_templates
system_role_template_permissions
tenant_roles
tenant_role_permissions
access_grants
branch_memberships

audit_events
```

## PK

Use UUID conforme padrões do projeto, preferindo UUIDv7 se a stack/infra já suportar de modo limpo. Não introduza biblioteca desnecessária apenas para cumprir estética; documente a solução.

## FKs

Crie chaves candidatas/uniques necessárias para FKs compostas.

Obrigatório impedir fisicamente cross-tenant/cross-company onde a invariância já está definida.

## Role model

Não misture role template global diretamente com tenant role efetiva.

```text
system_role_templates
tenant_roles
```

`access_grants` deve referenciar tenant role com FK que carregue `tenant_id`, impedindo role de outro Tenant.

## Membership model

Cardinalidade:

```text
Identity
→ many TenantMemberships

TenantMembership
→ one TenantUserProfile
```

---

# PARTE C — TenantContext

Implemente uma única abstraction tenant-aware para acesso ao banco, por exemplo:

```ts
withTenantTransaction(context, callback)
```

O nome pode seguir convenção do projeto.

Requisitos:

- transação obrigatória;
- `SET LOCAL app.tenant_id`;
- actor identity;
- effective user profile;
- rollback/cleanup automático;
- repositories tenant-owned não devem usar conexão global sem contexto.

Nunca aceite `tenant_id` do body/query como autoridade.

---

# PARTE D — RLS

Implemente PostgreSQL RLS nas tabelas tenant-owned desta fase.

Requisitos:

```text
missing context = deny
wrong tenant = deny
correct tenant = pass RLS
```

O runtime comum:

```text
NO BYPASSRLS
```

Avalie/implemente `FORCE ROW LEVEL SECURITY` onde apropriado.

Não use usuário owner/superuser como conexão normal da API.

Se Docker/local exigir criação de database roles, ajuste bootstrap/migrations de forma reproduzível.

Papéis conceituais:

```text
vetoros_runtime
vetoros_worker
vetoros_migration
vetoros_control_plane
```

Nesta rodada implemente o necessário para runtime/migration e deixe os demais preparados/documentados se ainda não houver worker/control plane.

---

# PARTE E — Permissions e Seeds

Criar catálogo inicial idempotente.

Roles templates iniciais:

```text
owner
administrator
attendance
technician
inventory
cashier
finance
fiscal
read_only
```

Não invente permissões de módulos ainda inexistentes além do necessário para formar o catálogo; use naming estável e documente.

Templates de sistema devem ser imutáveis pelo runtime.

---

# PARTE F — Auditoria

Implementar estrutura `audit_events` append-only para eventos desta fase, incluindo:

- membership;
- role/grant;
- mudança de escopo relevante;
- login/context switch se integração com auth já for viável.

Nunca registrar:

- password;
- token;
- secret.

---

# PARTE G — Testes obrigatórios

Crie testes automatizados que provem, não apenas simulem:

## RLS

1. Tenant A não lê linha de B.
2. Tenant A não cria linha como B.
3. Tenant A não altera B.
4. Tenant A não apaga B.
5. contexto ausente não ganha acesso.
6. contexto reutilizado no pool não vaza Tenant anterior.

## FKs

7. Branch A não aponta Company de outro Tenant.
8. AccessGrant A não aponta tenant_role B.
9. tenant_user_profile não aponta membership de outro Tenant.
10. grant Branch não aponta Branch de Company incompatível.

## Runtime permissions

11. runtime não altera `system_role_templates`.
12. runtime não possui BYPASSRLS.

## TenantContext

13. erro dentro do callback causa rollback.
14. contexto correto permanece somente durante transaction.

Não marque esses testes como skip.

---

# PARTE H — Compatibilidade

Se já existir login/user model:

- não faça substituição destrutiva sem analisar;
- crie migração/adapter compatível quando necessário;
- documente o que ficou legado e qual será a estratégia de migração.

Não implemente ainda migração completa de dados legados, salvo backfill mínimo estritamente necessário à integridade da DB-01.

---

# PARTE I — Qualidade

Ao final rode a suíte completa disponível:

```text
typecheck
lint
tests
build
```

Também valide Docker/migrations em:

1. banco limpo;
2. execução das migrations do zero;
3. se houver mecanismo existente, rollback/recreate ou restore test.

Não afirme sucesso sem executar os comandos relevantes.

---

# PARTE J — Relatório obrigatório

Entregue ao final:

## 1. Resumo
O que foi implementado.

## 2. Baseline
Estado encontrado antes das alterações.

## 3. Arquivos criados
Lista.

## 4. Arquivos alterados
Lista + propósito.

## 5. Migrations
Número/nome + tabelas/constraints/RLS.

## 6. TenantContext
Como funciona.

## 7. RLS
Policies e database roles.

## 8. Testes
Tabela:

```text
comando | resultado | quantidade | duração aproximada se disponível
```

## 9. Testes de isolamento
Descreva cada cenário e resultado.

## 10. Compatibilidade
Impactos no código antigo.

## 11. Pendências
Somente pendências reais; não esconda erros.

## 12. Riscos
Qualquer risco arquitetural observado.

## 13. Gate
Declare uma das opções:

```text
DB-01 APROVÁVEL
```

ou

```text
DB-01 NÃO APROVÁVEL
```

com motivo objetivo.

---

# STOP CONDITION

Após concluir DB-01:

**PARE.**

Não implemente DB-02.

Não crie clientes/produtos/estoque/orçamentos/OS novos nesta rodada.

A fundação será revisada pelo Diretor/COO antes da autorização da próxima fase.

A prioridade é qualidade e isolamento comprovado, não velocidade de quantidade de módulos.
