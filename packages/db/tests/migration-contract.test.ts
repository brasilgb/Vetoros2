import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(new URL('../migrations/0000_db01_multitenancy.sql', import.meta.url), 'utf8');
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
