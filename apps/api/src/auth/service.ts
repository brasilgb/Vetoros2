import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { auditEvents, createDatabase, withTenantTransaction } from '@vetoros/db';

export type TenantOption = { tenantId: string; membershipId: string; userProfileId: string; name: string };
export type AuthSession = { id: string; identityId: string; activeTenantId: string | null; activeMembershipId: string | null; activeUserProfileId: string | null; activeCompanyId: string | null; activeBranchId: string | null; expiresAt: Date };
export type ResourceScope = { companyId?: string; branchId?: string; requireTenant?: boolean };
export type LoginResult = { token: string; session: AuthSession; tenants: TenantOption[] };

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const ipHash = (ip?: string) => ip ? createHash('sha256').update(ip).digest('hex') : null;
const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase('en-US');
const dummyHashPromise = argon2.hash('vetoros-invalid-credential-placeholder', { type: argon2.argon2id });

export class AuthService {
  private readonly auth: postgres.Sql;
  private readonly runtime;
  constructor(authUrl: string, runtimeUrl: string, private readonly ttlSeconds: number) {
    this.auth = postgres(authUrl, { max: 5 });
    this.runtime = createDatabase(runtimeUrl);
  }

  async close() { await Promise.all([this.auth.end(), this.runtime.client.end()]); }

  private async tenantOptions(identityId: string): Promise<TenantOption[]> {
    return this.auth.begin(async (tx) => {
      await tx`select set_config('app.actor_identity_id', ${identityId}, true)`;
      const rows = await tx<TenantOption[]>`select m.tenant_id as "tenantId", m.id as "membershipId", p.id as "userProfileId", coalesce(t.trade_name,t.legal_name) as name
        from tenant_memberships m join tenant_user_profiles p on p.tenant_id=m.tenant_id and p.membership_id=m.id join tenants t on t.id=m.tenant_id
        where m.identity_id=${identityId} and m.status='active' and (m.expires_at is null or m.expires_at > now()) and p.status='active' and t.status in ('trial','active') order by name`;
      return [...rows];
    }) as Promise<TenantOption[]>;
  }

  async login(email: string, password: string, metadata: { ip?: string; userAgent?: string }): Promise<LoginResult | null> {
    const [identity] = await this.auth<{ id: string; password_hash: string | null; status: string }[]>`select id,password_hash,status from identities where email_normalized=${normalizeEmail(email)} limit 1`;
    const hash = identity?.password_hash ?? await dummyHashPromise;
    const valid = await argon2.verify(hash, password).catch(() => false);
    if (!identity || !valid || identity.status !== 'active') return null;
    const token = randomBytes(32).toString('base64url');
    const tenants = await this.tenantOptions(identity.id);
    const selected = tenants.length === 1 ? tenants[0] : undefined;
    const [session] = await this.auth<AuthSession[]>`insert into auth_sessions (identity_id,token_hash,active_tenant_id,active_membership_id,active_user_profile_id,expires_at,ip_hash,user_agent)
      values (${identity.id},${tokenHash(token)},${selected?.tenantId ?? null},${selected?.membershipId ?? null},${selected?.userProfileId ?? null},now()+(${this.ttlSeconds} * interval '1 second'),${ipHash(metadata.ip)},${metadata.userAgent?.slice(0, 512) ?? null})
      returning id,identity_id as "identityId",active_tenant_id as "activeTenantId",active_membership_id as "activeMembershipId",active_user_profile_id as "activeUserProfileId",active_company_id as "activeCompanyId",active_branch_id as "activeBranchId",expires_at as "expiresAt"`;
    if (!session) throw new Error('Failed to create session');
    await this.auth`update identities set last_login_at=now(),updated_at=now() where id=${identity.id}`;
    if (selected) await this.audit(session, 'auth.login_succeeded');
    return { token, session, tenants };
  }

  async session(token?: string): Promise<AuthSession | null> {
    if (!token) return null;
    const [session] = await this.auth<AuthSession[]>`select id,identity_id as "identityId",active_tenant_id as "activeTenantId",active_membership_id as "activeMembershipId",active_user_profile_id as "activeUserProfileId",expires_at as "expiresAt"
      ,active_company_id as "activeCompanyId",active_branch_id as "activeBranchId" from auth_sessions where token_hash=${tokenHash(token)} and status='active' and revoked_at is null and expires_at>now() limit 1`;
    if (!session) return null;
    if (session.activeTenantId) {
      const stillAllowed = (await this.tenantOptions(session.identityId)).some((option) => option.tenantId === session.activeTenantId && option.membershipId === session.activeMembershipId && option.userProfileId === session.activeUserProfileId);
      if (!stillAllowed) { await this.auth`update auth_sessions set status='revoked',revoked_at=now() where id=${session.id}`; return null; }
    }
    await this.auth`update auth_sessions set last_seen_at=now() where id=${session.id}`;
    return session;
  }

