import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(new URL('../migrations/0026_ven01_sales_contract.sql', import.meta.url), 'utf8');

describe('VEN-01 persisted commercial contract', () => {
  it('stores a dedicated commercial date and nonnegative, internally consistent header totals', () => {
    expect(migration).toContain('add column sale_date date not null');
    expect(migration).toContain('add column subtotal numeric(14,2) not null');
    expect(migration).toContain('add column discount_total numeric(14,2) not null');
    expect(migration).toContain('add column total numeric(14,2) not null');
    expect(migration).toContain('check(total=subtotal-discount_total)');
  });

  it('derives every header total from sale_items inside PostgreSQL', () => {
    expect(migration).toContain('create function refresh_sale_totals()');
    expect(migration).toContain('after insert or update or delete on sale_items');
    expect(migration).toContain('sum(si.quantity*si.unit_price)');
    expect(migration).toContain('sum(si.discount_amount)');
    expect(migration).toContain('sum(si.total)');
  });

  it('does not introduce stock or financial side effects', () => {
    expect(migration).not.toContain('stock_movements');
    expect(migration).not.toContain('stock_balances');
    expect(migration).not.toContain('cash_movements');
    expect(migration).not.toContain('financial_transactions');
    expect(migration).not.toContain('receivables');
  });
});
