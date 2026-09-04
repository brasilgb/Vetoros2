import { describe, expect, it, vi } from 'vitest';
import { withTenantTransaction } from '../src/tenant-context.js';
import type { Database } from '../src/client.js';

const tenantId = '01992ea1-1250-7000-8000-000000000001';
const actorIdentityId = '01992ea1-1250-7000-8000-000000000002';

describe('withTenantTransaction', () => {
  it('rejects malformed context before opening a transaction', async () => {
    const transaction = vi.fn();
    await expect(withTenantTransaction({ transaction } as unknown as Database, { tenantId: 'invalid', actorIdentityId }, vi.fn())).rejects.toThrow('tenantId');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('sets all context locally inside one transaction', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const callback = vi.fn().mockResolvedValue('result');
    const transaction = vi.fn(async (handler: (tx: unknown) => Promise<unknown>) => handler({ execute }));
    const result = await withTenantTransaction({ transaction } as unknown as Database, { tenantId, actorIdentityId }, callback);
    expect(result).toBe('result');
    expect(execute).toHaveBeenCalledTimes(3);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('propagates callback errors so the driver rolls the transaction back', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async (handler: (tx: unknown) => Promise<unknown>) => handler({ execute }));
    await expect(withTenantTransaction({ transaction } as unknown as Database, { tenantId, actorIdentityId }, async () => { throw new Error('rollback'); })).rejects.toThrow('rollback');
  });
});