  async tenants(session: AuthSession) { return this.tenantOptions(session.identityId); }

  async sessionProfile(session: AuthSession) {
    const [identity] = await this.auth<{ displayName: string }[]>`select display_name as "displayName" from identities where id=${session.identityId}`;
    if (!session.activeTenantId) return { identity, session, capabilities: [], companies: [], branches: [] };
    return this.withAuthenticatedTenant(session, async (tx) => {
      const capabilities = await tx.execute<{ code: string }>(sql`select distinct p.code from access_grants g join tenant_roles r on r.tenant_id=g.tenant_id and r.id=g.role_id join tenant_role_permissions rp on rp.tenant_id=r.tenant_id and rp.role_id=r.id join permissions p on p.id=rp.permission_id where g.user_profile_id=${session.activeUserProfileId!} and g.status='active' and r.status='active' and g.valid_from<=now() and (g.valid_until is null or g.valid_until>now())`);
      const companies = await tx.execute(sql`select distinct c.id,c.legal_name,c.trade_name from companies c join access_grants g on g.tenant_id=c.tenant_id and (g.scope_type='tenant' or g.company_id=c.id) where g.user_profile_id=${session.activeUserProfileId!} and g.status='active' and g.valid_from<=now() and (g.valid_until is null or g.valid_until>now()) and c.status='active' order by c.legal_name`);
      const branches = await tx.execute(sql`select distinct b.id,b.company_id,b.name,b.code from branches b join access_grants g on g.tenant_id=b.tenant_id and (g.scope_type='tenant' or (g.scope_type='company' and g.company_id=b.company_id) or (g.scope_type='branch' and g.branch_id=b.id)) where g.user_profile_id=${session.activeUserProfileId!} and g.status='active' and g.valid_from<=now() and (g.valid_until is null or g.valid_until>now()) and b.status='active' order by b.name`);
      return { identity, session, capabilities: capabilities.map(({ code }) => code), companies, branches };
    });
  }

  async selectTenant(session: AuthSession, tenantId: string): Promise<AuthSession | null> {
    const options = await this.tenantOptions(session.identityId);
    const selected = options.find((option) => option.tenantId === tenantId);
    if (!selected) return null;
    const [updated] = await this.auth<AuthSession[]>`update auth_sessions set active_tenant_id=${selected.tenantId},active_membership_id=${selected.membershipId},active_user_profile_id=${selected.userProfileId},last_seen_at=now()
      where id=${session.id} and identity_id=${session.identityId} and status='active' and expires_at>now()
      returning id,identity_id as "identityId",active_tenant_id as "activeTenantId",active_membership_id as "activeMembershipId",active_user_profile_id as "activeUserProfileId",active_company_id as "activeCompanyId",active_branch_id as "activeBranchId",expires_at as "expiresAt"`;
    if (updated) await this.audit(updated, session.activeTenantId ? 'auth.tenant_switched' : 'auth.tenant_selected');
    return updated ?? null;
  }

  async logout(session: AuthSession) {
    await this.auth`update auth_sessions set status='revoked',revoked_at=now() where id=${session.id} and status='active'`;
    if (session.activeTenantId && session.activeUserProfileId) await this.audit(session, 'auth.logout');
  }

  async withAuthenticatedTenant<T>(session: AuthSession, callback: Parameters<typeof withTenantTransaction<T>>[2]): Promise<T> {
    if (!session.activeTenantId || !session.activeUserProfileId) throw new Error('TENANT_REQUIRED');
    if (!await this.sessionIsOperationallyValid(session)) throw new Error('MEMBERSHIP_INACTIVE');
    return withTenantTransaction(this.runtime.db, { tenantId: session.activeTenantId, actorIdentityId: session.identityId, effectiveUserProfileId: session.activeUserProfileId }, callback);
  }

