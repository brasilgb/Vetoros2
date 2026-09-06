import { sql } from 'drizzle-orm';
import argon2 from 'argon2';
import { createDatabase } from './client.js';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
const { client, db } = createDatabase(url, { max: 1 });
const templates = ['owner', 'administrator', 'attendance', 'technician', 'inventory', 'cashier', 'finance', 'fiscal', 'read_only'];
const roleTemplateNames: Record<string, string> = { owner: 'Proprietário', administrator: 'Administrador', attendance: 'Atendente', technician: 'Técnico', inventory: 'Estoque', cashier: 'Caixa', finance: 'Financeiro', fiscal: 'Fiscal', read_only: 'Somente leitura' };

// ADM-01: `system_role_template_permissions` existia desde DB-01 mas nunca foi populada. Mapeia
// cada template para as permissions que já existem no momento em que esta função roda — por
// isso ela só pode ser chamada depois que TODOS os códigos de permission (os de domínio,
// inseridos mais abaixo neste arquivo, e os `users.*` da migration 0019) já foram inseridos.
// `owner` e `administrator` recebem o conjunto completo (nenhuma distinção funcional entre os
// dois nesta rodada — ambos contam como "papel administrativo" para a proteção da seção 10);
// `operational.context.select`, `companies.read` e `branches.read` vão para todo template, pois
// sem isso o usuário nunca conseguiria escolher Empresa/Filial no cabeçalho.
async function mapTemplatePermissions() {
  await db.execute(sql`insert into system_role_template_permissions (role_template_id,permission_id) select t.id,p.id from system_role_templates t, permissions p where t.code in ('owner','administrator') on conflict do nothing`);
  const byCode: Record<string, string[]> = {
    attendance: ['auth.session.read', 'operational.context.select', 'companies.read', 'branches.read', 'customers.read', 'customers.create', 'customers.update', 'customer_assets.read', 'customer_assets.create', 'customer_assets.update', 'service_orders.read', 'service_orders.create', 'service_orders.update', 'quotes.read', 'quotes.create', 'quotes.update', 'sales.read', 'sales.create'],
    technician: ['auth.session.read', 'operational.context.select', 'companies.read', 'branches.read', 'customer_assets.read', 'service_orders.read', 'service_orders.update', 'inventory.read'],
    inventory: ['auth.session.read', 'operational.context.select', 'companies.read', 'branches.read', 'inventory.read', 'inventory.create', 'inventory.update', 'inventory.move', 'suppliers.read', 'purchase_receipts.read', 'purchase_receipts.update', 'purchase_receipts.confirm', 'purchase_returns.read', 'purchase_returns.create', 'purchase_returns.update', 'purchase_returns.confirm'],
    // FIN-01: `cashier` é literalmente o papel operacional do fluxo de caixa — abre/fecha caixa e
    // recebe pagamentos no dia a dia. `finance` fica com `cash.manage` (configurar caixas é mais
    // administrativo que operacional) e `payments.refund` (estorno tratado como ação de
    // supervisão, não algo que quem opera o caixa faz sozinho) — nenhum dos dois ganha a
    // permission do outro por coincidência, os dois mapas são explícitos (seção 12 do correio.md).
    cashier: ['auth.session.read', 'operational.context.select', 'companies.read', 'branches.read', 'customers.read', 'sales.read', 'sales.create', 'sales.update', 'sales.confirm', 'cash.read', 'cash.open', 'cash.close', 'payments.read', 'payments.create'],
    finance: ['auth.session.read', 'operational.context.select', 'companies.read', 'branches.read', 'suppliers.read', 'suppliers.update', 'purchase_orders.read', 'purchase_orders.create', 'purchase_orders.update', 'purchase_orders.approve', 'purchase_receipts.read', 'sales.read', 'cash.read', 'cash.manage', 'payments.read', 'payments.refund'],
    fiscal: ['auth.session.read', 'operational.context.select', 'companies.read', 'branches.read', 'customers.read', 'purchase_orders.read', 'purchase_receipts.read', 'sales.read'],
  };
  for (const [code, codes] of Object.entries(byCode)) {
    // `sql.join` monta um `IN (...)` explícito — o `sql` tag do drizzle não serializa um array JS
    // puro como parâmetro (mesmo problema encontrado em apps/api/src/users/routes.ts).
    await db.execute(sql`insert into system_role_template_permissions (role_template_id,permission_id) select t.id,p.id from system_role_templates t, permissions p where t.code=${code} and p.code in (${sql.join(codes.map((c) => sql`${c}`), sql`,`)}) on conflict do nothing`);
  }
  // ADM-03: `audit.read` termina em `.read`, então a regra genérica acima concederia essa
  // permission a `read_only` automaticamente por coincidência de sufixo — exatamente o que a
  // seção 3 do correio.md pede para NÃO fazer ("não conceder automaticamente a papéis
  // operacionais sem justificativa"). Ver auditoria de ações de outros usuários é uma
  // capacidade administrativa, não uma leitura operacional comum; excluída explicitamente.
  await db.execute(sql`insert into system_role_template_permissions (role_template_id,permission_id) select t.id,p.id from system_role_templates t, permissions p where t.code='read_only' and ((p.code like '%.read' and p.code<>'audit.read') or p.code='operational.context.select') on conflict do nothing`);
}

