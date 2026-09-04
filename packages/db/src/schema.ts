import { sql } from 'drizzle-orm';
import {
  bigint, boolean, char, check, index, jsonb, pgTable, primaryKey, text, timestamp, unique,
  uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export const identities = pgTable('identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  emailNormalized: text('email_normalized').notNull(),
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  status: text('status').notNull().default('pending'),
  mfaRequired: boolean('mfa_required').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...timestamps,
}, (t) => [uniqueIndex('identities_email_uq').on(t.emailNormalized), check('identities_status_ck', sql`${t.status} in ('active','blocked','pending')`)]);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(), slug: text('slug').notNull(), legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'), status: text('status').notNull().default('trial'), defaultLocale: text('default_locale').notNull().default('pt-BR'), ...timestamps,
}, (t) => [uniqueIndex('tenants_slug_uq').on(t.slug), check('tenants_status_ck', sql`${t.status} in ('trial','active','suspended','cancelled')`)]);

export const tenantMemberships = pgTable('tenant_memberships', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  identityId: uuid('identity_id').notNull().references(() => identities.id), status: text('status').notNull().default('active'),
  joinedAt: timestamp('joined_at', { withTimezone: true }), expiresAt: timestamp('expires_at', { withTimezone: true }), ...timestamps,
}, (t) => [unique('tenant_memberships_tenant_id_id_uq').on(t.tenantId, t.id), unique('tenant_memberships_tenant_identity_uq').on(t.tenantId, t.identityId), check('tenant_memberships_status_ck', sql`${t.status} in ('invited','active','suspended','revoked')`)]);

export const tenantUserProfiles = pgTable('tenant_user_profiles', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), membershipId: uuid('membership_id').notNull(),
  name: text('name').notNull(), phone: text('phone'), employeeCode: text('employee_code'), status: text('status').notNull().default('active'), ...timestamps,
}, (t) => [unique('tenant_user_profiles_tenant_id_id_uq').on(t.tenantId, t.id), unique('tenant_user_profiles_membership_uq').on(t.tenantId, t.membershipId), check('tenant_user_profiles_status_ck', sql`${t.status} in ('active','inactive')`)]);

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id), legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'), taxIdType: text('tax_id_type').notNull(), taxIdNormalized: text('tax_id_normalized').notNull(),
  stateRegistration: text('state_registration'), municipalRegistration: text('municipal_registration'), taxRegime: text('tax_regime'),
  currencyCode: char('currency_code', { length: 3 }).notNull().default('BRL'), status: text('status').notNull().default('active'), ...timestamps,
}, (t) => [unique('companies_tenant_id_id_uq').on(t.tenantId, t.id), unique('companies_tax_id_uq').on(t.tenantId, t.taxIdType, t.taxIdNormalized), check('companies_status_ck', sql`${t.status} in ('active','inactive')`)]);

export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), companyId: uuid('company_id').notNull(),
  code: text('code').notNull(), name: text('name').notNull(), timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  status: text('status').notNull().default('active'), isDefault: boolean('is_default').notNull().default(false), ...timestamps,
}, (t) => [unique('branches_tenant_company_id_uq').on(t.tenantId, t.companyId, t.id), unique('branches_code_uq').on(t.tenantId, t.companyId, t.code), check('branches_status_ck', sql`${t.status} in ('active','inactive')`)]);