  async hasPermission(session: AuthSession, permission: string, scope: ResourceScope = {}): Promise<boolean> {
    try { return await this.withAuthenticatedTenant(session, async (tx) => {
      const result = await tx.execute(sql`select 1 from access_grants g join tenant_roles r on r.tenant_id=g.tenant_id and r.id=g.role_id
        join tenant_role_permissions rp on rp.tenant_id=r.tenant_id and rp.role_id=r.id join permissions p on p.id=rp.permission_id
        where g.user_profile_id=${session.activeUserProfileId!} and g.status='active' and r.status='active' and p.code=${permission}
          and g.valid_from<=now() and (g.valid_until is null or g.valid_until>now())
          and (${scope.requireTenant ?? false}=false or g.scope_type='tenant')
          and (${scope.companyId ?? null}::uuid is null or g.scope_type='tenant' or (g.scope_type='company' and g.company_id=${scope.companyId ?? null}) or (g.scope_type='branch' and g.company_id=${scope.companyId ?? null} and g.branch_id=${scope.branchId ?? null}))
          and (${scope.branchId ?? null}::uuid is null or g.scope_type='tenant' or (g.scope_type='company' and g.company_id=${scope.companyId ?? null}) or (g.scope_type='branch' and g.branch_id=${scope.branchId ?? null})) limit 1`);
      return result.length > 0;
    }); } catch (error) { if (error instanceof Error && error.message === 'MEMBERSHIP_INACTIVE') return false; throw error; }
  }

  private async sessionIsOperationallyValid(session: AuthSession) {
    if (!session.activeTenantId) return false;
    const [persisted] = await this.auth<{ activeTenantId: string | null; activeMembershipId: string | null; activeUserProfileId: string | null }[]>`select active_tenant_id as "activeTenantId",active_membership_id as "activeMembershipId",active_user_profile_id as "activeUserProfileId" from auth_sessions where id=${session.id} and identity_id=${session.identityId} and status='active' and expires_at>now()`;
    if (!persisted || persisted.activeTenantId !== session.activeTenantId || persisted.activeMembershipId !== session.activeMembershipId || persisted.activeUserProfileId !== session.activeUserProfileId) return false;
    return (await this.tenantOptions(session.identityId)).some((option) => option.tenantId === session.activeTenantId && option.membershipId === session.activeMembershipId && option.userProfileId === session.activeUserProfileId);
  }

  async auditResource(session: AuthSession, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown> = {}) {
    if (!session.activeTenantId || !session.activeUserProfileId) return;
    await withTenantTransaction(this.runtime.db, { tenantId: session.activeTenantId, actorIdentityId: session.identityId, effectiveUserProfileId: session.activeUserProfileId }, async (tx) => {
      await tx.insert(auditEvents).values({ tenantId: session.activeTenantId!, actorIdentityId: session.identityId, effectiveUserProfileId: session.activeUserProfileId, action, resourceType, resourceId, metadata });
    });
  }

  async selectOperationalContext(session: AuthSession, scope: ResourceScope): Promise<AuthSession | null> {
    if (!session.activeTenantId || !scope.companyId) return null;
    const allowed = await this.hasPermission(session, 'operational.context.select', scope);
    if (!allowed) return null;
    const valid = await this.withAuthenticatedTenant(session, async (tx) => {
      const rows = await tx.execute(sql`select c.id from companies c left join branches b on b.tenant_id=c.tenant_id and b.company_id=c.id and b.id=${scope.branchId ?? null}
        where c.id=${scope.companyId} and c.status='active' and (${scope.branchId ?? null}::uuid is null or (b.id is not null and b.status='active')) limit 1`);
      return rows.length > 0;
    });
    if (!valid) return null;
    const [updated] = await this.auth<AuthSession[]>`update auth_sessions set active_company_id=${scope.companyId},active_branch_id=${scope.branchId ?? null},last_seen_at=now() where id=${session.id} and status='active'
      returning id,identity_id as "identityId",active_tenant_id as "activeTenantId",active_membership_id as "activeMembershipId",active_user_profile_id as "activeUserProfileId",active_company_id as "activeCompanyId",active_branch_id as "activeBranchId",expires_at as "expiresAt"`;
    if (updated) await this.audit(updated, 'auth.operational_context_selected');
    return updated ?? null;
  }

  private async audit(session: AuthSession, action: string) {
    if (!session.activeTenantId || !session.activeUserProfileId) return;
    await withTenantTransaction(this.runtime.db, { tenantId: session.activeTenantId, actorIdentityId: session.identityId, effectiveUserProfileId: session.activeUserProfileId }, async (tx) => {
      await tx.insert(auditEvents).values({ tenantId: session.activeTenantId!, actorIdentityId: session.identityId, effectiveUserProfileId: session.activeUserProfileId, action, resourceType: 'auth_session', resourceId: session.id, metadata: {} });
    });
  }
}

export async function requirePermission(service: AuthService, session: AuthSession, permission: string, scope: ResourceScope = {}): Promise<void> {
  if (!await service.hasPermission(session, permission, scope)) throw new Error('FORBIDDEN');
}
