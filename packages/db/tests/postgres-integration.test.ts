import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const admin = postgres(migrationUrl, { max: 2 });
const runtime = postgres(runtimeUrl, { max: 2 });
const ids = {
  tenantA: randomUUID(), tenantB: randomUUID(), identity: randomUUID(),
  membershipA: randomUUID(), membershipB: randomUUID(), profileA: randomUUID(), profileB: randomUUID(),
  companyA: randomUUID(), companyB: randomUUID(), branchA: randomUUID(), branchB: randomUUID(), roleA: randomUUID(), roleB: randomUUID(),
};

async function inTenant<T>(client: postgres.Sql, tenantId: string, callback: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return client.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    return callback(tx);
  }) as Promise<T>;
}

beforeAll(async () => {
  await admin`insert into identities (id,email_normalized,display_name,status) values (${ids.identity},${`db01-${ids.identity}@example.test`},'DB01 Identity','active')`;
  await admin`insert into tenants (id,slug,legal_name,status) values (${ids.tenantA},${`alpha-${ids.tenantA}`},'Tenant Alpha','active'),(${ids.tenantB},${`beta-${ids.tenantB}`},'Tenant Beta','active')`;
  for (const suffix of ['A', 'B'] as const) {
    const tenant = ids[`tenant${suffix}`]!;
    await inTenant(admin, tenant, async (tx) => {
      await tx`insert into tenant_memberships (id,tenant_id,identity_id,status) values (${ids[`membership${suffix}`]},${tenant},${ids.identity},'active')`;
      await tx`insert into tenant_user_profiles (id,tenant_id,membership_id,name) values (${ids[`profile${suffix}`]},${tenant},${ids[`membership${suffix}`]},${`Profile ${suffix}`})`;
      await tx`insert into companies (id,tenant_id,legal_name,tax_id_type,tax_id_normalized) values (${ids[`company${suffix}`]},${tenant},${`Company ${suffix}`},'cnpj',${ids[`company${suffix}`]!.replaceAll('-','').slice(0,14)})`;
      await tx`insert into branches (id,tenant_id,company_id,code,name) values (${ids[`branch${suffix}`]},${tenant},${ids[`company${suffix}`]},'MAIN',${`Branch ${suffix}`})`;
      await tx`insert into tenant_roles (id,tenant_id,code,name,scope_type) values (${ids[`role${suffix}`]},${tenant},'tester','Tester','tenant')`;
    });
  }
});

afterAll(async () => { await Promise.all([admin.end(), runtime.end()]); });

describe('PostgreSQL RLS under vetoros_runtime', () => {
  it('allows tenant A to read A and hides B', async () => {
    const rows = await inTenant(runtime, ids.tenantA!, (tx) => tx`select id from companies order by id`);
    expect(rows.map((row) => row.id)).toContain(ids.companyA);
    expect(rows.map((row) => row.id)).not.toContain(ids.companyB);
  });
  it('fails closed without context', async () => expect((await runtime`select id from companies where id in (${ids.companyA},${ids.companyB})`)).toHaveLength(0));
  it('blocks insert carrying another tenant id', async () => {
    await expect(inTenant(runtime, ids.tenantA!, (tx) => tx`insert into companies (tenant_id,legal_name,tax_id_type,tax_id_normalized) values (${ids.tenantB},'Attack','cnpj',${randomUUID()})`)).rejects.toMatchObject({ code: '42501' });
  });
  it('cannot update or delete tenant B while scoped to A', async () => {
    expect(await inTenant(runtime, ids.tenantA!, (tx) => tx`update companies set trade_name='Attack' where id=${ids.companyB} returning id`)).toHaveLength(0);
    expect(await inTenant(runtime, ids.tenantA!, (tx) => tx`delete from companies where id=${ids.companyB} returning id`)).toHaveLength(0);
  });
  it('does not leak context after pooled transaction reuse', async () => {
    const single = postgres(runtimeUrl, { max: 1 });
    try {
      expect(await inTenant(single, ids.tenantA!, async (tx) => (await tx`select id from companies`).length)).toBeGreaterThan(0);
      expect(await single`select id from companies`).toHaveLength(0);
    } finally { await single.end(); }
  });
  it('isolates concurrent tenants', async () => {
    const [a, b] = await Promise.all([inTenant(runtime, ids.tenantA!, (tx) => tx`select id from companies`), inTenant(runtime, ids.tenantB!, (tx) => tx`select id from companies`)]);
    expect(a.map((row) => row.id)).toContain(ids.companyA); expect(a.map((row) => row.id)).not.toContain(ids.companyB);
    expect(b.map((row) => row.id)).toContain(ids.companyB); expect(b.map((row) => row.id)).not.toContain(ids.companyA);
  });
});

describe('physical tenant integrity', () => {
  it('blocks a branch pointing to another tenant company', async () => {
    await expect(inTenant(admin, ids.tenantA!, (tx) => tx`insert into branches (tenant_id,company_id,code,name) values (${ids.tenantA},${ids.companyB},'BAD','Bad')`)).rejects.toMatchObject({ code: '23503' });
  });
  it('blocks a profile pointing to another tenant membership', async () => {
    await expect(inTenant(admin, ids.tenantA!, (tx) => tx`insert into tenant_user_profiles (tenant_id,membership_id,name) values (${ids.tenantA},${ids.membershipB},'Bad')`)).rejects.toMatchObject({ code: '23503' });
  });
  it('blocks a grant pointing to another tenant role', async () => {
    await expect(inTenant(admin, ids.tenantA!, (tx) => tx`insert into access_grants (tenant_id,user_profile_id,role_id,scope_type) values (${ids.tenantA},${ids.profileA},${ids.roleB},'tenant')`)).rejects.toMatchObject({ code: '23503' });
  });
  it('blocks a branch grant whose branch is from another company', async () => {
    const otherCompany = randomUUID();
    await inTenant(admin, ids.tenantA!, (tx) => tx`insert into companies (id,tenant_id,legal_name,tax_id_type,tax_id_normalized) values (${otherCompany},${ids.tenantA},'Other','cnpj',${otherCompany.replaceAll('-','').slice(0,14)})`);
    await expect(inTenant(admin, ids.tenantA!, (tx) => tx`insert into access_grants (tenant_id,user_profile_id,role_id,scope_type,company_id,branch_id) values (${ids.tenantA},${ids.profileA},${ids.roleA},'branch',${otherCompany},${ids.branchA})`)).rejects.toMatchObject({ code: '23503' });
  });
});

describe('runtime privileges and transaction behavior', () => {
  it('runtime is neither superuser nor BYPASSRLS', async () => {
    const [role] = await runtime`select rolsuper, rolbypassrls from pg_roles where rolname=current_user`;
    expect(role).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });
  it('runtime cannot mutate global role templates', async () => {
    await expect(runtime`update system_role_templates set name='Attack' where code='owner'`).rejects.toMatchObject({ code: '42501' });
  });
  it('rolls back when the callback fails', async () => {
    const company = randomUUID();
    await expect(inTenant(runtime, ids.tenantA!, async (tx) => { await tx`insert into companies (id,tenant_id,legal_name,tax_id_type,tax_id_normalized) values (${company},${ids.tenantA},'Rollback','cnpj',${company.replaceAll('-','').slice(0,14)})`; throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await inTenant(runtime, ids.tenantA!, (tx) => tx`select id from companies where id=${company}`)).toHaveLength(0);
  });
});
