import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(new URL('../migrations/0034_fis_adv01_fiscal.sql', import.meta.url), 'utf8');

describe('FIS-ADV-01 database contract', () => {
  it('extends the fiscal identity of the issuer without duplicating companies/branches', () => {
    expect(migration).toContain('alter table companies add column if not exists cnae');
    expect(migration).toContain("alter table companies add column if not exists fiscal_environment text not null default 'homologacao'");
    expect(migration).toContain("fiscal_environment in ('homologacao','producao')");
    expect(migration).toContain('alter table branches add column if not exists ibge_city_code');
    expect(migration).not.toContain('create table fiscal_issuer');
  });

  it('declares product fiscal fields separately from the tax situation applied on a document', () => {
    for (const field of ['cest', 'origin', 'default_cfop']) expect(migration).toContain(`inventory_parts add column if not exists ${field}`);
    expect(migration).toContain("inventory_parts_origin_ck check (origin is null or origin in ('0','1','2','3','4','5','6','7','8'))");
  });

  it('requires an unambiguous origin (sale xor service_order) and never a local numbering counter', () => {
    expect(migration).toContain('check((origin_sale_id is not null)::int + (origin_service_order_id is not null)::int = 1)');
    expect(migration).not.toContain('fiscal_document_number_counters');
    expect(migration).toContain('document_number bigint');
  });

  it('enforces a single status-transition trigger with authorized/cancelled as (near-)terminal', () => {
    expect(migration).toContain('create trigger fiscal_documents_status_transition before update on fiscal_documents');
    expect(migration).toContain("when (new.status is distinct from old.status)");
    expect(migration).toContain("(old.status='cancellation_pending' and new.status in('authorized','cancelled'))");
    expect(migration).not.toContain("old.status='cancelled'");
  });

  it('makes fiscal content immutable once issuance was requested, for both the document and its items', () => {
    expect(migration).toContain('create trigger fiscal_documents_content_immutable before update on fiscal_documents');
    expect(migration).toContain('create trigger fiscal_document_items_immutable before update or delete on fiscal_document_items');
    expect(migration).toContain("if old.status not in ('draft','rejected') then");
  });

  it('enables forced RLS on both fiscal tables and revokes physical delete on fiscal_documents', () => {
    for (const table of ['fiscal_documents', 'fiscal_document_items']) {
      expect(migration).toContain(`alter table ${table} enable row level security`);
      expect(migration).toContain(`alter table ${table} force row level security`);
    }
    expect(migration).toContain('revoke delete on fiscal_documents from vetoros_runtime');
  });

  it('adds exactly the fiscal permissions onto the pre-existing fiscal role template, no new namespace beyond it', () => {
    for (const code of ['fiscal.read', 'fiscal.create', 'fiscal.issue', 'fiscal.cancel']) expect(migration).toContain(`'${code}'`);
    expect(migration).toContain("'fiscal'");
  });
});
