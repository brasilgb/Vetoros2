import{readFile}from'node:fs/promises';import{describe,expect,it}from'vitest';const m=await readFile(new URL('../migrations/0018_sale_cancel_reversal.sql',import.meta.url),'utf8');
describe('VEN-03 sale cancellation/reversal database contract',()=>{
 it('widens the existing structural protection instead of introducing a new reversal reference column',()=>{expect(m).toContain('drop index stock_movements_sale_item_uq');expect(m).toContain('create unique index stock_movements_sale_item_type_uq on stock_movements(sale_item_id,type) where sale_item_id is not null');expect(m).not.toContain('reversal_of_stock_movement_id');expect(m).not.toContain('add column');});
 it('creates no new tables, functions or permissions — only an index change',()=>{expect(m).not.toContain('create table');expect(m).not.toContain('create function');expect(m).not.toContain('create or replace function');expect(m).not.toContain('grant');});
});
