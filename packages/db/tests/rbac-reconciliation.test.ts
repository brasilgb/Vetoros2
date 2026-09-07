import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionRoleTemplates } from '../src/seed.js';

// SAN-01 — seção 1 do correio.md: `provisionRoleTemplates` (packages/db/src/seed.ts) precisa
// reconciliar um `tenant_roles` system-managed já existente com o template atual toda vez que
// roda, não só na primeira vez. Ver "Descoberta" no executed.md para o relacionamento completo
// entre `system_role_templates`/`system_role_template_permissions`/`tenant_roles`/
// `tenant_role_permissions` e por que a política escolhida é espelhamento exato.
//
// Usa um template/tenant/permissions fabricados só para este teste (nunca 'owner'/'administrator'
// reais nem os tenants de dev do seed) — não interfere com o restante da suíte nem com o próprio
// `pnpm db:seed`, e limpa tudo em `afterAll`.
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const admin = postgres(migrationUrl, { max: 2 });

const templateId = randomUUID(), templateCode = `san01_test_${randomUUID()}`;
const tenantId = randomUUID();
const permissionA = randomUUID(), permissionB = randomUUID(); // A: existe desde o início. B: "adicionada depois" (simula um módulo novo).
const customRoleId = randomUUID(), customPermission = randomUUID();
const collidingCodeRoleId = randomUUID();
const freshTenantId = randomUUID(); // tenant provisionado pela primeira vez só no penúltimo teste
// `permissionLabel` (apps/web/lib/permission-labels.ts) exibe o ÚLTIMO segmento de um `code`
// separado por "." como rótulo — um `code` terminando no UUID cru (`san01.a.<uuid>`, a versão
// original deste fixture) aparecia como texto cru na tela real de Papéis e Permissões (`permissions`
// é catálogo GLOBAL, sem tenant_id — visível em QUALQUER tenant), quebrando a garantia de "nenhum
// UUID exibido" que 07-roles.spec.ts verifica (defeito real encontrado rodando a suíte E2E
// completa depois deste teste). Hífen removido do sufixo garante que o último segmento nunca bate
// com o formato de UUID.
const codeA = `san01test.reada${permissionA.replaceAll('-', '')}`, codeB = `san01test.readb${permissionB.replaceAll('-', '')}`, codeCustom = `san01test.readc${customPermission.replaceAll('-', '')}`;

async function inTenant<T>(tenantId: string, callback: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return admin.begin(async (tx) => { await tx`select set_config('app.tenant_id', ${tenantId}, true)`; return callback(tx); }) as Promise<T>;
}
async function rolePermissionCodes(tenant: string, roleId: string): Promise<string[]> {
  const rows = await inTenant(tenant, (tx) => tx<{ code: string }[]>`
    select p.code from tenant_role_permissions trp join permissions p on p.id=trp.permission_id
    where trp.tenant_id=${tenant} and trp.role_id=${roleId} order by p.code`);
  return rows.map((r) => r.code);
}

