import{readFile}from'node:fs/promises';import{describe,expect,it}from'vitest';const m=await readFile(new URL('../migrations/0011_service_order_stock.sql',import.meta.url),'utf8');
describe('EST-02 database contract',()=>{
 it('adds optional same-tenant inventory link restricted to part items',()=>{expect(m).toContain('add column inventory_part_id');expect(m).toContain('foreign key(tenant_id,inventory_part_id)');expect(m).toContain("inventory_part_id is null or type='part'");});
 it('persists reservation quantities and valid states',()=>{for(const q of ['original_quantity','reserved_quantity','consumed_quantity','released_quantity','returned_quantity'])expect(m).toContain(q);for(const s of ['reserved','partially_consumed','consumed','released','partially_returned','returned'])expect(m).toContain(s);});
 it.each(['service_order_id','service_order_item_id','inventory_part_id'])('tracks relational origin %s',field=>expect(m).toContain(field));
 it('enforces positive operations and quantitative invariants',()=>{expect(m).toContain('check(quantity>0)');expect(m).toContain('original_quantity=reserved_quantity+consumed_quantity+released_quantity');expect(m).toContain('returned_quantity<=consumed_quantity');});
 it('serializes reservation on the branch balance',()=>{expect(m).toContain('from stock_balances');expect(m).toContain('for update');expect(m).toContain('sum(reserved_quantity)');});
 it('rejects over-reservation and negative physical stock',()=>{expect(m).toContain('p_quantity>v_balance-v_total');expect(m).toContain("raise exception 'insufficient physical stock'");});
 it('requires reservation before consume and bounds release/return',()=>{expect(m).toContain('p_quantity>v_res.reserved_quantity');expect(m).toContain('p_quantity>v_res.consumed_quantity-v_res.returned_quantity');});
 it('uses append-only idempotent operations',()=>{expect(m).toContain('unique(tenant_id,idempotency_key)');expect(m).toContain('service_order_stock_operations_append_only');expect(m).toContain('idempotency conflict');});
 it('keeps physical movements only for consume and return',()=>{expect(m).toContain("if p_action in('consume','return')");expect(m).toContain("case when p_action='consume' then 'exit' else 'entry'");});
 it('makes movement origin relational and preserves ledger immutability',()=>{expect(m).toContain('stock_operation_id');expect(m).toContain('references stock_movements');expect(m).not.toContain('drop trigger stock_movements_append_only');});
 it('forces fail-closed RLS on both new tables',()=>{expect(m.match(/force row level security/g)).toHaveLength(2);expect(m.match(/vetoros_current_tenant_id\(\)/g)?.length).toBeGreaterThanOrEqual(5);});
});
