import { readFile } from 'node:fs/promises';import { describe,expect,it } from 'vitest';const migration=await readFile(new URL('../migrations/0010_inventory.sql',import.meta.url),'utf8');
describe('EST-01 database contract',()=>{
 it('defines tenant master, branch balance and append-only ledger',()=>{expect(migration).toContain('create table inventory_parts');expect(migration).toContain('create table stock_balances');expect(migration).toContain('create table stock_movements');expect(migration).toContain('stock_movements_append_only');});
 it('enforces tenant SKU uniqueness and valid catalog values',()=>{expect(migration).toContain('unique (tenant_id,sku)');expect(migration).toContain("check (status in ('active','inactive'))");expect(migration).toContain('reference_cost >= 0');});
 it.each(['foreign key (tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id)','foreign key (tenant_id,part_id) references inventory_parts(tenant_id,id)'])('has same-tenant FK %s',fk=>expect(migration).toContain(fk));
 it('uses positive numeric quantities and forbids negative balances',()=>{expect(migration).toContain('numeric(16,3)');expect(migration).toContain('check (quantity > 0)');expect(migration).toContain('check (resulting_balance >= 0)');});
 it('supports all physical movement types',()=>expect(migration).toContain("('entry','exit','adjustment_in','adjustment_out')"));
 it('locks the balance and rejects overselling transactionally',()=>{expect(migration).toContain('for update');expect(migration).toContain("raise exception 'insufficient stock'");expect(migration).toContain('record_stock_movement');});
 it('prevents arbitrary runtime balance and ledger mutation',()=>{expect(migration).toContain('revoke all on stock_balances,stock_movements from vetoros_runtime');expect(migration).toContain('grant select on stock_balances,stock_movements');});
 it('forces fail-closed RLS for all inventory tables',()=>{expect(migration.match(/force row level security/g)).toHaveLength(3);expect(migration.match(/vetoros_current_tenant_id\(\)/g)?.length).toBeGreaterThanOrEqual(7);});
});
