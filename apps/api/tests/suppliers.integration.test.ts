import{randomInt,randomUUID}from'node:crypto';import{afterAll,beforeAll,describe,expect,it}from'vitest';import{AuthService}from'../src/auth/service.js';import{buildApp}from'../src/app.js';
const password=process.env.DEV_SEED_PASSWORD??'change-me-local-only',service=new AuthService(process.env.AUTH_DATABASE_URL??'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros',process.env.DATABASE_URL??'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros',3600),app=buildApp({authService:service,loginRateLimitMax:100});let cookie='';beforeAll(async()=>{await app.ready();const r=await app.inject({method:'POST',url:'/auth/login',payload:{email:'single@vetoros.local',password}});cookie=String(r.headers['set-cookie']).split(';')[0]!;});afterAll(async()=>{await app.close();await service.close();});
const create=(overrides:Record<string,unknown>={})=>app.inject({method:'POST',url:'/suppliers',headers:{cookie},payload:{personType:'company',legalName:`Fornecedor ${randomUUID()}`,tradeName:'Parceiro',...overrides}});

// SAN-01, seção 3 do correio.md: um CPF/CNPJ fixo tornava este teste não repetível contra o
// mesmo banco de desenvolvimento (a segunda execução colidia com a constraint real de
// unicidade — 409 — em vez do 201 esperado). Geradores que produzem um documento VÁLIDO
// (dígitos verificadores corretos, mesmo algoritmo de apps/api/src/shared/br-documents.ts)
// aleatório a cada chamada preservam a cobertura real (a rota ainda normaliza/valida um
// documento de verdade) sem depender de um valor fixo — a chance de colisão entre duas
// chamadas nesta suíte é desprezível (10^9/10^12 combinações), e mesmo que ocorresse entre
// execuções distintas da suíte, o próprio teste de duplicidade abaixo já prova que a
// constraint de unicidade real continua funcionando corretamente.
function randomCpf(): string {
  const d = Array.from({ length: 9 }, () => randomInt(0, 10));
  const check = (weighted: number[]) => { const sum = weighted.reduce((total, w, i) => total + d[i]! * w, 0); return ((sum * 10) % 11) % 10; };
  d.push(check(Array.from({ length: 9 }, (_, i) => 10 - i)));
  d.push(check(Array.from({ length: 10 }, (_, i) => 11 - i)));
  return d.join('');
}
function randomCnpj(): string {
  const d = Array.from({ length: 12 }, () => randomInt(0, 10));
  const check = (weights: number[]) => { const rest = weights.reduce((total, w, i) => total + d[i]! * w, 0) % 11; return rest < 2 ? 0 : 11 - rest; };
  d.push(check([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  d.push(check([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return d.join('');
}

describe('COM-01 suppliers API',()=>{
 it('requires authentication and tenant context',async()=>{expect((await app.inject({method:'POST',url:'/suppliers',payload:{personType:'company',legalName:'x'}})).statusCode).toBe(401);const login=await app.inject({method:'POST',url:'/auth/login',payload:{email:'shared@vetoros.local',password}});expect((await app.inject({method:'POST',url:'/suppliers',headers:{cookie:String(login.headers['set-cookie']).split(';')[0]!},payload:{personType:'company',legalName:'x'}})).statusCode).toBe(409);});
 it('creates valid PF and PJ and normalizes documents',async()=>{const cpf=randomCpf(),cnpj=randomCnpj();const pf=await create({personType:'individual',document:cpf}),pj=await create({document:cnpj});expect(pf.statusCode).toBe(201);expect(pf.json().document_normalized).toBe(cpf);expect(pj.statusCode).toBe(201);expect(pj.json().document_normalized).toBe(cnpj);});
 it('rejects invalid documents, invalid payload and duplicate documents',async()=>{expect((await create({personType:'individual',document:'111.111.111-11'})).statusCode).toBe(400);expect((await create({legalName:'',tenantId:randomUUID()})).statusCode).toBe(400);const doc=randomCnpj();const first=await create({document:doc});expect(first.statusCode).toBe(201);expect((await create({document:doc})).statusCode).toBe(409);});
 it('generates unique sequential numbers under concurrency',async()=>{const results=await Promise.all(Array.from({length:10},()=>create()));expect(results.every(r=>r.statusCode===201)).toBe(true);const numbers=results.map(r=>Number(r.json().supplier_number));expect(new Set(numbers).size).toBe(numbers.length);});
 it('lists, searches, paginates, filters, orders and reads detail',async()=>{const made=await create({legalName:'Fornecedor Busca COM01'}),id=made.json().id;const list=await app.inject({method:'GET',url:'/suppliers?search=Busca%20COM01&status=active&page=1&pageSize=5&order=name_asc',headers:{cookie}});expect(list.statusCode).toBe(200);expect(list.json().total).toBeGreaterThan(0);expect((await app.inject({method:'GET',url:`/suppliers/${id}`,headers:{cookie}})).statusCode).toBe(200);expect((await app.inject({method:'GET',url:`/suppliers/${randomUUID()}`,headers:{cookie}})).statusCode).toBe(404);});
 it('updates and activates/inactivates without allowing ownership fields',async()=>{const made=await create(),id=made.json().id;expect((await app.inject({method:'PATCH',url:`/suppliers/${id}`,headers:{cookie},payload:{legalName:'Fornecedor Atualizado',status:'inactive'}})).statusCode).toBe(200);expect((await app.inject({method:'PATCH',url:`/suppliers/${id}`,headers:{cookie},payload:{status:'active'}})).statusCode).toBe(200);expect((await app.inject({method:'PATCH',url:`/suppliers/${id}`,headers:{cookie},payload:{tenantId:randomUUID(),supplierNumber:1}})).statusCode).toBe(400);expect((await app.inject({method:'DELETE',url:`/suppliers/${id}`,headers:{cookie}})).statusCode).toBe(404);});
 it('creates, lists and updates multiple addresses with one primary',async()=>{const id=(await create()).json().id;const first=await app.inject({method:'POST',url:`/suppliers/${id}/addresses`,headers:{cookie},payload:{addressType:'commercial',postalCode:'01310-100',street:'Av Paulista',city:'São Paulo',state:'SP',isPrimary:true}});expect(first.statusCode).toBe(201);const second=await app.inject({method:'POST',url:`/suppliers/${id}/addresses`,headers:{cookie},payload:{addressType:'billing',street:'Rua B',city:'São Paulo',state:'SP',isPrimary:true}});expect(second.statusCode).toBe(201);expect((await app.inject({method:'PATCH',url:`/suppliers/${id}/addresses/${first.json().id}`,headers:{cookie},payload:{city:'Campinas'}})).statusCode).toBe(200);const rows=(await app.inject({method:'GET',url:`/suppliers/${id}/addresses`,headers:{cookie}})).json();expect(rows).toHaveLength(2);expect(rows.filter((a:{is_primary:boolean})=>a.is_primary)).toHaveLength(1);});
 it('creates, normalizes, lists and updates contacts by type',async()=>{const id=(await create()).json().id;const phone=await app.inject({method:'POST',url:`/suppliers/${id}/contacts`,headers:{cookie},payload:{contactType:'phone',value:'(11) 3333-4444',isPrimary:true}});expect(phone.statusCode).toBe(201);expect(phone.json().value_normalized).toBe('1133334444');const email=await app.inject({method:'POST',url:`/suppliers/${id}/contacts`,headers:{cookie},payload:{contactType:'email',value:'COMERCIAL@EXAMPLE.COM',isPrimary:true}});expect(email.statusCode).toBe(201);expect((await app.inject({method:'PATCH',url:`/suppliers/${id}/contacts/${email.json().id}`,headers:{cookie},payload:{value:'novo@example.com'}})).statusCode).toBe(200);expect((await app.inject({method:'GET',url:`/suppliers/${id}/contacts`,headers:{cookie}})).json()).toHaveLength(2);});
});