export const customerNumberCounters = pgTable('customer_number_counters', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  lastNumber: bigint('last_number', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  customerNumber: bigint('customer_number', { mode: 'number' }).notNull(), personType: text('person_type').notNull(),
  legalName: text('legal_name').notNull(), tradeName: text('trade_name'), documentType: text('document_type'), documentNormalized: text('document_normalized'),
  rgStateRegistration: text('rg_state_registration'), municipalRegistration: text('municipal_registration'), phone: text('phone'), mobile: text('mobile'), whatsapp: text('whatsapp'), email: text('email'), notes: text('notes'),
  status: text('status').notNull().default('active'), originCompanyId: uuid('origin_company_id'), originBranchId: uuid('origin_branch_id'),
  createdByIdentityId: uuid('created_by_identity_id').references(() => identities.id), updatedByIdentityId: uuid('updated_by_identity_id').references(() => identities.id), ...timestamps,
}, (t) => [unique('customers_tenant_id_id_uq').on(t.tenantId, t.id), unique('customers_number_uq').on(t.tenantId, t.customerNumber), uniqueIndex('customers_document_uq').on(t.tenantId, t.documentType, t.documentNormalized)]);
export const customerAddresses = pgTable('customer_addresses', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), customerId: uuid('customer_id').notNull(),
  addressType: text('address_type').notNull().default('main'), postalCode: text('postal_code'), street: text('street').notNull(), number: text('number'), complement: text('complement'),
  district: text('district'), city: text('city').notNull(), state: char('state', { length: 2 }), country: char('country', { length: 2 }).notNull().default('BR'), isPrimary: boolean('is_primary').notNull().default(true), ...timestamps,
}, (t) => [unique('customer_addresses_tenant_id_id_uq').on(t.tenantId, t.id), index('customer_addresses_customer_idx').on(t.tenantId, t.customerId)]);
export const customerContacts = pgTable('customer_contacts', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), customerId: uuid('customer_id').notNull(), contactType: text('contact_type').notNull(), label: text('label'), value: text('value').notNull(), valueNormalized: text('value_normalized').notNull(), isPrimary: boolean('is_primary').notNull().default(false), ...timestamps,
}, (t) => [unique('customer_contacts_tenant_id_id_uq').on(t.tenantId, t.id), index('customer_contacts_customer_idx').on(t.tenantId, t.customerId)]);
export const customerAssets = pgTable('customer_assets', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), customerId: uuid('customer_id').notNull(), internalIdentifier: text('internal_identifier').notNull(), category: text('category').notNull(), brand: text('brand'), model: text('model'), serialNumber: text('serial_number'), imei: text('imei'), assetTag: text('asset_tag'), description: text('description'), notes: text('notes'), status: text('status').notNull().default('active'), originCompanyId: uuid('origin_company_id'), originBranchId: uuid('origin_branch_id'), createdByIdentityId: uuid('created_by_identity_id'), updatedByIdentityId: uuid('updated_by_identity_id'), ...timestamps,
}, (t) => [unique('customer_assets_tenant_id_id_uq').on(t.tenantId,t.id), unique('customer_assets_identifier_uq').on(t.tenantId,t.internalIdentifier), index('customer_assets_customer_idx').on(t.tenantId,t.customerId)]);
export const customerAssetIdentifiers = pgTable('customer_asset_identifiers', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), assetId: uuid('asset_id').notNull(), identifierType: text('identifier_type').notNull(), value: text('value').notNull(), valueNormalized: text('value_normalized').notNull(), ...timestamps,
}, (t) => [unique('customer_asset_identifiers_tenant_id_id_uq').on(t.tenantId,t.id), unique('customer_asset_identifiers_uq').on(t.tenantId,t.identifierType,t.valueNormalized), index('customer_asset_identifiers_asset_idx').on(t.tenantId,t.assetId)]);

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(), code: text('code').notNull().unique(), module: text('module').notNull(), description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const systemRoleTemplates = pgTable('system_role_templates', {
  id: uuid('id').primaryKey().defaultRandom(), code: text('code').notNull().unique(), name: text('name').notNull(), scopeType: text('scope_type').notNull(),
  inheritsDescendants: boolean('inherits_descendants').notNull().default(false), isActive: boolean('is_active').notNull().default(true), ...timestamps,
}, (t) => [check('system_role_templates_scope_ck', sql`${t.scopeType} in ('tenant','company','branch')`)]);
export const systemRoleTemplatePermissions = pgTable('system_role_template_permissions', {
  roleTemplateId: uuid('role_template_id').notNull().references(() => systemRoleTemplates.id), permissionId: uuid('permission_id').notNull().references(() => permissions.id),
}, (t) => [primaryKey({ columns: [t.roleTemplateId, t.permissionId] })]);
export const tenantRoles = pgTable('tenant_roles', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id), systemRoleTemplateId: uuid('system_role_template_id').references(() => systemRoleTemplates.id),
  code: text('code').notNull(), name: text('name').notNull(), scopeType: text('scope_type').notNull(), inheritsDescendants: boolean('inherits_descendants').notNull().default(false),
  isSystemManaged: boolean('is_system_managed').notNull().default(false), status: text('status').notNull().default('active'), ...timestamps,
}, (t) => [unique('tenant_roles_tenant_id_id_uq').on(t.tenantId, t.id), unique('tenant_roles_code_uq').on(t.tenantId, t.code), check('tenant_roles_scope_ck', sql`${t.scopeType} in ('tenant','company','branch')`), check('tenant_roles_status_ck', sql`${t.status} in ('active','inactive')`)]);
export const tenantRolePermissions = pgTable('tenant_role_permissions', {
  tenantId: uuid('tenant_id').notNull(), roleId: uuid('role_id').notNull(), permissionId: uuid('permission_id').notNull().references(() => permissions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.roleId, t.permissionId] })]);
