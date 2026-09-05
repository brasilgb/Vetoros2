import{readFile}from'node:fs/promises';import{describe,expect,it}from'vitest';const m=await readFile(new URL('../migrations/0012_suppliers.sql',import.meta.url),'utf8');
describe('COM-01 supplier database contract',()=>{
 it('uses a dedicated tenant supplier domain and transactional counter',()=>{expect(m).toContain('create table supplier_number_counters');expect(m).toContain('create table suppliers');expect(m).not.toContain('customer_id');});
 it('models PF/PJ document shape and unique document by tenant',()=>{expect(m).toContain("person_type in('individual','company')");expect(m).toContain("document_type='cpf'");expect(m).toContain("document_type='cnpj'");expect(m).toContain('suppliers_document_uq on suppliers(tenant_id,document_type,document_normalized)');});
 it('enforces sequential number uniqueness and statuses',()=>{expect(m).toContain('unique(tenant_id,supplier_number)');expect(m).toContain("status in('active','inactive')");});
 it('provides separate same-tenant addresses and contacts',()=>{expect(m).toContain('create table supplier_addresses');expect(m).toContain('create table supplier_contacts');expect(m.match(/foreign key\(tenant_id,supplier_id\) references suppliers/g)).toHaveLength(2);});
 it('supports required address and contact types',()=>{for(const type of['commercial','billing','shipping','other','phone','mobile','whatsapp','email'])expect(m).toContain(type);});
 it('makes primary address and contact type unambiguous',()=>{expect(m).toContain('supplier_addresses_primary_uq');expect(m).toContain('supplier_contacts_primary_type_uq');});
 it('forces fail-closed RLS on every table',()=>{expect(m.match(/force row level security/g)).toHaveLength(4);expect(m.match(/vetoros_current_tenant_id\(\)/g)?.length).toBeGreaterThanOrEqual(8);});
 it('does not grant delete or introduce purchases and payables',()=>{expect(m).not.toMatch(/grant[^;]*delete/i);expect(m).not.toContain('purchase_orders');expect(m).not.toContain('accounts_payable');});
});
