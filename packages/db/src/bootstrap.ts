import argon2 from 'argon2';
import postgres from 'postgres';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

if (process.env.NODE_ENV !== 'production') throw new Error('db:bootstrap requires NODE_ENV=production');
if (process.env.BOOTSTRAP_CONFIRM !== 'I_UNDERSTAND') throw new Error('BOOTSTRAP_CONFIRM must be I_UNDERSTAND');

const databaseUrl = required('MIGRATION_DATABASE_URL');
const tenantSlug = required('BOOTSTRAP_TENANT_SLUG').toLowerCase();
const tenantName = required('BOOTSTRAP_TENANT_NAME');
const adminEmail = required('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
const adminPassword = required('BOOTSTRAP_ADMIN_PASSWORD');
const adminName = required('BOOTSTRAP_ADMIN_NAME');
const companyTaxId = required('BOOTSTRAP_COMPANY_TAX_ID').replace(/\D/g, '');
const companyName = process.env.BOOTSTRAP_COMPANY_NAME?.trim() || tenantName;
const branchName = process.env.BOOTSTRAP_BRANCH_NAME?.trim() || 'Matriz';

if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(tenantSlug)) throw new Error('BOOTSTRAP_TENANT_SLUG must be a DNS-safe slug');
if (!adminEmail.includes('@') || adminPassword.length < 12) throw new Error('BOOTSTRAP_ADMIN_EMAIL or BOOTSTRAP_ADMIN_PASSWORD is invalid');
if (companyTaxId.length !== 11 && companyTaxId.length !== 14) throw new Error('BOOTSTRAP_COMPANY_TAX_ID must contain 11 or 14 digits');

const sql = postgres(databaseUrl, { max: 1 });
try {
  const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
  await sql.begin(async (tx) => {
    const existing = await tx`select id from tenants limit 1`;
    if (existing.length > 0) throw new Error('bootstrap refused: a tenant already exists');

    const [tenant] = await tx`insert into tenants (slug,legal_name,trade_name,status) values (${tenantSlug},${tenantName},${tenantName},'active') returning id`;
    if (!tenant) throw new Error('bootstrap failed: tenant was not created');
    const [identity] = await tx`insert into identities (email_normalized,password_hash,display_name,status) values (${adminEmail},${passwordHash},${adminName},'active') returning id`;
    if (!identity) throw new Error('bootstrap failed: administrator identity was not created');
    await tx`select set_config('app.tenant_id',${tenant.id},true)`;
    const [membership] = await tx`insert into tenant_memberships (tenant_id,identity_id,status,joined_at) values (${tenant.id},${identity.id},'active',now()) returning id`;
    if (!membership) throw new Error('bootstrap failed: membership was not created');
    const [profile] = await tx`insert into tenant_user_profiles (tenant_id,membership_id,name,status) values (${tenant.id},${membership.id},${adminName},'active') returning id`;
    if (!profile) throw new Error('bootstrap failed: administrator profile was not created');
    const [template] = await tx`select id,scope_type,inherits_descendants from system_role_templates where code='administrator' and is_active`;
    if (!template) throw new Error('bootstrap refused: administrator role template is missing; run migrations first');
    const [role] = await tx`insert into tenant_roles (tenant_id,system_role_template_id,code,name,scope_type,inherits_descendants,is_system_managed,status) values (${tenant.id},${template.id},'administrator','Administrador',${template.scope_type},${template.inherits_descendants},true,'active') returning id`;
    if (!role) throw new Error('bootstrap failed: administrator role was not created');
    await tx`insert into tenant_role_permissions (tenant_id,role_id,permission_id) select ${tenant.id},${role.id},id from permissions on conflict do nothing`;
    await tx`insert into access_grants (tenant_id,user_profile_id,role_id,scope_type) values (${tenant.id},${profile.id},${role.id},'tenant')`;
    const [company] = await tx`insert into companies (tenant_id,legal_name,trade_name,tax_id_type,tax_id_normalized) values (${tenant.id},${companyName},${companyName},${companyTaxId.length === 11 ? 'cpf' : 'cnpj'},${companyTaxId}) returning id`;
    if (!company) throw new Error('bootstrap failed: company was not created');
    await tx`insert into branches (tenant_id,company_id,code,name,is_default) values (${tenant.id},${company.id},'MAIN',${branchName},true)`;
    console.log(`Production bootstrap completed for tenant ${tenantSlug}; admin ${adminEmail}`);
  });
} finally {
  await sql.end();
}