beforeAll(async () => {
  await admin`insert into tenants (id,slug,legal_name,status) values (${tenantId},${`san01-${tenantId}`},'SAN-01 Tenant','active')`;
  await admin`insert into permissions (id,code,module,description) values
    (${permissionA},${codeA},'san01_test','A'),
    (${permissionB},${codeB},'san01_test','B'),
    (${customPermission},${codeCustom},'san01_test','Custom')`;
  await admin`insert into system_role_templates (id,code,name,scope_type,inherits_descendants) values (${templateId},${templateCode},'SAN-01 Test Role','tenant',false)`;
  // só a permission A existe no template no início — B é adicionada DEPOIS (seção "novo módulo").
  await admin`insert into system_role_template_permissions (role_template_id,permission_id) values (${templateId},${permissionA})`;
});
afterAll(async () => {
  // Limpeza completa, sem deixar NADA inerte para trás — ao contrário do que a primeira versão
  // deste teste assumia (achar que um `system_role_templates`/`tenant_roles` system-managed
  // "preso" pelo trigger de proteção era inofensivo). Não é: `system_role_templates` é catálogo
  // GLOBAL sem filtro de tenant, então `provisionRoleTemplates` — corretamente, é o comportamento
  // que este arquivo testa — propaga QUALQUER template `is_active` para TODO tenant em que rodar,
  // inclusive os tenants reais de dev (`db:seed` chama `provisionRoleTemplates(tenantAlpha)` /
  // `(tenantBeta)`). Deixar o template fabricado para trás poluiu de verdade `GET /roles` de
  // `tenantAlpha`/`tenantBeta` em execuções anteriores desta suíte (defeito real: 50 papéis
  // "san01_test_*" vazados em 13 tenants diferentes, quebrando `roles.integration.test.ts`,
  // encontrado rodando a suíte completa da API depois deste teste).
  //
  // `tenant_roles` pertence a `vetoros_migration` (dono da tabela — `\d tenant_roles` confirma),
  // então esta conexão PODE desabilitar o próprio trigger de proteção temporariamente para desfazer
  // exatamente o que ela mesma criou, sem precisar de superusuário: nunca aceitável para corrigir
  // dado real, mas correto aqui porque é a MESMA transação de teste limpando seu PRÓPRIO fixture.
  // IMPORTANTE: `provisionRoleTemplates(tenantId)` provisiona um papel para CADA template ATIVO
  // — não só o fabricado por este arquivo. `tenantId`/`freshTenantId` são tenants inteiramente
  // descartáveis (não têm nenhum outro propósito além deste teste), então a limpeza correta é
  // apagar TODOS os seus `tenant_roles`/`tenant_role_permissions`, sem filtrar por template —
  // filtrar só pelo template fabricado (versão anterior deste teste) deixava os 9 papéis REAIS
  // (owner/administrator/.../read_only, também provisionados normalmente para estes tenants)
  // presos para trás, o que por sua vez bloqueava o DELETE de `tenants` no fim (defeito real
  // encontrado logo depois de corrigir o vazamento do template global: `tenants` acumulou 20
  // linhas descartáveis nunca removidas em execuções repetidas desta suíte).
  //
  // `admin` (vetoros_migration) NÃO é superusuário — é dono de `tenant_roles`, mas continua
  // sujeito a RLS (mesma lição de FIN-01: só um superusuário de verdade contorna RLS
  // automaticamente); por isso os deletes de `tenant_role_permissions`/`tenant_roles` ainda
  // precisam do contexto de tenant, um de cada vez.
  await inTenant(tenantId, (tx) => tx`delete from tenant_role_permissions where tenant_id=${tenantId}`);
  await inTenant(freshTenantId, (tx) => tx`delete from tenant_role_permissions where tenant_id=${freshTenantId}`);
  await admin`alter table tenant_roles disable trigger tenant_roles_protect_system`;
  await inTenant(tenantId, (tx) => tx`delete from tenant_roles where tenant_id=${tenantId}`);
  await inTenant(freshTenantId, (tx) => tx`delete from tenant_roles where tenant_id=${freshTenantId}`);
  await admin`alter table tenant_roles enable trigger tenant_roles_protect_system`;
  await admin`delete from system_role_template_permissions where role_template_id=${templateId}`;
  await admin`delete from system_role_templates where id=${templateId}`;
  await admin`delete from permissions where id in ${admin([permissionA, permissionB, customPermission])}`;
  await admin`delete from tenants where id in (${tenantId},${freshTenantId})`;
  await admin.end();
});

