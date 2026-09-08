import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

export async function createTestIdentity(admin: Sql, tenantIds: string[], prefix: string) {
  const identityId = randomUUID();
  const email = `${prefix}-${identityId}@vetoros.local`;
  const [source] = await admin<{ password_hash: string }[]>`select password_hash from identities where email_normalized='single@vetoros.local'`;
  await admin`insert into identities(id,email_normalized,password_hash,display_name,status) values(${identityId},${email},${source!.password_hash},${prefix},'active')`;
  const memberships: Array<{ tenantId: string; membershipId: string; profileId: string }> = [];
  for (const tenantId of tenantIds) {
    const membershipId = randomUUID(), profileId = randomUUID();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.tenant_id',${tenantId},true)`;
      await tx`insert into tenant_memberships(id,tenant_id,identity_id,status) values(${membershipId},${tenantId},${identityId},'active')`;
      await tx`insert into tenant_user_profiles(id,tenant_id,membership_id,name) values(${profileId},${tenantId},${membershipId},${prefix})`;
    });
    memberships.push({ tenantId, membershipId, profileId });
  }
  return { identityId, email, memberships };
}
