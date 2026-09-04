# DB-01 — Implementação multitenant

## Escopo

Esta entrega implementa somente a fundação: `identities`, `tenants`, `tenant_memberships`, `tenant_user_profiles`, `companies`, `branches`, catálogo de permissões/templates, roles efetivas, grants, lotação em filial e auditoria. Não há módulos de negócio.

## Ownership e integridade

`identities`, `permissions`, `system_role_templates` e sua associação são globais. As demais tabelas operacionais são tenant-owned. `tenants` é a raiz/control plane e não recebe `tenant_id` artificial.

Chaves candidatas `(tenant_id,id)` sustentam FKs compostas. Elas impedem no banco uma branch de apontar para company de outro tenant, um perfil de apontar para membership externo, e grants de usarem perfil, role, company ou branch de outro escopo. Cascatas destrutivas não foram usadas.

Uma identidade pode ter memberships independentes em vários tenants. Cada membership possui exatamente um perfil lógico por constraint unique. Templates globais nunca são concedidos diretamente: cada tenant possui sua role efetiva.

## TenantContext e RLS

`withTenantTransaction` valida UUIDs antes de abrir a transação e usa `set_config(..., true)` para instalar tenant, ator real e perfil efetivo somente naquela transação. O callback recebe a transação, não a conexão global.

Todas as nove tabelas tenant-owned têm `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, `USING` e `WITH CHECK`. `vetoros_current_tenant_id()` devolve `NULL` para contexto ausente, vazio ou inválido; a comparação passa a desconhecida e nega leitura/escrita. A role runtime é `NOSUPERUSER` por padrão, `NOBYPASSRLS`, sem DDL, sem mutação dos catálogos globais e sem update/delete da auditoria.

O bootstrap cria roles separadas de migration, runtime, worker e control plane. Somente as duas primeiras são utilizáveis nesta etapa. As senhas do Compose são exclusivamente defaults locais e devem ser substituídas fora do desenvolvimento.

## Auditoria

`audit_events` registra tenant, ator real, perfil efetivo, ação, recurso e metadata. Um trigger bloqueia update/delete, tornando a tabela append-only. Segredos, hashes e tokens não devem ser gravados em metadata.

## UUID e timestamps

O banco usa UUID nativo com `gen_random_uuid()` para evitar dependência adicional. A aplicação pode adotar UUIDv7 posteriormente sem alteração de schema. Timestamps técnicos são `timestamptz`.

## Testes

Além dos testes de health, TenantContext e contrato estrutural, há 13 testes de integração em PostgreSQL 17 para RLS, FKs, privilégios, rollback, reutilização de conexão e isolamento concorrente.

## Limitações e próximos passos

- Não existe autenticação; o contexto ainda deve ser derivado de uma sessão confiável na etapa AUTH-01, nunca de payload do cliente.
- Worker e control plane estão reservados, sem privilégios de data plane nesta fase.
- Rotação de credenciais e TLS pertencem ao deployment, não ao Compose local.

Próximo gate recomendado, sem implementação nesta entrega: **AUTH-01 — Authentication + Session + Tenant Selection**.
