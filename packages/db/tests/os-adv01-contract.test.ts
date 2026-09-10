import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(new URL('../migrations/0032_os_adv01_service_order_warranty.sql', import.meta.url), 'utf8');

describe('OS-ADV-01 database contract', () => {
  it('declares operational and warranty fields with controlled vocabularies', () => {
    for (const field of ['priority', 'technician_user_profile_id', 'diagnosis', 'executed_solution', 'started_at', 'delivered_at', 'warranty_enabled', 'warranty_ends_at', 'original_service_order_id', 'service_order_kind']) expect(migration).toContain(field);
    expect(migration).toContain("service_order_kind in ('standard','warranty_return')");
    expect(migration).toContain("warranty_snapshot_status is null or warranty_snapshot_status in ('within_warranty','expired','not_applicable')");
  });

  it('enforces same-tenant return references and deterministic indexes', () => {
    expect(migration).toContain('foreign key (tenant_id,technician_user_profile_id) references tenant_user_profiles(tenant_id,id)');
    expect(migration).toContain('foreign key (tenant_id,original_service_order_id) references service_orders(tenant_id,id)');
    expect(migration).toContain('foreign key (tenant_id,previous_service_order_id) references service_orders(tenant_id,id)');
    expect(migration).toContain('service_orders_original_idx');
  });

  it('protects status history with forced RLS and runtime append-only grants', () => {
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('force row level security');
    expect(migration).toContain('grant select,insert on service_order_status_history to vetoros_runtime');
    expect(migration).toContain('create trigger service_order_status_history_append_only');
    expect(migration).toContain('reject_service_order_status_history_mutation');
    expect(migration).toContain('revoke update,delete on service_order_status_history from vetoros_runtime');
  });
});
