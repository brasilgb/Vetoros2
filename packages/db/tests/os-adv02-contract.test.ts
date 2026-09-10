import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(new URL('../migrations/0033_os_adv02_operational_flow.sql', import.meta.url), 'utf8');

describe('OS-ADV-02 database contract', () => {
  it('validates every status transition through a single trigger, terminal states included', () => {
    expect(migration).toContain('create trigger service_orders_status_transition before update on service_orders');
    expect(migration).toContain("when (new.status is distinct from old.status)");
    expect(migration).toContain("(old.status='delivered' and new.status='canceled')");
    // delivered/canceled só podem ir para 'canceled' (delivered) ou lugar nenhum (canceled) —
    // nenhuma outra combinação com old.status='delivered' e nenhuma com old.status='canceled'.
    expect(migration).not.toContain("old.status='canceled'");
  });

  it('records status history automatically for any write path, actor and reason included', () => {
    expect(migration).toContain('create trigger service_orders_status_history_record after update on service_orders');
    expect(migration).toContain('insert into service_order_status_history(tenant_id,service_order_id,previous_status,new_status,reason,changed_by_identity_id)');
    expect(migration).toContain("current_setting('app.service_order_status_reason',true)");
    expect(migration).toContain("current_setting('app.actor_identity_id',true)");
  });

  it('adds a dedicated service_orders.cancel permission, same pattern as sales.cancel/schedules.cancel', () => {
    expect(migration).toContain("'service_orders.cancel'");
    expect(migration).toContain('on conflict (code) do nothing');
  });
});
