import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(new URL('../migrations/0000_db01_multitenancy.sql', import.meta.url), 'utf8');

// OS-ADV-02, seção 18 do correio.md: a migration 0031 existia no disco, correta, mas nunca foi
// aplicada em nenhum ambiente porque `meta/_journal.json` não tinha entrada para ela — o
// `drizzle-orm/migrator` lê o journal, não a pasta, então um arquivo `.sql` sem entrada
// correspondente é silenciosamente ignorado para sempre (root cause do saneamento anterior).
// Este teste falha o gate a próxima vez que isso acontecer, em vez de só ser descoberto quando
// uma coluna "sumir" em produção.
describe('migrations journal completeness', () => {
  it('has exactly one journal entry per versioned .sql file, and vice-versa', async () => {
    const files = (await readdir(new URL('../migrations', import.meta.url)))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.replace(/\.sql$/, ''))
      .sort();
    const journal = JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { tag: string }[] };
    const tags = journal.entries.map((entry) => entry.tag).sort();
    expect(tags).toEqual(files);
  });
  it('keeps the journal in strictly increasing idx and chronological "when" order', async () => {
    const journal = JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { idx: number; when: number }[] };
    journal.entries.forEach((entry, position) => expect(entry.idx).toBe(position));
    for (let i = 1; i < journal.entries.length; i++) expect(journal.entries[i]!.when).toBeGreaterThan(journal.entries[i - 1]!.when);
  });
});
describe('DB-01 migration security contract', () => {
  it.each(['tenant_memberships','tenant_user_profiles','companies','branches','tenant_roles','tenant_role_permissions','access_grants','branch_memberships','audit_events'])('includes %s in forced RLS setup', (table) => expect(migration).toContain(`'${table}'`));
  it('uses a fail-closed tenant function and WITH CHECK', () => {
    expect(migration).toContain('ELSE NULL END');
    expect(migration).toContain('WITH CHECK (tenant_id = vetoros_current_tenant_id())');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
  });
  it.each([
    'FOREIGN KEY (tenant_id,company_id) REFERENCES companies(tenant_id,id)',
    'FOREIGN KEY (tenant_id,role_id) REFERENCES tenant_roles(tenant_id,id)',
    'FOREIGN KEY (tenant_id,membership_id) REFERENCES tenant_memberships(tenant_id,id)',
    'FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id)',
  ])('contains cross-scope constraint %s', (constraint) => expect(migration).toContain(constraint));
  it('does not grant mutation of global role templates to runtime', () => {
    expect(migration).toContain('GRANT SELECT ON permissions, system_role_templates');
    expect(migration).not.toMatch(/GRANT[^;]*INSERT[^;]*ON system_role_templates/);
  });
});