export const accessGrants = pgTable('access_grants', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), userProfileId: uuid('user_profile_id').notNull(), roleId: uuid('role_id').notNull(),
  scopeType: text('scope_type').notNull(), companyId: uuid('company_id'), branchId: uuid('branch_id'), validFrom: timestamp('valid_from', { withTimezone: true }).defaultNow().notNull(),
  validUntil: timestamp('valid_until', { withTimezone: true }), status: text('status').notNull().default('active'), grantedByUserProfileId: uuid('granted_by_user_profile_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique('access_grants_tenant_id_id_uq').on(t.tenantId, t.id), index('access_grants_profile_idx').on(t.tenantId, t.userProfileId), check('access_grants_scope_ck', sql`(${t.scopeType} = 'tenant' and ${t.companyId} is null and ${t.branchId} is null) or (${t.scopeType} = 'company' and ${t.companyId} is not null and ${t.branchId} is null) or (${t.scopeType} = 'branch' and ${t.companyId} is not null and ${t.branchId} is not null)`)]);
export const branchMemberships = pgTable('branch_memberships', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), companyId: uuid('company_id').notNull(), branchId: uuid('branch_id').notNull(),
  userProfileId: uuid('user_profile_id').notNull(), jobType: text('job_type'), startsAt: timestamp('starts_at', { withTimezone: true }).defaultNow().notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }), status: text('status').notNull().default('active'), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique('branch_memberships_tenant_id_id_uq').on(t.tenantId, t.id)]);
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), actorIdentityId: uuid('actor_identity_id').references(() => identities.id),
  effectiveUserProfileId: uuid('effective_user_profile_id'), action: text('action').notNull(), resourceType: text('resource_type').notNull(), resourceId: uuid('resource_id'),
  metadata: jsonb('metadata').notNull().default({}), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique('audit_events_tenant_id_id_uq').on(t.tenantId, t.id), index('audit_events_tenant_created_idx').on(t.tenantId, t.createdAt)]);

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(), identityId: uuid('identity_id').notNull().references(() => identities.id), tokenHash: text('token_hash').notNull().unique(),
  activeTenantId: uuid('active_tenant_id'), activeMembershipId: uuid('active_membership_id'), activeUserProfileId: uuid('active_user_profile_id'),
  activeCompanyId: uuid('active_company_id'), activeBranchId: uuid('active_branch_id'),
  status: text('status').notNull().default('active'), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(), ipHash: text('ip_hash'), userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('auth_sessions_identity_status_idx').on(t.identityId, t.status, t.expiresAt), check('auth_sessions_status_ck', sql`${t.status} in ('active','revoked')`)]);
