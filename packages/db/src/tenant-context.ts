import { sql } from 'drizzle-orm';
import type { Database, DatabaseTransaction } from './client.js';

export type TenantContext = {
  tenantId: string;
  actorIdentityId: string;
  effectiveUserProfileId?: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validateUuid = (name: string, value: string) => {
  if (!uuidPattern.test(value)) throw new TypeError(`${name} must be a valid UUID`);
};

export async function withTenantTransaction<T>(db: Database, context: TenantContext, callback: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  validateUuid('tenantId', context.tenantId);
  validateUuid('actorIdentityId', context.actorIdentityId);
  if (context.effectiveUserProfileId) validateUuid('effectiveUserProfileId', context.effectiveUserProfileId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${context.tenantId}, true)`);
    await tx.execute(sql`select set_config('app.actor_identity_id', ${context.actorIdentityId}, true)`);
    await tx.execute(sql`select set_config('app.effective_user_profile_id', ${context.effectiveUserProfileId ?? ''}, true)`);
    return callback(tx);
  });
}
