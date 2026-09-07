import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
const migration=await readFile(new URL('../migrations/0030_agd01_schedules.sql',import.meta.url),'utf8');

describe('AGD-01 schedules database contract',()=>{
 it('keeps the operational fact small and permits a standalone appointment',()=>{expect(migration).toContain('CREATE TABLE schedules');expect(migration).toContain('service_order_id uuid');expect(migration).not.toContain('service_order_id uuid NOT NULL');expect(migration).not.toMatch(/check.?in|check.?out|recurr/i)});
 it('has only the minimal scheduled/canceled lifecycle and preserves cancellation metadata',()=>{expect(migration).toContain("CHECK (status IN ('scheduled','canceled'))");expect(migration).toContain('canceled_by_identity_id');expect(migration).toContain('canceled_at');expect(migration).not.toMatch(/GRANT[^;]*DELETE ON schedules/i)});
 it('enforces end after start while allowing unknown duration',()=>{expect(migration).toContain('ends_at timestamptz');expect(migration).toContain('CHECK (ends_at IS NULL OR ends_at > starts_at)')});
 it('enforces tenant/branch OS, canonical customer/asset and authorized responsible in the database',()=>{for(const marker of ['schedule_service_order_scope_mismatch','schedule_service_order_customer_mismatch','schedule_service_order_asset_mismatch','schedule_asset_customer_mismatch','schedule_responsible_not_authorized'])expect(migration).toContain(marker)});
 it('uses RLS FORCE and same-tenant composite foreign keys',()=>{expect(migration).toContain('ALTER TABLE schedules ENABLE ROW LEVEL SECURITY');expect(migration).toContain('ALTER TABLE schedules FORCE ROW LEVEL SECURITY');expect(migration).toContain('FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES branches');expect(migration).toContain('FOREIGN KEY (tenant_id,service_order_id) REFERENCES service_orders(tenant_id,id)')});
 it('indexes weekly branch/responsible queries and does not rigidly block overlap',()=>{expect(migration).toContain('schedules_branch_start_idx');expect(migration).toContain('schedules_responsible_start_idx');expect(migration).not.toMatch(/exclude using gist|no_overlap/i)});
 it('defines distinct least-privilege permissions',()=>{for(const code of ['schedules.read','schedules.create','schedules.update','schedules.cancel'])expect(migration).toContain(code)});
});
