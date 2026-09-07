import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(new URL('../migrations/0029_cai03_cash_reconciliation.sql', import.meta.url), 'utf8');

describe('CAI-03 cash reconciliation contract', () => {
  it('persists a justification on the session without creating another ledger', () => {
    expect(migration).toContain('alter table cash_sessions add column closing_justification text');
    expect(migration).not.toContain('create table cash_reconciliation');
    expect(migration).not.toContain('financial_transactions');
  });

  it('enforces justification for a non-zero difference in the database function and constraint', () => {
    expect(migration).toContain('cash_sessions_difference_justification_ck');
    expect(migration).toContain("if v_difference <> 0 and v_justification is null then");
    expect(migration).toContain("raise exception 'closing justification required'");
  });

  it('replaces the bypassable two-argument close function with the justified contract', () => {
    expect(migration).toContain('drop function close_cash_session(uuid,numeric)');
    expect(migration).toContain('close_cash_session(p_cash_session_id uuid, p_closing_amount_informed numeric, p_closing_justification text)');
    expect(migration).toContain('grant execute on function close_cash_session(uuid,numeric,text) to vetoros_runtime');
  });
});
