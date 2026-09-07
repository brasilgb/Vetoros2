import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
const m = await readFile(new URL('../migrations/0023_fin02_receivables.sql', import.meta.url), 'utf8');

// FIN-02 — mesmo estilo dos demais "-contract.test.ts" (ver fin01-cash-contract.test.ts): checagem
// estática do texto da migration. O comportamento vivo (funções plpgsql executando de verdade,
// concorrência, idempotência, cascata de cancelamento) é coberto pela suíte de integração da API
// (`apps/api/tests/receivables.integration.test.ts`), que roda contra um Postgres real.
describe('FIN-02 database contract', () => {
  it('models a receivable as exactly one installment row, requiring exactly one origin (never zero, unlike payments)', () => {
    expect(m).toContain('create table receivables');
    expect(m).toContain("check ((sale_id is not null)::int + (service_order_id is not null)::int = 1)");
    expect(m).not.toMatch(/entity_type\s+(text|uuid)/);
  });

  it('never allows more than one generation batch per origin: a partial unique index per origin+installment_number', () => {
    expect(m).toContain('unique (tenant_id,sale_id,installment_number), unique (tenant_id,service_order_id,installment_number)');
  });

  it('uses numeric for every monetary column and date (not timestamptz) for due_date', () => {
    expect(m).not.toMatch(/\b(float\d*|double precision)\b/i);
    expect(m).toContain('original_amount numeric(14,2)');
    expect(m).toContain('due_date date not null');
  });

  it('never persists a mutable financial status beyond active/canceled — overdue/partial/paid are always derived', () => {
    expect(m).toContain("status text not null default 'active' check (status in ('active','canceled'))");
    expect(m).not.toMatch(/check\s*\(\s*status\s+in\s*\([^)]*overdue/i);
  });

  it('models allocation as a dedicated many-to-many table, not a direct FK on payments', () => {
    expect(m).toContain('create table receivable_allocations');
    expect(m).toContain('foreign key (tenant_id,receivable_id) references receivables(tenant_id,id)');
    expect(m).toContain('foreign key (tenant_id,payment_id) references payments(tenant_id,id)');
  });

  it('protects allocation against retry/double-click with a real idempotency key, same as payments', () => {
    expect(m).toContain("idempotency_key text not null check (length(trim(idempotency_key)) >= 8)");
    expect(m).toContain('unique (tenant_id,idempotency_key)');
  });

  it('makes allocations append-only — a reversal is excluded by query, never edited/deleted', () => {
    expect(m).toContain('reject_receivable_allocation_mutation');
    expect(m).toContain('receivable_allocations_append_only');
  });

  it('generates installments by locking the natural origin row first, not a loop+unique_violation retry', () => {
    expect(m).toContain('create function generate_receivables');
    expect(m).toMatch(/from sales s where s\.tenant_id=v_tenant and s\.id=p_sale_id and s\.status='confirmed' for update/);
    expect(m).toMatch(/from service_orders o where o\.tenant_id=v_tenant and o\.id=p_service_order_id and o\.status<>'canceled' for update/);
  });

  it('validates installments sum against origin total minus already-received direct payments (the "entrada" case)', () => {
    expect(m).toContain('v_origin_total - v_received - v_installments_total');
    expect(m).toContain("cm.type='refund'");
  });

  it('treats a retry with different installments as a conflict, never silently returning stale data for mismatched params', () => {
    expect(m).toContain("raise exception 'idempotency conflict' using errcode='23505'");
    expect(m).toContain('n.amt is distinct from r.original_amount or n.due is distinct from r.due_date');
  });

  it('allocates via advisory lock on the payment (no natural row to lock) then a row lock on the receivable, in that fixed order', () => {
    expect(m).toContain('create function allocate_payment');
    expect(m).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_payment_id::text, 102\)\)/);
    expect(m).toMatch(/from receivables rec where rec\.tenant_id=v_tenant and rec\.id=p_receivable_id for update/);
  });

  it('rejects allocating a refunded payment and validates the payment/receivable origin match', () => {
    expect(m).toContain('payment already refunded');
    expect(m).toContain('payment origin does not match receivable origin');
  });

  it('caps allocation by both payment capacity and receivable balance, never inferring from value coincidence alone', () => {
    expect(m).toContain('insufficient payment capacity');
    expect(m).toContain('insufficient receivable balance');
  });

  it('cancels a receivable manually only when it has zero active (non-refunded) allocation', () => {
    expect(m).toContain('create function cancel_receivable');
    expect(m).toContain('receivable has active allocations');
  });

  it('cascades cancellation from the origin, blocking (never silently cascading) when an allocation is active', () => {
    expect(m).toContain('create function cancel_receivables_for_origin');
    expect(m).toContain('return query select true, null::uuid[]');
    expect(m).toContain("cancel_reason=coalesce(nullif(trim(p_reason),''),'Origem cancelada')");
  });

  it('seeds the RBAC codes required by the correio', () => {
    for (const code of ['receivables.read', 'receivables.create', 'receivables.cancel', 'receivables.allocate']) expect(m).toContain(`'${code}'`);
  });

  it('forces fail-closed RLS on both tenant-scoped tables', () => {
    expect(m.match(/force row level security/g)).toHaveLength(2);
    expect(m.match(/vetoros_current_tenant_id\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('never grants direct write access — every mutation, including cancellation, goes through a security definer function', () => {
    expect(m).toContain('grant select on receivables, receivable_allocations to vetoros_runtime');
    expect(m).not.toMatch(/grant\s+(insert|update|delete)[^;]*\breceivables\b/i);
    expect(m).not.toMatch(/grant\s+(insert|update|delete)[^;]*\breceivable_allocations\b/i);
    for (const fn of ['generate_receivables(uuid,uuid,jsonb)', 'allocate_payment(uuid,uuid,numeric,text)', 'cancel_receivable(uuid,text)', 'cancel_receivables_for_origin(uuid,uuid,text)']) {
      expect(m).toContain(`grant execute on function ${fn} to vetoros_runtime`);
    }
  });
});