// ADM-01: instancia, para o tenant dado, um `tenant_roles` por `system_role_template` ativo
// (nome em pt-BR) e copia as permissions já mapeadas em `system_role_template_permissions`
// (migration 0019) para `tenant_role_permissions` — idempotente (não recria o que já existe).
// Precisa rodar aqui, depois que o tenant já existe: migrations rodam antes de qualquer tenant
// existir, então esta provisão não pode morar numa migration (ver comentário na 0019). Uma
// futura rotina de criação de tenant pela API deve chamar o equivalente desta função.
async function provisionRoleTemplates(tenantId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    const templateRows = await tx.execute<{ id: string; code: string; name: string; scope_type: string; inherits_descendants: boolean }>(sql`select id,code,name,scope_type,inherits_descendants from system_role_templates where is_active`);
    for (const template of templateRows) {
      const existing = await tx.execute<{ id: string }>(sql`select id from tenant_roles where tenant_id=${tenantId} and code=${template.code}`);
      if (existing.length > 0) continue;
      const [role] = await tx.execute<{ id: string }>(sql`insert into tenant_roles (tenant_id,system_role_template_id,code,name,scope_type,inherits_descendants,is_system_managed,status)
        values (${tenantId},${template.id},${template.code},${roleTemplateNames[template.code] ?? template.name},${template.scope_type},${template.inherits_descendants},true,'active') returning id`);
      await tx.execute(sql`insert into tenant_role_permissions (tenant_id,role_id,permission_id)
        select ${tenantId},${role!.id},stp.permission_id from system_role_template_permissions stp where stp.role_template_id=${template.id} on conflict do nothing`);
    }
  });
}
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
  const permissionCodes =['auth.session.read','operational.context.select','companies.read','companies.create','companies.update','branches.read','branches.create','branches.update','customers.read','customers.create','customers.update','customer_assets.read','customer_assets.create','customer_assets.update','service_orders.read','service_orders.create','service_orders.update','quotes.read','quotes.create','quotes.update','inventory.read','inventory.create','inventory.update','inventory.move','suppliers.read','suppliers.create','suppliers.update','purchase_orders.read','purchase_orders.create','purchase_orders.update','purchase_orders.approve','purchase_receipts.read','purchase_receipts.create','purchase_receipts.update','purchase_receipts.confirm','purchase_returns.read','purchase_returns.create','purchase_returns.update','purchase_returns.confirm','sales.read','sales.create','sales.update','sales.confirm'];
  const permissionIds = [dev.permissionSessionRead,'01992ea1-1250-7000-8000-000000000033','01992ea1-1250-7000-8000-000000000034','01992ea1-1250-7000-8000-000000000035','01992ea1-1250-7000-8000-000000000036','01992ea1-1250-7000-8000-000000000037','01992ea1-1250-7000-8000-000000000038','01992ea1-1250-7000-8000-000000000039','01992ea1-1250-7000-8000-000000000040','01992ea1-1250-7000-8000-000000000041','01992ea1-1250-7000-8000-000000000042','01992ea1-1250-7000-8000-000000000043','01992ea1-1250-7000-8000-000000000044','01992ea1-1250-7000-8000-000000000045','01992ea1-1250-7000-8000-000000000046','01992ea1-1250-7000-8000-000000000047','01992ea1-1250-7000-8000-000000000048','01992ea1-1250-7000-8000-000000000049','01992ea1-1250-7000-8000-00000000004a','01992ea1-1250-7000-8000-00000000004b','01992ea1-1250-7000-8000-00000000004c','01992ea1-1250-7000-8000-00000000004d','01992ea1-1250-7000-8000-00000000004e','01992ea1-1250-7000-8000-00000000004f','01992ea1-1250-7000-8000-000000000050','01992ea1-1250-7000-8000-000000000051','01992ea1-1250-7000-8000-000000000052','01992ea1-1250-7000-8000-000000000053','01992ea1-1250-7000-8000-000000000054','01992ea1-1250-7000-8000-000000000055','01992ea1-1250-7000-8000-000000000056','01992ea1-1250-7000-8000-000000000057','01992ea1-1250-7000-8000-000000000058','01992ea1-1250-7000-8000-000000000059','01992ea1-1250-7000-8000-00000000005a','01992ea1-1250-7000-8000-00000000005b','01992ea1-1250-7000-8000-00000000005c','01992ea1-1250-7000-8000-00000000005d','01992ea1-1250-7000-8000-00000000005e','01992ea1-1250-7000-8000-00000000005f','01992ea1-1250-7000-8000-000000000060','01992ea1-1250-7000-8000-000000000061','01992ea1-1250-7000-8000-000000000062'];
  for (const [position, code] of permissionCodes.entries()) await db.execute(sql`insert into permissions (id,code,module,description) values (${permissionIds[position]!},${code},${code.split('.')[0]!},${code}) on conflict (id) do nothing`);
  // ADM-01: `users.*` são inseridas pela migration 0019 (junto com o provisionamento de
  // tenant_roles reais a partir dos templates); os papéis "dev_*" abaixo também recebem essas 4
  // permissions para continuar com acesso completo, sem duplicar a definição das permissions aqui.
  const usersPermissionIds = (await db.execute<{ id: string }>(sql`select id from permissions where module='users' order by code`)).map((row) => row.id);
  // ADM-03: `audit.read` é inserida pela migration 0021 (mesmo padrão de `users.*` no ADM-01).
  const auditPermissionIds = (await db.execute<{ id: string }>(sql`select id from permissions where module='audit' order by code`)).map((row) => row.id);
  // FIN-01: `cash.*`/`payments.*` são inseridas pela migration 0022 (mesmo padrão).
  const finPermissionIds = (await db.execute<{ id: string }>(sql`select id from permissions where module in ('cash','payments') order by code`)).map((row) => row.id);
  await mapTemplatePermissions();
  await provisionRoleTemplates(dev.tenantAlpha);
  await provisionRoleTemplates(dev.tenantBeta);
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
    for (const permissionId of [...permissionIds, ...usersPermissionIds, ...auditPermissionIds, ...finPermissionIds]) await tx.execute(sql`insert into tenant_role_permissions (tenant_id,role_id,permission_id) values (${dev.tenantAlpha},${dev.roleSingle},${permissionId}) on conflict do nothing`);
    await tx.execute(sql`insert into access_grants (id,tenant_id,user_profile_id,role_id,scope_type) values (${dev.grantSingle},${dev.tenantAlpha},${dev.profileSingle},${dev.roleSingle},'tenant') on conflict (id) do nothing`);
    await tx.execute(sql`insert into companies (id,tenant_id,legal_name,trade_name,tax_id_type,tax_id_normalized) values (${dev.companyAlphaServices},${dev.tenantAlpha},'Company Alpha Serviços','Alpha Serviços','cnpj','01992ea1125071') on conflict (id) do nothing`);
    await tx.execute(sql`insert into branches (id,tenant_id,company_id,code,name) values (${dev.branchAlphaNorth},${dev.tenantAlpha},${dev.companyAlpha},'NORTH','Branch Alpha Norte'),(${dev.branchAlphaServices},${dev.tenantAlpha},${dev.companyAlphaServices},'SERVICES','Branch Alpha Serviços 01') on conflict (id) do nothing`);
  });
  if (fakerEnabled) await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${dev.tenantAlpha}, true)`);
    await tx.execute(sql`insert into tenant_memberships (id,tenant_id,identity_id,status) values (${dev.membershipFaker},${dev.tenantAlpha},${dev.identityFaker},'active') on conflict (id) do nothing`);
    await tx.execute(sql`insert into tenant_user_profiles (id,tenant_id,membership_id,name) values (${dev.profileFaker},${dev.tenantAlpha},${dev.membershipFaker},'Anderson Brasil (faker)') on conflict (id) do nothing`);
    // ADM-01: antes daqui o faker recebia um papel "god mode" só de desenvolvimento
    // (`dev_faker_all`, com todas as permissions); agora que existe o papel real
    // 'administrator' com a MESMA cobertura (provisionado pela migration 0019 + seed acima),
    // ele fica só com 'administrator' — ter os dois causava um empate real no `ORDER BY
    // created_at` de `GET /users` (dois access_grants ativos com o mesmo `now()` de transação),
    // fazendo a coluna "Papel" mostrar ora um nome técnico de desenvolvimento, ora o correto. Um
    // único papel, sem ambiguidade, e o login de E2E usado desde UX-03 (fixtures.ts) já é, de
    // fato, o administrador do tenant Alpha — o que os testes de "último administrador" desta
    // rodada precisam para exercitar a proteção.
    const [administratorRole] = await tx.execute<{ id: string }>(sql`select id from tenant_roles where tenant_id=${dev.tenantAlpha} and code='administrator'`);
    if (administratorRole) await tx.execute(sql`insert into access_grants (id,tenant_id,user_profile_id,role_id,scope_type) values (${dev.grantFaker},${dev.tenantAlpha},${dev.profileFaker},${administratorRole.id},'tenant') on conflict (id) do nothing`);
  });
  for (const sample of [
    { tenant: dev.tenantAlpha, customer: '01992ea1-1250-7000-8000-000000000050', type: 'individual', name: 'Cliente Alpha PF', docType: 'cpf', doc: '52998224725', company: dev.companyAlpha },
    { tenant: dev.tenantAlpha, customer: '01992ea1-1250-7000-8000-000000000051', type: 'company', name: 'Cliente Alpha PJ', docType: 'cnpj', doc: '11222333000181', company: dev.companyAlpha },
    { tenant: dev.tenantBeta, customer: '01992ea1-1250-7000-8000-000000000052', type: 'individual', name: 'Cliente Beta PF', docType: 'cpf', doc: '39053344705', company: dev.companyBeta },
  ]) await db.transaction(async (tx) => { await tx.execute(sql`select set_config('app.tenant_id',${sample.tenant},true)`); const existing=await tx.execute(sql`select id from customers where id=${sample.customer} or (tenant_id=${sample.tenant} and document_type=${sample.docType} and document_normalized=${sample.doc})`); if(existing.length)return; const [counter]=await tx.execute<{last_number:number}>(sql`insert into customer_number_counters(tenant_id,last_number) values(${sample.tenant},1) on conflict(tenant_id) do update set last_number=customer_number_counters.last_number+1,updated_at=now() returning last_number`); await tx.execute(sql`insert into customers(id,tenant_id,customer_number,person_type,legal_name,document_type,document_normalized,origin_company_id) values(${sample.customer},${sample.tenant},${counter!.last_number},${sample.type},${sample.name},${sample.docType},${sample.doc},${sample.company})`); });
} finally { await client.end(); }
