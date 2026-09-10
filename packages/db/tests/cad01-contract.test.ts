import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(new URL('../migrations/0031_cad01_foundational_records.sql', import.meta.url), 'utf8');

describe('CAD-01 foundational records contract', () => {
  it('adds tenant-scoped category and brand catalogs with fail-closed RLS', () => {
    expect(migration).toContain('CREATE TABLE product_categories');
    expect(migration).toContain('CREATE TABLE product_brands');
    expect(migration.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(2);
    expect(migration).toContain('FOREIGN KEY (tenant_id,category_id)');
    expect(migration).toContain('FOREIGN KEY (tenant_id,brand_id)');
  });

  it('adds operational product, organization, asset and supplier fields', () => {
    for (const field of ['barcode_ean', 'minimum_stock', 'default_location', 'ncm', 'logo_url', 'warranty_until', 'received_accessories', 'commercial_terms', 'default_lead_time_days']) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain('branches_one_default_per_company_uq');
  });

  it('makes inventory-backed items unambiguous in quotes, orders and sales', () => {
    expect(migration.match(/type IN \('service','part','non_stock'\)/g)).toHaveLength(3);
    expect(migration.match(/type='part' AND inventory_part_id IS NOT NULL/g)).toHaveLength(3);
    expect(migration).toContain('UPDATE quote_items SET type=\'non_stock\'');
    expect(migration).toContain("UPDATE service_order_items SET type='non_stock'");
    expect(migration).toContain("UPDATE sale_items SET type='non_stock'");
  });
});
