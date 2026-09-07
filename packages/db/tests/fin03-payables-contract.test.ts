import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
const m = await readFile(new URL('../migrations/0024_fin03_payables.sql', import.meta.url), 'utf8');

// FIN-03 — mesmo estilo dos demais "-contract.test.ts" (ver fin02-receivables-contract.test.ts):
// checagem estática do texto da migration. O comportamento vivo (funções plpgsql executando de
// verdade, concorrência, idempotência) é coberto pela suíte de integração da API
// (apps/api/tests/payables.integration.test.ts), que roda contra um Postgres real.
describe('FIN-03 database contract', () => {
  it('models título (payables) and parcela (payable_installments) as separate tables, unlike FIN-02', () => {
    expect(m).toContain('create table payables');
    expect(m).toContain('create table payable_installments');
    expect(m).toContain('payable_id uuid not null');
    expect(m).toContain('foreign key (tenant_id,payable_id) references payables(tenant_id,id)');
  });

  it('derives the payable origin from a real nullable FK to purchase_orders, never a polymorphic reference', () => {
    expect(m).toContain('purchase_order_id uuid');
    expect(m).toContain('foreign key (tenant_id,purchase_order_id) references purchase_orders(tenant_id,id)');
    expect(m).not.toMatch(/entity_type\s+(text|uuid)/);
  });

  it('allows at most one active payable per purchase order origin, structurally', () => {
    expect(m).toContain("create unique index payables_purchase_order_uq on payables(tenant_id,purchase_order_id) where purchase_order_id is not null and status<>'canceled'");
  });

  it('snapshots supplier name/document at creation time, never re-derived from a live join for historical display', () => {
    expect(m).toContain('supplier_name_snapshot text');
    expect(m).toContain('supplier_document_snapshot text');
  });

  it('requires a supplier whenever the origin is a purchase order', () => {
    expect(m).toContain('check (purchase_order_id is null or supplier_id is not null)');
  });

  it('never persists a mutable financial status beyond active/canceled — overdue/partial/paid are always derived', () => {
    expect(m).toContain("status text not null default 'active' check (status in ('active','canceled'))");
    expect(m).not.toMatch(/check\s*\(\s*status\s+in\s*\([^)]*overdue/i);
  });

  it('always derives payables.original_amount from the sum of its installments via trigger, same technique as purchase_orders.total', () => {
    expect(m).toContain('create function recompute_payable_total');
    expect(m).toContain('create trigger payable_installments_recompute_total after insert or update or delete on payable_installments');
  });

  it('uses numeric for every monetary column, never float/real/double precision', () => {
    expect(m).not.toMatch(/\b(float\d*|double precision)\b/i);
    expect(m.match(/numeric\(14,2\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('enforces unique installment numbers per payable and installment_number<=installment_count', () => {
    expect(m).toContain('unique (tenant_id,payable_id,installment_number)');
    expect(m).toContain('check (installment_number <= installment_count)');
  });

  it('models payments as an append-only ledger (type payment/reversal), never a DELETE of a realized payment', () => {
    expect(m).toContain('create table payable_payments');
    expect(m).toContain("type text not null check (type in ('payment','reversal'))");
    expect(m).toContain('reject_payable_payment_mutation');
    expect(m).toContain('payable_payments_append_only');
  });

  it('allows at most one reversal per payment via a structural constraint', () => {
    expect(m).toContain('create unique index payable_payments_reversal_once_uq on payable_payments(tenant_id,reverses_payment_id) where type=\'reversal\'');
  });

  it('protects payment creation with a real idempotency key, but never requires one for a reversal (protected by the unique index instead)', () => {
    expect(m).toContain("type='payment' and reverses_payment_id is null and idempotency_key is not null and length(trim(idempotency_key))>=8");
    expect(m).toContain("type='reversal' and reverses_payment_id is not null and idempotency_key is null");
  });

  it('generates a payable by locking the origin (purchase order) row first, not a loop+unique_violation retry', () => {
    expect(m).toContain('create function create_payable');
    expect(m).toMatch(/from purchase_orders po where po\.tenant_id=v_tenant and po\.id=p_purchase_order_id and po\.status='approved' for update/);
  });

  it('validates installments sum against the purchase order total exactly when the origin is a purchase order', () => {
    expect(m).toContain('v_po_total - v_installments_total');
    expect(m).toContain("raise exception 'installments do not match purchase order total'");
  });

  it('requires the supplier to be derived from the purchase order, rejecting an explicit supplier when an origin is given', () => {
    expect(m).toContain("raise exception 'supplier is derived from the purchase order'");
  });

  it('pays an installment by locking the installment row itself (a natural resource, unlike FIN-02 payments which needed an advisory lock)', () => {
    expect(m).toContain('create function pay_installment');
    expect(m).toMatch(/from payable_installments where tenant_id=v_tenant and id=p_installment_id for update/);
  });

  it('caps a payment by the installment balance and rejects a payment against a canceled payable', () => {
    expect(m).toContain("raise exception 'payment exceeds balance' using errcode='23514'");
    expect(m).toContain("raise exception 'payable not active' using errcode='55000'");
  });

  it('reverses a payment append-only, idempotent by payment, via the installment lock plus a unique_violation retry loop', () => {
    expect(m).toContain('create function reverse_payable_payment');
    expect(m).toContain("where tenant_id=v_tenant and id=p_payment_id and type='payment'");
    expect(m).toContain('exception when unique_violation then continue');
  });

  it('cancels a payable only when no installment has an active (non-reversed) payment — blocking, never cascading silently', () => {
    expect(m).toContain('create function cancel_payable');
    expect(m).toContain("raise exception 'payable has active payments'");
  });

  it('seeds the RBAC codes required by the correio', () => {
    for (const code of ['payables.read', 'payables.create', 'payables.update', 'payables.pay', 'payables.cancel', 'payables.reverse']) expect(m).toContain(`'${code}'`);
  });

  it('forces fail-closed RLS on every tenant-scoped table', () => {
    expect(m.match(/force row level security/g)).toHaveLength(3);
    expect(m.match(/vetoros_current_tenant_id\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('never grants direct write access — every mutation, including cancellation, goes through a security definer function; only administrative columns of payables get a direct, column-restricted UPDATE grant', () => {
    expect(m).toContain('grant select on payables, payable_installments, payable_payments to vetoros_runtime');
    expect(m).toContain('grant update (description, document_number, updated_by_identity_id, updated_at) on payables to vetoros_runtime');
    expect(m).not.toMatch(/grant\s+(insert|delete)[^;]*\bpayables\b/i);
    expect(m).not.toMatch(/grant\s+(insert|update|delete)[^;]*\bpayable_installments\b/i);
    expect(m).not.toMatch(/grant\s+(insert|update|delete)[^;]*\bpayable_payments\b/i);
    for (const fn of ['create_payable(uuid,uuid,uuid,uuid,text,text,date,jsonb)', 'pay_installment(uuid,numeric,timestamptz,uuid,text,text)', 'reverse_payable_payment(uuid,text)', 'cancel_payable(uuid,text)']) {
      expect(m).toContain(`grant execute on function ${fn} to vetoros_runtime`);
    }
  });
});
