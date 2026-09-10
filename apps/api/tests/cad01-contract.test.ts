import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readRoute = (name:string) => readFile(new URL(`../src/${name}/routes.ts`, import.meta.url), 'utf8');
const [quotes,orders,sales,inventory]=await Promise.all([readRoute('quotes'),readRoute('service-orders'),readRoute('sales'),readRoute('inventory')]);

describe('CAD-01 API contract',()=>{
  it.each([quotes,orders,sales])('requires a product link exactly for stock part items',(route)=>{
    expect(route).toContain("'non_stock'");
    expect(route).toMatch(/type\s*===\s*'part'.{0,30}Boolean/);
  });

  it('preserves inventory_part_id during quote conversion',()=>{
    expect(quotes).toContain('type,inventory_part_id,description');
    expect(quotes).toContain('type,inventory_part_id,description,quantity');
  });

  it('exposes relational product catalogs and operational filters',()=>{
    expect(inventory).toContain("path:'categories'");
    expect(inventory).toContain("path:'brands'");
    expect(inventory).toContain('categoryId');
    expect(inventory).toContain('brandId');
  });
});
