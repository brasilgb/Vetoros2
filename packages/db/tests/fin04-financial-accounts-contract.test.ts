import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
const m = await readFile(new URL('../migrations/0025_fin04_financial_accounts.sql', import.meta.url), 'utf8');
// Comentários explicativos deste arquivo citam de propósito "branch_id"/"cash_movements"/"token"
// (para justificar por que NÃO existem) — checar sua ausência real precisa ignorar as linhas de
// comentário (`-- ...`), senão o próprio comentário que os proíbe faria o teste falhar sozinho.
const code = m.replace(/^\s*--.*$/gm, '');
const financialAccountsTable = /create table financial_accounts \(([\s\S]*?)\n\);/.exec(code)?.[1] ?? '';

// FIN-04 — mesmo estilo dos demais "-contract.test.ts": checagem estática do texto da migration
// (schema/constraints/RLS/grants declarados corretamente). O comportamento vivo (funções plpgsql
// executando de verdade, concorrência, idempotência, isolamento cross-tenant real) é coberto pela
// suíte de integração da API (`apps/api/tests/financial-accounts.integration.test.ts`) e pelos
// testes cross-tenant reais acrescentados a `postgres-integration.test.ts` — mesma divisão de
// responsabilidade usada em FIN-01/FIN-02/FIN-03.
describe('FIN-04 database contract', () => {
  it('models a financial account unambiguously owned by tenant→company, deliberately without branch_id', () => {
    expect(m).toContain('create table financial_accounts');
    expect(m).toContain('foreign key (tenant_id,company_id) references companies(tenant_id,id)');
    expect(financialAccountsTable).not.toContain('branch_id');
  });

  it('restricts type to bank_account only this round (cash_equivalent deliberately excluded, per correio.md)', () => {
    expect(m).toContain("type text not null default 'bank_account' check (type in ('bank_account'))");
  });

  it('never stores banking credentials/tokens/secrets as a real column — only cadastral fields', () => {
    for (const forbidden of ['password', 'token', 'secret', 'certificate', 'oauth']) expect(financialAccountsTable.toLowerCase()).not.toContain(forbidden);
    for (const field of ['bank_code', 'bank_name', 'branch_number', 'account_number', 'account_digit', 'pix_key']) expect(financialAccountsTable).toContain(field);
  });

  it('does not reuse cash_movements/cash_session as a bank ledger — financial_transactions is its own domain (only mentioned in explanatory comments, never as a real column/FK)', () => {
    expect(m).toContain('create table financial_transactions');
    expect(code).not.toContain('cash_movements');
    expect(code).not.toContain('cash_session');
  });

  it('uses numeric for every monetary column, never float/real/double precision', () => {
    expect(m).not.toMatch(/\b(float\d*|double precision)\b/i);
    expect(m.match(/numeric\(14,2\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('never allows a negative or zero amount on the ledger — direction is carried by type, not sign', () => {
    expect(m).toContain("type text not null check (type in ('credit','debit'))");
    expect(m).toContain('amount numeric(14,2) not null check (amount > 0)');
  });

  it('models a transfer header (financial_transfers) linking two distinct accounts, amount > 0', () => {
    expect(m).toContain('create table financial_transfers');
    expect(m).toContain('foreign key (tenant_id,from_financial_account_id) references financial_accounts(tenant_id,id)');
    expect(m).toContain('foreign key (tenant_id,to_financial_account_id) references financial_accounts(tenant_id,id)');
    expect(m).toContain('check (from_financial_account_id <> to_financial_account_id)');
  });

  it('partitions financial_transactions.origin into exactly 4 mutually exclusive shapes (no row can exist outside them)', () => {
    expect(m).toContain("origin text not null check (origin in ('opening_balance','manual','transfer','reversal'))");
    expect(m).toMatch(/origin in \('opening_balance','manual'\)[\s\S]*?idempotency_key is not null/);
    expect(m).toMatch(/origin = 'transfer'[\s\S]*?financial_transfer_id is not null[\s\S]*?reverses_transaction_id is null[\s\S]*?idempotency_key is null/);
    expect(m).toMatch(/origin = 'reversal'[\s\S]*?financial_transfer_id is null[\s\S]*?reverses_transaction_id is not null[\s\S]*?idempotency_key is null/);
  });

  it('makes the ledger append-only in PostgreSQL itself, not only in the application', () => {
    expect(m).toContain('reject_financial_transaction_mutation');
    expect(m).toContain('financial_transactions_append_only');
    expect(m).toContain('reject_financial_transfer_mutation');
    expect(m).toContain('financial_transfers_append_only');
  });

  it('allows at most one opening-balance movement per account and at most one reversal per movement, both via structural constraints', () => {
    expect(m).toContain("create unique index financial_transactions_opening_once_uq on financial_transactions(tenant_id,financial_account_id) where origin='opening_balance'");
    expect(m).toContain("create unique index financial_transactions_reversal_once_uq on financial_transactions(tenant_id,reverses_transaction_id) where origin='reversal'");
  });

  it('derives the balance from the ledger (SUM(credits)-SUM(debits)) instead of a mutable stored balance column or a separate projection table', () => {
    expect(m).toContain('create function financial_account_balance');
    expect(m).toMatch(/sum\(case when type='credit' then amount else -amount end\)/);
    expect(m).not.toContain('create table financial_account_balances');
    expect(m).not.toMatch(/financial_accounts[\s\S]{0,400}balance\s+numeric/);
  });

  it('never lets the client freely assemble a ledger row — every write goes through a security definer function, idempotency-key-lookup-first', () => {
    for (const fn of ['set_financial_account_opening_balance', 'record_financial_transaction', 'transfer_between_financial_accounts', 'reverse_financial_transaction', 'reverse_financial_transfer']) {
      expect(m).toContain(`create function ${fn}`);
    }
    expect(m.match(/security definer/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('does not block a negative resulting balance (explicit decision, no universal block rule)', () => {
    expect(m).not.toMatch(/resulting_balance\s*<\s*0/);
    expect(m).not.toMatch(/balance\s*<\s*0\s*then\s*raise/);
  });

  it('models the transfer as atomic (both legs inserted in the same function/transaction) and locks both accounts in a deterministic order to avoid deadlocks', () => {
    expect(m).toContain('create function transfer_between_financial_accounts');
    expect(m).toMatch(/p_from_id < p_to_id/);
    expect(m).toContain("origin='transfer'");
  });

  it('requires the same company on both legs of a transfer (documented architectural decision — no cross-company transfer this round)', () => {
    expect(m).toContain("if v_from.company_id <> v_to.company_id then raise exception 'accounts belong to different companies'");
  });

  it('protects transfer/manual-entry/opening-balance idempotency via a physical unique constraint plus the loop/unique_violation retry pattern, never SELECT-then-INSERT alone', () => {
    expect(m).toContain('unique (tenant_id,idempotency_key)');
    expect(m.match(/exception when unique_violation then continue/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('reverses a manual/opening-balance entry with an inverse-nature new row, but requires transfer legs to be reversed via the atomic transfer-reversal function', () => {
    expect(m).toContain("if v_original.origin not in ('manual','opening_balance') then raise exception 'only manual or opening-balance entries can be reversed directly'");
    expect(m).toContain('create function reverse_financial_transfer');
  });

  it('seeds the RBAC codes required by the correio without granting them broadly', () => {
    for (const code of ['financial_accounts.read', 'financial_accounts.create', 'financial_accounts.update', 'financial_accounts.transact', 'financial_accounts.transfer', 'financial_accounts.reverse']) {
      expect(m).toContain(`'${code}'`);
    }
  });

  it('forces fail-closed RLS on every new tenant-scoped table', () => {
    expect(m.match(/force row level security/g)).toHaveLength(3);
    expect(m.match(/vetoros_current_tenant_id\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('never grants direct write access to the append-only ledger tables, forcing writes through security definer functions', () => {
    expect(m).toContain('grant select on financial_transactions, financial_transfers to vetoros_runtime');
    expect(m).not.toMatch(/grant\s+(insert|update|delete)[^;]*\bfinancial_transactions\b/i);
    expect(m).not.toMatch(/grant\s+(insert|update|delete)[^;]*\bfinancial_transfers\b/i);
    for (const fn of [
      'set_financial_account_opening_balance(uuid,numeric,text)', 'record_financial_transaction(uuid,text,numeric,text,text,timestamptz,text)',
      'transfer_between_financial_accounts(uuid,uuid,numeric,text,text)', 'reverse_financial_transaction(uuid,text)', 'reverse_financial_transfer(uuid,text)',
    ]) expect(m).toContain(`grant execute on function ${fn} to vetoros_runtime`);
  });

  it('allows direct simple CRUD on financial_accounts (cadastral entity), matching the cash_registers configuration pattern', () => {
    expect(m).toContain('grant select,insert,update on financial_accounts to vetoros_runtime');
  });
});
