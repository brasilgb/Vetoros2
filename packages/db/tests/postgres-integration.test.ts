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
  // FIN-03 fechamento de gate: fornecedor e pedido de compra por tenant, para provar no
  // PostgreSQL (não só na API) que `payables.supplier_id`/`payables.purchase_order_id` não
  // podem apontar para outro tenant.
  supplierA: randomUUID(), supplierB: randomUUID(), purchaseOrderA: randomUUID(), purchaseOrderB: randomUUID(),
  // FIN-04 fechamento de gate: conta financeira por tenant, para provar no PostgreSQL que
  // `financial_transactions.financial_account_id`/`financial_transfers.from_financial_account_id`/
  // `to_financial_account_id` usam FK composta same-tenant e que as funções `security definer`
  // (que também filtram por `tenant_id=vetoros_current_tenant_id()`) recusam associação
  // cross-tenant mesmo quando o UUID é sintaticamente válido.
  financialAccountA: randomUUID(), financialAccountB: randomUUID(),
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
      await tx`insert into suppliers (id,tenant_id,supplier_number,person_type,legal_name) values (${ids[`supplier${suffix}`]},${tenant},1,'company',${`Supplier ${suffix}`})`;
      await tx`insert into purchase_orders (id,tenant_id,company_id,branch_id,purchase_order_number,supplier_id,status) values (${ids[`purchaseOrder${suffix}`]},${tenant},${ids[`company${suffix}`]},${ids[`branch${suffix}`]},1,${ids[`supplier${suffix}`]},'approved')`;
      await tx`insert into financial_accounts (id,tenant_id,company_id,name) values (${ids[`financialAccount${suffix}`]},${tenant},${ids[`company${suffix}`]},${`Conta ${suffix}`})`;
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
  // FIN-03 fechamento de gate (correio.md): provar no PostgreSQL — não só via 404/403 da API —
  // que `payables.supplier_id`/`payables.purchase_order_id` usam FK COMPOSTA same-tenant
  // (`foreign key (tenant_id,supplier_id) references suppliers(tenant_id,id)`, idem para
  // purchase_order_id — ver migration 0024). Um UUID de outro tenant nunca casa com a linha
  // `(tenant_id_correto, id)` da tabela referenciada, então a constraint rejeita
  // estruturalmente, mesmo que a política RLS mudasse ou a chamada viesse fora da API/função
  // `security definer`.
  it('blocks a payable pointing to a supplier from another tenant', async () => {
    await expect(inTenant(admin, ids.tenantA!, (tx) => tx`
      insert into payables (tenant_id,company_id,branch_id,supplier_id,description)
      values (${ids.tenantA},${ids.companyA},${ids.branchA},${ids.supplierB},'Bad — fornecedor de outro tenant')
    `)).rejects.toMatchObject({ code: '23503' });
  });
  it('blocks a payable pointing to a purchase order from another tenant', async () => {
    await expect(inTenant(admin, ids.tenantA!, (tx) => tx`
      insert into payables (tenant_id,company_id,branch_id,supplier_id,purchase_order_id,description)
      values (${ids.tenantA},${ids.companyA},${ids.branchA},${ids.supplierA},${ids.purchaseOrderB},'Bad — pedido de outro tenant')
    `)).rejects.toMatchObject({ code: '23503' });
  });
  it('control: allows a payable referencing supplier and purchase order from the same tenant', async () => {
    const rows = await inTenant(admin, ids.tenantA!, (tx) => tx`
      insert into payables (tenant_id,company_id,branch_id,supplier_id,purchase_order_id,description)
      values (${ids.tenantA},${ids.companyA},${ids.branchA},${ids.supplierA},${ids.purchaseOrderA},'Good — mesmo tenant')
      returning id
    `);
    expect(rows).toHaveLength(1);
  });

  // FIN-04 fechamento de gate (correio.md, seção 21): provar no PostgreSQL — não só via 404/403
  // da API — que uma linha do ledger de tesouraria não pode apontar para uma conta financeira de
  // outro tenant, nem por INSERT direto (FK composta same-tenant) nem através das funções
  // `security definer` (que filtram tudo por `tenant_id=vetoros_current_tenant_id()`, então uma
  // conta de outro tenant simplesmente não é "encontrada" mesmo com um UUID sintaticamente válido
  // — nunca um 500 cru, sempre o mesmo contrato de erro `P0002`/`23503` já coberto pela API).
  it('blocks a financial_transaction pointing to a financial account from another tenant (direct insert)', async () => {
    await expect(inTenant(admin, ids.tenantA!, (tx) => tx`
      insert into financial_transactions (tenant_id,company_id,financial_account_id,type,amount,description,origin,idempotency_key)
      values (${ids.tenantA},${ids.companyA},${ids.financialAccountB},'credit',10,'Bad — conta de outro tenant','manual','cross-tenant-direct-01')
    `)).rejects.toMatchObject({ code: '23503' });
  });
  it('blocks a financial_transfer pointing to a from/to financial account from another tenant (direct insert)', async () => {
    await expect(inTenant(admin, ids.tenantA!, (tx) => tx`
      insert into financial_transfers (tenant_id,from_financial_account_id,to_financial_account_id,amount,description,idempotency_key)
      values (${ids.tenantA},${ids.financialAccountA},${ids.financialAccountB},10,'Bad — destino de outro tenant','cross-tenant-transfer-direct-01')
    `)).rejects.toMatchObject({ code: '23503' });
  });
  it('rejects a manual entry, opening balance and transfer attempted against another tenant\'s account through the security definer functions (not found, never a silent cross-tenant write)', async () => {
    await expect(inTenant(runtime, ids.tenantA!, (tx) => tx`select * from record_financial_transaction(${ids.financialAccountB},'credit',10,'Bad','ref',null,'cross-tenant-manual-01')`)).rejects.toMatchObject({ code: 'P0002' });
    await expect(inTenant(runtime, ids.tenantA!, (tx) => tx`select * from set_financial_account_opening_balance(${ids.financialAccountB},10,'cross-tenant-opening-01')`)).rejects.toMatchObject({ code: 'P0002' });
    await expect(inTenant(runtime, ids.tenantA!, (tx) => tx`select * from transfer_between_financial_accounts(${ids.financialAccountA},${ids.financialAccountB},10,'Bad','cross-tenant-transfer-fn-01')`)).rejects.toMatchObject({ code: 'P0002' });
  });
  it('control: allows a financial_transaction referencing a financial account from the same tenant', async () => {
    const rows = await inTenant(admin, ids.tenantA!, (tx) => tx`
      insert into financial_transactions (tenant_id,company_id,financial_account_id,type,amount,description,origin,idempotency_key)
      values (${ids.tenantA},${ids.companyA},${ids.financialAccountA},'credit',10,'Good — mesmo tenant','manual','cross-tenant-control-01')
      returning id
    `);
    expect(rows).toHaveLength(1);
  });
  it('isolates financial account listing per tenant under RLS (a financial account from another tenant is invisible)', async () => {
    const rows = await inTenant(runtime, ids.tenantA!, (tx) => tx`select id from financial_accounts`);
    expect(rows.map((row) => row.id)).toContain(ids.financialAccountA);
    expect(rows.map((row) => row.id)).not.toContain(ids.financialAccountB);
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
