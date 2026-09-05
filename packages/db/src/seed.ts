import { sql } from 'drizzle-orm';
import argon2 from 'argon2';
import { createDatabase } from './client.js';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
const { client, db } = createDatabase(url, { max: 1 });
const templates = ['owner', 'administrator', 'attendance', 'technician', 'inventory', 'cashier', 'finance', 'fiscal', 'read_only'];
const dev = {
  identity: '01992ea1-1250-7000-8000-000000000001',
  identitySingle: '01992ea1-1250-7000-8000-000000000002', identityNone: '01992ea1-1250-7000-8000-000000000003',
  identityFaker: '01992ea1-1250-7000-8000-000000000004',
  tenantAlpha: '01992ea1-1250-7000-8000-000000000010', tenantBeta: '01992ea1-1250-7000-8000-000000000020',
  membershipAlpha: '01992ea1-1250-7000-8000-000000000011', membershipBeta: '01992ea1-1250-7000-8000-000000000021',
  membershipSingle: '01992ea1-1250-7000-8000-000000000014',
  profileAlpha: '01992ea1-1250-7000-8000-000000000015', profileBeta: '01992ea1-1250-7000-8000-000000000025', profileSingle: '01992ea1-1250-7000-8000-000000000016',
  companyAlpha: '01992ea1-1250-7000-8000-000000000012', companyBeta: '01992ea1-1250-7000-8000-000000000022',
  branchAlpha: '01992ea1-1250-7000-8000-000000000013', branchBeta: '01992ea1-1250-7000-8000-000000000023',
  companyAlphaServices: '01992ea1-1250-7000-8000-000000000017', branchAlphaNorth: '01992ea1-1250-7000-8000-000000000018', branchAlphaServices: '01992ea1-1250-7000-8000-000000000019',
  permissionSessionRead: '01992ea1-1250-7000-8000-000000000030', roleSingle: '01992ea1-1250-7000-8000-000000000031', grantSingle: '01992ea1-1250-7000-8000-000000000032',
  membershipFaker: '01992ea1-1250-7000-8000-000000000024', profileFaker: '01992ea1-1250-7000-8000-000000000026', roleFaker: '01992ea1-1250-7000-8000-000000000046', grantFaker: '01992ea1-1250-7000-8000-000000000047',
};
try {
  for (const code of templates) {
    await db.execute(sql`insert into system_role_templates (code, name, scope_type, inherits_descendants)
      values (${code}, ${code.replaceAll('_', ' ')}, 'tenant', true) on conflict (code) do nothing`);
  }
  const devPassword = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
  const passwordHash = await argon2.hash(devPassword, { type: argon2.argon2id });
  const fakerEnabled = process.env.NODE_ENV !== 'production';
  const fakerPassword = process.env.DEV_FAKER_PASSWORD ?? '12345678';
  const fakerHash = fakerEnabled ? await argon2.hash(fakerPassword, { type: argon2.argon2id }) : null;
  await db.execute(sql`insert into identities (id,email_normalized,password_hash,display_name,status) values
    (${dev.identity},'shared@vetoros.local',${passwordHash},'Identity compartilhada','active'),
    (${dev.identitySingle},'single@vetoros.local',${passwordHash},'Identity single tenant','active'),
    (${dev.identityNone},'none@vetoros.local',${passwordHash},'Identity sem membership','active'),
    (${dev.identityFaker},'andersonbrasil72@gmail.com',${fakerHash},'Usuário faker local',${fakerEnabled ? 'active' : 'blocked'})
    on conflict (id) do update set password_hash=excluded.password_hash`);
  await db.execute(sql`insert into tenants (id,slug,legal_name,trade_name,status) values
    (${dev.tenantAlpha},'tenant-alpha','Tenant Alpha','Tenant Alpha','active'),
    (${dev.tenantBeta},'tenant-beta','Tenant Beta','Tenant Beta','active') on conflict (id) do nothing`);
  const permissionCodes = ['auth.session.read','operational.context.select','companies.read','companies.create','companies.update','branches.read','branches.create','branches.update','customers.read','customers.create','customers.update','customer_assets.read','customer_assets.create','customer_assets.update','service_orders.read','service_orders.create','service_orders.update','quotes.read','quotes.create','quotes.update','inventory.read','inventory.create','inventory.update','inventory.move','suppliers.read','suppliers.create','suppliers.update','purchase_orders.read','purchase_orders.create','purchase_orders.update','purchase_orders.approve','purchase_receipts.read','purchase_receipts.create','purchase_receipts.update','purchase_receipts.confirm'];
  const permissionIds = [dev.permissionSessionRead,'01992ea1-1250-7000-8000-000000000033','01992ea1-1250-7000-8000-000000000034','01992ea1-1250-7000-8000-000000000035','01992ea1-1250-7000-8000-000000000036','01992ea1-1250-7000-8000-000000000037','01992ea1-1250-7000-8000-000000000038','01992ea1-1250-7000-8000-000000000039','01992ea1-1250-7000-8000-000000000040','01992ea1-1250-7000-8000-000000000041','01992ea1-1250-7000-8000-000000000042','01992ea1-1250-7000-8000-000000000043','01992ea1-1250-7000-8000-000000000044','01992ea1-1250-7000-8000-000000000045','01992ea1-1250-7000-8000-000000000046','01992ea1-1250-7000-8000-000000000047','01992ea1-1250-7000-8000-000000000048','01992ea1-1250-7000-8000-000000000049','01992ea1-1250-7000-8000-00000000004a','01992ea1-1250-7000-8000-00000000004b','01992ea1-1250-7000-8000-00000000004c','01992ea1-1250-7000-8000-00000000004d','01992ea1-1250-7000-8000-00000000004e','01992ea1-1250-7000-8000-00000000004f','01992ea1-1250-7000-8000-000000000050','01992ea1-1250-7000-8000-000000000051','01992ea1-1250-7000-8000-000000000052','01992ea1-1250-7000-8000-000000000053','01992ea1-1250-7000-8000-000000000054','01992ea1-1250-7000-8000-000000000055','01992ea1-1250-7000-8000-000000000056','01992ea1-1250-7000-8000-000000000057','01992ea1-1250-7000-8000-000000000058','01992ea1-1250-7000-8000-000000000059','01992ea1-1250-7000-8000-00000000005a'];
  for (const [position, code] of permissionCodes.entries()) await db.execute(sql`insert into permissions (id,code,module,description) values (${permissionIds[position]!},${code},${code.split('.')[0]!},${code}) on conflict (id) do nothing`);
  for (const item of [
    { tenant: dev.tenantAlpha, membership: dev.membershipAlpha, company: dev.companyAlpha, branch: dev.branchAlpha, suffix: 'Alpha' },
    { tenant: dev.tenantBeta, membership: dev.membershipBeta, company: dev.companyBeta, branch: dev.branchBeta, suffix: 'Beta' },
  ]) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${item.tenant}, true)`);
      await tx.execute(sql`insert into tenant_memberships (id,tenant_id,identity_id,status) values (${item.membership},${item.tenant},${dev.identity},'active') on conflict (id) do nothing`);
      const profile = item.tenant === dev.tenantAlpha ? dev.profileAlpha : dev.profileBeta;
      await tx.execute(sql`insert into tenant_user_profiles (id,tenant_id,membership_id,name) values (${profile},${item.tenant},${item.membership},${`Shared ${item.suffix}`}) on conflict (id) do nothing`);
      await tx.execute(sql`insert into companies (id,tenant_id,legal_name,trade_name,tax_id_type,tax_id_normalized) values (${item.company},${item.tenant},${`Company ${item.suffix}`},${`Company ${item.suffix}`},'cnpj',${item.company.replaceAll('-', '').slice(0, 14)}) on conflict (id) do nothing`);
      await tx.execute(sql`insert into branches (id,tenant_id,company_id,code,name,is_default) values (${item.branch},${item.tenant},${item.company},'MAIN',${`Branch ${item.suffix}`},true) on conflict (id) do nothing`);
    });
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${dev.tenantAlpha}, true)`);
    await tx.execute(sql`insert into tenant_memberships (id,tenant_id,identity_id,status) values (${dev.membershipSingle},${dev.tenantAlpha},${dev.identitySingle},'active') on conflict (id) do nothing`);
    await tx.execute(sql`insert into tenant_user_profiles (id,tenant_id,membership_id,name) values (${dev.profileSingle},${dev.tenantAlpha},${dev.membershipSingle},'Single Alpha') on conflict (id) do nothing`);
    await tx.execute(sql`insert into tenant_roles (id,tenant_id,code,name,scope_type) values (${dev.roleSingle},${dev.tenantAlpha},'dev_auth_reader','Development auth reader','tenant') on conflict (id) do nothing`);
    for (const permissionId of permissionIds) await tx.execute(sql`insert into tenant_role_permissions (tenant_id,role_id,permission_id) values (${dev.tenantAlpha},${dev.roleSingle},${permissionId}) on conflict do nothing`);
    await tx.execute(sql`insert into access_grants (id,tenant_id,user_profile_id,role_id,scope_type) values (${dev.grantSingle},${dev.tenantAlpha},${dev.profileSingle},${dev.roleSingle},'tenant') on conflict (id) do nothing`);
    await tx.execute(sql`insert into companies (id,tenant_id,legal_name,trade_name,tax_id_type,tax_id_normalized) values (${dev.companyAlphaServices},${dev.tenantAlpha},'Company Alpha Serviços','Alpha Serviços','cnpj','01992ea1125071') on conflict (id) do nothing`);
    await tx.execute(sql`insert into branches (id,tenant_id,company_id,code,name) values (${dev.branchAlphaNorth},${dev.tenantAlpha},${dev.companyAlpha},'NORTH','Branch Alpha Norte'),(${dev.branchAlphaServices},${dev.tenantAlpha},${dev.companyAlphaServices},'SERVICES','Branch Alpha Serviços 01') on conflict (id) do nothing`);
  });
  if (fakerEnabled) await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${dev.tenantAlpha}, true)`);
    await tx.execute(sql`insert into tenant_memberships (id,tenant_id,identity_id,status) values (${dev.membershipFaker},${dev.tenantAlpha},${dev.identityFaker},'active') on conflict (id) do nothing`);
    await tx.execute(sql`insert into tenant_user_profiles (id,tenant_id,membership_id,name) values (${dev.profileFaker},${dev.tenantAlpha},${dev.membershipFaker},'Anderson Brasil (faker)') on conflict (id) do nothing`);
    await tx.execute(sql`insert into tenant_roles (id,tenant_id,code,name,scope_type) values (${dev.roleFaker},${dev.tenantAlpha},'dev_faker_all','Development faker local','tenant') on conflict (id) do nothing`);
    for (const permissionId of permissionIds) await tx.execute(sql`insert into tenant_role_permissions (tenant_id,role_id,permission_id) values (${dev.tenantAlpha},${dev.roleFaker},${permissionId}) on conflict do nothing`);
    await tx.execute(sql`insert into access_grants (id,tenant_id,user_profile_id,role_id,scope_type) values (${dev.grantFaker},${dev.tenantAlpha},${dev.profileFaker},${dev.roleFaker},'tenant') on conflict (id) do nothing`);
  });
  for (const sample of [
    { tenant: dev.tenantAlpha, customer: '01992ea1-1250-7000-8000-000000000050', type: 'individual', name: 'Cliente Alpha PF', docType: 'cpf', doc: '52998224725', company: dev.companyAlpha },
    { tenant: dev.tenantAlpha, customer: '01992ea1-1250-7000-8000-000000000051', type: 'company', name: 'Cliente Alpha PJ', docType: 'cnpj', doc: '11222333000181', company: dev.companyAlpha },
    { tenant: dev.tenantBeta, customer: '01992ea1-1250-7000-8000-000000000052', type: 'individual', name: 'Cliente Beta PF', docType: 'cpf', doc: '39053344705', company: dev.companyBeta },
  ]) await db.transaction(async (tx) => { await tx.execute(sql`select set_config('app.tenant_id',${sample.tenant},true)`); const existing=await tx.execute(sql`select id from customers where id=${sample.customer} or (tenant_id=${sample.tenant} and document_type=${sample.docType} and document_normalized=${sample.doc})`); if(existing.length)return; const [counter]=await tx.execute<{last_number:number}>(sql`insert into customer_number_counters(tenant_id,last_number) values(${sample.tenant},1) on conflict(tenant_id) do update set last_number=customer_number_counters.last_number+1,updated_at=now() returning last_number`); await tx.execute(sql`insert into customers(id,tenant_id,customer_number,person_type,legal_name,document_type,document_normalized,origin_company_id) values(${sample.customer},${sample.tenant},${counter!.last_number},${sample.type},${sample.name},${sample.docType},${sample.doc},${sample.company})`); });
} finally { await client.end(); }