describe('SAN-01 RBAC reconciliation (provisionRoleTemplates)', () => {
  it('provisions a system-managed role and copies the template permissions on first run', async () => {
    await provisionRoleTemplates(tenantId);
    const [role] = await inTenant(tenantId, (tx) => tx<{ id: string; is_system_managed: boolean }[]>`select id,is_system_managed from tenant_roles where tenant_id=${tenantId} and code=${templateCode}`);
    expect(role?.is_system_managed).toBe(true);
    expect(await rolePermissionCodes(tenantId, role!.id)).toEqual([codeA]);
  });

  it('a permission added to the template later reaches an already-provisioned tenant on the next seed run', async () => {
    // simula "módulo novo depois que o tenant já existia": adiciona B ao template, sem recriar nada.
    await admin`insert into system_role_template_permissions (role_template_id,permission_id) values (${templateId},${permissionB})`;
    await provisionRoleTemplates(tenantId); // segundo seed
    const [role] = await inTenant(tenantId, (tx) => tx<{ id: string }[]>`select id from tenant_roles where tenant_id=${tenantId} and code=${templateCode}`);
    expect(await rolePermissionCodes(tenantId, role!.id)).toEqual([codeA, codeB]);
  });

  it('stays idempotent on a third run with no template change (no duplicate rows, no error)', async () => {
    const [role] = await inTenant(tenantId, (tx) => tx<{ id: string }[]>`select id from tenant_roles where tenant_id=${tenantId} and code=${templateCode}`);
    await expect(provisionRoleTemplates(tenantId)).resolves.not.toThrow();
    await expect(provisionRoleTemplates(tenantId)).resolves.not.toThrow();
    expect(await rolePermissionCodes(tenantId, role!.id)).toEqual([codeA, codeB]);
    // continua sendo o MESMO papel (nunca recriado) — requisito 1.
    const roles = await inTenant(tenantId, (tx) => tx<{ id: string }[]>`select id from tenant_roles where tenant_id=${tenantId} and code=${templateCode}`);
    expect(roles).toHaveLength(1);
    expect(roles[0]!.id).toBe(role!.id);
  });

  it('removing a permission from the template removes it from the tenant role too (mirror policy, requisito 4)', async () => {
    await admin`delete from system_role_template_permissions where role_template_id=${templateId} and permission_id=${permissionA}`;
    await provisionRoleTemplates(tenantId);
    const [role] = await inTenant(tenantId, (tx) => tx<{ id: string }[]>`select id from tenant_roles where tenant_id=${tenantId} and code=${templateCode}`);
    expect(await rolePermissionCodes(tenantId, role!.id)).toEqual([codeB]);
    // restaura A para não acoplar os testes seguintes a esta remoção.
    await admin`insert into system_role_template_permissions (role_template_id,permission_id) values (${templateId},${permissionA})`;
  });

  it('never touches a tenant-customized role, even one whose code coincidentally matches a template code', async () => {
    await inTenant(tenantId, async (tx) => {
      await tx`insert into tenant_roles (id,tenant_id,code,name,scope_type,is_system_managed) values (${customRoleId},${tenantId},${`san01_custom_${customRoleId}`},'Custom Role','tenant',false)`;
      await tx`insert into tenant_role_permissions (tenant_id,role_id,permission_id) values (${tenantId},${customRoleId},${customPermission})`;
      // papel customizado com o MESMO código do template — caso extremo do requisito 5/6: nunca
      // deveria acontecer na prática (só o seed cria papel com código de template), mas a garantia
      // é testada mesmo assim.
      await tx`insert into tenant_roles (id,tenant_id,code,name,scope_type,is_system_managed) values (${collidingCodeRoleId},${tenantId},${`${templateCode}_custom_collision`},'Colliding Custom Role','tenant',false)`;
    });
    await provisionRoleTemplates(tenantId);
    expect(await rolePermissionCodes(tenantId, customRoleId)).toEqual([codeCustom]);
    const [collidingRole] = await inTenant(tenantId, (tx) => tx<{ is_system_managed: boolean }[]>`select is_system_managed from tenant_roles where id=${collidingCodeRoleId}`);
    expect(collidingRole?.is_system_managed).toBe(false); // nunca virou system-managed (requisito 6)
    expect(await rolePermissionCodes(tenantId, collidingCodeRoleId)).toEqual([]); // nunca ganhou permission do template (requisito 5)
  });

  it('works for a tenant provisioned for the first time after the permission already exists (new tenant path)', async () => {
    // fixture com id aleatório, nunca removida depois (mesma justificativa do afterAll acima) —
    // o papel system-managed que `provisionRoleTemplates` cria não pode ser apagado.
    await admin`insert into tenants (id,slug,legal_name,status) values (${freshTenantId},${`san01-fresh-${freshTenantId}`},'SAN-01 Fresh Tenant','active')`;
    await provisionRoleTemplates(freshTenantId);
    const [role] = await inTenant(freshTenantId, (tx) => tx<{ id: string; is_system_managed: boolean }[]>`select id,is_system_managed from tenant_roles where tenant_id=${freshTenantId} and code=${templateCode}`);
    expect(role?.is_system_managed).toBe(true);
    expect(await rolePermissionCodes(freshTenantId, role!.id)).toEqual([codeA, codeB]);
  });
});
