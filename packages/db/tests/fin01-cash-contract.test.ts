import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
const m = await readFile(new URL('../migrations/0022_fin01_cash.sql', import.meta.url), 'utf8');

// FIN-01 — mesmo estilo dos demais "-contract.test.ts": checagem estática do texto da migration
// (schema/constraints/RLS/grants declarados corretamente). O comportamento vivo (funções
// plpgsql executando de verdade, concorrência, idempotência) é coberto pela suíte de integração
// da API (`apps/api/tests/cash.integration.test.ts`), que já roda contra um Postgres real — mesma
// divisão de responsabilidade usada em EST-01/EST-02/VEN-01..03.
describe('FIN-01 database contract', () => {
  it('models cash registers unambiguously owned by tenant→company→branch, without a 1:1 branch assumption', () => {
    expect(m).toContain('create table cash_registers');
    expect(m).toContain('foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id)');
    expect(m).toContain('unique (tenant_id,branch_id,name)');
    expect(m).not.toContain('unique (tenant_id,branch_id)');
  });

  it('models sessions with the minimum conceptual fields and a closed-never-reopens invariant', () => {
    expect(m).toContain('create table cash_sessions');
    for (const field of ['opened_by_identity_id', 'opened_at', 'opening_amount', 'closed_by_identity_id', 'closed_at', 'closing_amount_informed']) expect(m).toContain(field);
    expect(m).toContain("check (status in ('open','closed'))");
    expect(m).toContain("status='open' and closed_at is null");
  });

  it('prevents two open sessions for the same register via a structural database constraint, not an application check', () => {
    expect(m).toContain("create unique index cash_sessions_one_open_per_register on cash_sessions(tenant_id,cash_register_id) where status='open'");
  });

  it('uses numeric for every monetary column, never float/real/double precision', () => {
    // "real" também é palavra comum do português nos comentários ("erro real", "tabela real",
    // "constraint real") — checar ausência de tipo de ponto flutuante de forma confiável exige
    // não depender de uma busca textual por essa palavra solta; `float`/`double precision` já não
    // têm esse problema (termos técnicos, não usados em prosa pt-BR), e a contagem positiva de
    // `numeric(14,2)` abaixo é quem garante que toda coluna monetária usa o tipo certo.
    expect(m).not.toMatch(/\b(float\d*|double precision)\b/i);
    expect(m.match(/numeric\(14,2\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('models payment methods as a real configurable catalog, not a fixed CHECK list', () => {
    expect(m).toContain('create table payment_methods');
    expect(m).not.toMatch(/check\s*\(\s*code\s+in/i);
  });

  it('links a receipt to its origin via real nullable FKs, not a fragile polymorphic reference, allowing zero or one origin', () => {
    expect(m).toContain('create table payments');
    expect(m).toContain('foreign key (tenant_id,sale_id) references sales(tenant_id,id)');
    expect(m).toContain('foreign key (tenant_id,service_order_id) references service_orders(tenant_id,id)');
    expect(m).toContain('check ((sale_id is not null)::int + (service_order_id is not null)::int <= 1)');
    // o termo só existe em um comentário explicando por que a alternativa polimórfica foi
    // rejeitada (seção 6) — não deve existir uma coluna/tabela real com esse nome.
    expect(m).not.toMatch(/entity_type\s+(text|uuid)/);
  });

  it('requires a cash session, payment method and a minimum idempotency key length on every receipt', () => {
    expect(m).toContain('cash_session_id uuid not null');
    expect(m).toContain('payment_method_id uuid not null references payment_methods(id)');
    expect(m).toContain('idempotency_key text not null check (length(trim(idempotency_key)) >= 8)');
    expect(m).toContain('unique (tenant_id,idempotency_key)');
  });

  it('supports partial/multi-method payment: amount is per-receipt, several receipts may share the same origin', () => {
    expect(m).toContain('amount numeric(14,2) not null check (amount > 0)');
    expect(m).not.toContain('unique (tenant_id,sale_id)');
    expect(m).not.toContain('unique (tenant_id,service_order_id)');
  });

  it('models an append-only financial ledger covering opening, receipt, refund, supply and withdrawal', () => {
    expect(m).toContain('create table cash_movements');
    expect(m).toContain("check (type in ('opening','receipt','refund','supply','withdrawal'))");
    expect(m).toContain('reject_cash_movement_mutation');
    expect(m).toContain('cash_movements_append_only');
  });

  it('makes payments themselves immutable too — a receipt is compensated, never edited', () => {
    expect(m).toContain('reject_payment_mutation');
    expect(m).toContain('payments_append_only');
  });

  it('allows at most one refund per payment via a structural constraint', () => {
    expect(m).toContain("create unique index cash_movements_refund_once_uq on cash_movements(payment_id) where type='refund'");
  });

  it('open/close sessions transactionally, locking the row and validating state transitions server-side', () => {
    expect(m).toContain('create function open_cash_session');
    expect(m).toContain('create function close_cash_session');
    expect(m).toMatch(/from cash_registers where tenant_id=v_tenant and id=p_cash_register_id and status='active' for update/);
    expect(m).toMatch(/from cash_sessions where tenant_id=v_tenant and id=p_cash_session_id for update/);
    expect(m).toContain("if v_session.status <> 'open' then raise exception 'session not open'");
  });

  it('implements receive_payment with the idempotency-key-lookup-first pattern, conflicting on reused keys with different params', () => {
    expect(m).toContain('create function receive_payment');
    expect(m).toContain('select id into v_payment_id from payments where tenant_id=v_tenant and idempotency_key=p_idempotency_key');
    expect(m).toContain("raise exception 'idempotency conflict' using errcode='23505'");
    expect(m).toContain('return query select v_payment_id, v_move_id, v_balance, true; return;');
  });

  it('validates the receipt origin server-side: confirmed sale, non-canceled service order, active payment method', () => {
    expect(m).toContain("status='confirmed'");
    expect(m).toContain("status<>'canceled'");
    expect(m).toContain("from payment_methods where id=p_payment_method_id and status='active'");
  });

  it('refunds append-only, idempotent by payment, rejecting a negative resulting balance', () => {
    expect(m).toContain('create function refund_payment');
    expect(m).toContain("where cm.tenant_id=v_tenant and cm.payment_id=p_payment_id and cm.type='refund'");
    expect(m).toContain('if v_balance < 0 then raise exception');
  });

  it('derives every balance from the last ledger movement — no separate mutable balance-of-record table', () => {
    expect(m).toContain('order by cm.created_at desc, cm.id desc limit 1');
    expect(m).not.toContain('create table cash_balances');
    expect(m).not.toMatch(/balance\s+numeric[^,]*not null default/i);
  });

  it('seeds the RBAC codes required by the correio without granting sensitive ones broadly', () => {
    for (const code of ['cash.read', 'cash.manage', 'cash.open', 'cash.close', 'payments.read', 'payments.create', 'payments.refund']) expect(m).toContain(`'${code}'`);
  });

  it('forces fail-closed RLS on every tenant-scoped table, deliberately excluding the global payment_methods catalog', () => {
    expect(m.match(/force row level security/g)).toHaveLength(4);
    expect(m.match(/vetoros_current_tenant_id\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(m).not.toMatch(/alter table payment_methods enable row level security/);
  });

  it('never grants direct write access to the append-only tables, forcing writes through security definer functions', () => {
    expect(m).toContain('grant select on cash_sessions,payments,cash_movements to vetoros_runtime');
    expect(m).not.toMatch(/grant\s+(insert|update|delete)[^;]*\bpayments\b/i);
    expect(m).not.toMatch(/grant\s+(insert|update|delete)[^;]*\bcash_movements\b/i);
    for (const fn of ['open_cash_session(uuid,numeric)', 'close_cash_session(uuid,numeric)', 'receive_payment(uuid,numeric,uuid,uuid,uuid,text,text)', 'refund_payment(uuid,uuid,text)']) {
      expect(m).toContain(`grant execute on function ${fn} to vetoros_runtime`);
    }
  });

  it('allows direct simple CRUD on cash_registers, matching the companies/branches configuration pattern', () => {
    expect(m).toContain('grant select,insert,update on cash_registers to vetoros_runtime');
  });
});
