import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(import.meta.dirname, '../migrations/0006_customer_assets.sql'), 'utf8').toLowerCase();

describe('CRM-02 customer assets database contract', () => {
  it('keeps customer and identifiers tenant-safe', () => {
    expect(migration).toContain('foreign key (tenant_id,customer_id) references customers(tenant_id,id)');
    expect(migration).toContain('foreign key (tenant_id,asset_id) references customer_assets(tenant_id,id)');
    expect(migration).toContain('unique (tenant_id,internal_identifier)');
    expect(migration).toContain('unique (tenant_id,identifier_type,value_normalized)');
  });

  it('fails closed through forced RLS and does not grant delete', () => {
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('force row level security');
    expect(migration).toContain('with check (tenant_id=vetoros_current_tenant_id())');
    expect(migration).not.toContain('grant delete');
  });

  it('keeps equipment lifecycle separate from service-order lifecycle', () => {
    expect(migration).toContain("check (status in ('active','inactive','retired'))");
    expect(migration).not.toContain('aguardando orçamento');
  });
});
