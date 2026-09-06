-- ADM-03: interface administrativa de consulta ao histórico de auditoria já produzido pelos
-- módulos existentes. Ver executed.md "Descoberta" para o levantamento completo — resumo do que
-- justifica (ou não) esta migration:
--
-- * a tabela é `audit_events` (não existe `audit_logs` — o correio.md assumia esse nome; ver
--   Descoberta #1), já append-only (trigger `audit_events_append_only`, migration 0000), já com
--   RLS tenant-scoped (mesma política `tenant_isolation` de todo o resto) e já com o índice que
--   a consulta principal desta rodada precisa: `audit_events_tenant_created_idx` em
--   `(tenant_id, created_at DESC)`, cobrindo exatamente "listar por tenant, mais recente
--   primeiro, com filtro de período" — nenhum índice novo foi necessário (ver executed.md,
--   seção Performance, para o `EXPLAIN` que confirma isso);
-- * nenhuma coluna nova, nenhuma tabela nova — só a permission `audit.read`, que ainda não
--   existia (mesmo padrão de `users.*` na migration 0019 do ADM-01: inserida na migration
--   porque `mapTemplatePermissions()`/`provisionRoleTemplates()` em seed.ts, que decidem quem
--   recebe qual permission, só rodam depois que TODAS as permissions já existem).
INSERT INTO permissions (code,module,description) VALUES ('audit.read','audit','audit.read')
ON CONFLICT (code) DO NOTHING;
