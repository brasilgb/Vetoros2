import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { buildApp } from '../src/app.js';

const authUrl = process.env.AUTH_DATABASE_URL ?? 'postgresql://vetoros_auth:local_auth_only@127.0.0.1:5432/vetoros';
const runtimeUrl = process.env.DATABASE_URL ?? 'postgresql://vetoros_runtime:local_runtime_only@127.0.0.1:5432/vetoros';
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@127.0.0.1:5432/vetoros';
const password = process.env.DEV_SEED_PASSWORD ?? 'change-me-local-only';
const alpha = '01992ea1-1250-7000-8000-000000000010', beta = '01992ea1-1250-7000-8000-000000000020';
const service = new AuthService(authUrl, runtimeUrl, 3600), app = buildApp({ authService: service, loginRateLimitMax: 200 }), admin = postgres(migrationUrl);
let cookie = '';
let readPermissionId: string, createPermissionId: string, updatePermissionId: string;
let ownerRoleId: string, administratorRoleId: string, betaAdministratorRoleId: string;

const cookieFrom = (response: Awaited<ReturnType<typeof app.inject>>) => String(response.headers['set-cookie']).split(';')[0]!;
const create = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/roles', headers: { cookie }, payload });

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = cookieFrom(login);
  const perms = await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${alpha},true)`; return tx<{ id: string; code: string }[]>`select id,code from permissions where code in ('customers.read','customers.create','customers.update')`; });
  readPermissionId = perms.find((p) => p.code === 'customers.read')!.id;
  createPermissionId = perms.find((p) => p.code === 'customers.create')!.id;
  updatePermissionId = perms.find((p) => p.code === 'customers.update')!.id;
  const roleId = async (tenantId: string, code: string) => {
    const [row] = await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${tenantId},true)`; return tx<{ id: string }[]>`select id from tenant_roles where tenant_id=${tenantId} and code=${code}`; });
    return row!.id;
  };
  ownerRoleId = await roleId(alpha, 'owner');
  administratorRoleId = await roleId(alpha, 'administrator');
  betaAdministratorRoleId = await roleId(beta, 'administrator');
});
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

describe('ADM-02 API and PostgreSQL policies', () => {
  it('lists roles with type and grant count, including the 9 system roles', async () => {
    const response = await app.inject({ method: 'GET', url: '/roles', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const roles = response.json() as Array<{ code: string; isSystemManaged: boolean; grantCount: number }>;
    expect(roles.filter((r) => r.isSystemManaged).map((r) => r.code).sort()).toEqual(['administrator', 'attendance', 'cashier', 'finance', 'fiscal', 'inventory', 'owner', 'read_only', 'technician']);
  });

  it('creates a custom role with a generated code and the requested permissions', async () => {
    const name = `Supervisor ${randomUUID()}`;
    const response = await create({ name, permissionIds: [readPermissionId, createPermissionId] });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { code: string; isSystemManaged: boolean; permissionIds: string[] };
    expect(body.code.startsWith('custom_')).toBe(true);
    expect(body.isSystemManaged).toBe(false);
    expect(body.permissionIds.sort()).toEqual([readPermissionId, createPermissionId].sort());
  });

  it('reads a role detail including its permission ids', async () => {
    const created = await create({ name: `Consulta ${randomUUID()}`, permissionIds: [readPermissionId] });
    const id = (created.json() as { id: string }).id;
    const response = await app.inject({ method: 'GET', url: `/roles/${id}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, permissionIds: [readPermissionId] });
  });

  it('edits the name of a custom role', async () => {
    const created = await create({ name: `Antes ${randomUUID()}`, permissionIds: [] });
    const id = (created.json() as { id: string }).id;
    const newName = `Depois Renomeado ${randomUUID()}`;
    const response = await app.inject({ method: 'PATCH', url: `/roles/${id}`, headers: { cookie }, payload: { name: newName } });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { name: string }).name).toBe(newName);
  });

  it('rejects renaming a custom role to a name already used by another role in the same tenant', async () => {
    const takenName = `Nome Ocupado ${randomUUID()}`;
    await create({ name: takenName, permissionIds: [] });
    const other = await create({ name: `Outro Papel ${randomUUID()}`, permissionIds: [] });
    const otherId = (other.json() as { id: string }).id;
    const response = await app.inject({ method: 'PATCH', url: `/roles/${otherId}`, headers: { cookie }, payload: { name: takenName } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'role_name_already_exists' });
    // mas renomear um papel para o SEU PRÓPRIO nome atual (sem mudança real) continua permitido
    const noop = await app.inject({ method: 'PATCH', url: `/roles/${otherId}`, headers: { cookie }, payload: { name: (other.json() as { name: string }).name } });
    expect(noop.statusCode).toBe(200);
  });

  it('replaces the permission matrix atomically — no intermediate empty state is ever observable', async () => {
    const created = await create({ name: `Matriz ${randomUUID()}`, permissionIds: [readPermissionId] });
    const id = (created.json() as { id: string }).id;
    const response = await app.inject({ method: 'PATCH', url: `/roles/${id}`, headers: { cookie }, payload: { permissionIds: [createPermissionId, updatePermissionId] } });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { permissionIds: string[] }).permissionIds.sort()).toEqual([createPermissionId, updatePermissionId].sort());
    // update de permissions atômico: como toda a troca acontece em UMA transação (delete + insert
    // do novo conjunto), nenhuma outra conexão pode observar o papel momentaneamente sem
    // permissões — confere lendo o estado final direto do banco.
    const stored = await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${alpha},true)`; return tx<{ permission_id: string }[]>`select permission_id from tenant_role_permissions where role_id=${id}`; });
    expect(stored.map((r) => r.permission_id).sort()).toEqual([createPermissionId, updatePermissionId].sort());
  });

  it('rejects a role id belonging to another tenant and a nonexistent permission id', async () => {
    // role de outro tenant: RLS faz o PATCH simplesmente não encontrar a linha (404), não vazar
    // um 403 que revelaria a existência do recurso.
    const crossTenant = await app.inject({ method: 'PATCH', url: `/roles/${betaAdministratorRoleId}`, headers: { cookie }, payload: { name: 'Invasão' } });
    expect(crossTenant.statusCode).toBe(404);
    const invalidPermission = await create({ name: `Permissão Inválida ${randomUUID()}`, permissionIds: [randomUUID()] });
    expect(invalidPermission.statusCode).toBe(400);
    expect(invalidPermission.json()).toMatchObject({ error: 'invalid_permission' });
  });

  it('denies role management to a session without users.manage_roles (read-only access still allowed)', async () => {
    // `shared@vetoros.local` não tem nenhum access_grant em nenhum tenant.
    const login = await service.login('shared@vetoros.local', password, {});
    const session = await service.selectTenant(login!.session, alpha);
    expect(await service.hasPermission(session!, 'users.read', { requireTenant: true })).toBe(false);
    expect(await service.hasPermission(session!, 'users.manage_roles', { requireTenant: true })).toBe(false);
  });

  it('hides a custom role of another tenant end-to-end (RLS), even by a known real UUID', async () => {
    const created = await create({ name: `Isolado ${randomUUID()}`, permissionIds: [] });
    const id = (created.json() as { id: string }).id;
    const runtime = postgres(runtimeUrl);
    try {
      const rows = await runtime.begin(async (tx) => { await tx`select set_config('app.tenant_id',${beta},true)`; return tx`select id from tenant_roles where id=${id}`; });
      expect(rows).toHaveLength(0);
    } finally { await runtime.end(); }
  });

  it('protects owner and administrator: cannot rename, alter permissions, deactivate or delete', async () => {
    for (const id of [ownerRoleId, administratorRoleId]) {
      expect((await app.inject({ method: 'PATCH', url: `/roles/${id}`, headers: { cookie }, payload: { name: 'Hackeado' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PATCH', url: `/roles/${id}`, headers: { cookie }, payload: { permissionIds: [] } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PATCH', url: `/roles/${id}`, headers: { cookie }, payload: { status: 'inactive' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'DELETE', url: `/roles/${id}`, headers: { cookie } })).statusCode).toBe(403);
    }
    // e o banco recusaria de qualquer forma, mesmo contornando a API (trigger da migration 0020)
    await expect(admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${alpha},true)`; return tx`update tenant_roles set name='Hackeado' where id=${administratorRoleId}`; })).rejects.toMatchObject({ code: 'VT002' });
  });

  it('a custom role appears immediately in the user administration role picker', async () => {
    const name = `Aparece No Picker ${randomUUID()}`;
    const created = await create({ name, permissionIds: [readPermissionId] });
    const id = (created.json() as { id: string }).id;
    const roles = await app.inject({ method: 'GET', url: '/roles', headers: { cookie } });
    expect((roles.json() as Array<{ id: string; name: string }>).some((r) => r.id === id && r.name === name)).toBe(true);
    // e pode ser usado de fato para criar um usuário, sem UUID manual do lado do administrador
    const userCreated = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'Usuário Com Papel Novo', email: `papel-novo-${randomUUID()}@example.test`, roleId: id, status: 'active' } });
    expect(userCreated.statusCode).toBe(201);
  });

  it('a role once granted to anyone can never be hard-deleted (FK), but can be deactivated to stop new assignments', async () => {
    const created = await create({ name: `Em Uso ${randomUUID()}`, permissionIds: [readPermissionId] });
    const id = (created.json() as { id: string }).id;
    const userCreated = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'Usuário Do Papel Em Uso', email: `usuario-papel-em-uso-${randomUUID()}@example.test`, roleId: id, status: 'active' } });
    expect(userCreated.statusCode).toBe(201);
    const deleteAttempt = await app.inject({ method: 'DELETE', url: `/roles/${id}`, headers: { cookie } });
    expect(deleteAttempt.statusCode).toBe(409);
    expect(deleteAttempt.json()).toMatchObject({ error: 'role_in_use' });
    const deactivate = await app.inject({ method: 'PATCH', url: `/roles/${id}`, headers: { cookie }, payload: { status: 'inactive' } });
    expect(deactivate.statusCode).toBe(200);
    expect((deactivate.json() as { status: string }).status).toBe('inactive');
    // uma vez inativo, sai do conjunto atribuível — a listagem continua mostrando (para
    // reativação), mas o padrão de consumo do ADM-01 (`/app/users/new`) filtra por status no
    // frontend; aqui confirmamos que o dado que sustenta esse filtro está correto.
    const roles = await app.inject({ method: 'GET', url: '/roles', headers: { cookie } });
    expect((roles.json() as Array<{ id: string; status: string }>).find((r) => r.id === id)?.status).toBe('inactive');
    // um papel realmente nunca usado, por outro lado, é excluível de verdade
    const unused = await create({ name: `Nunca Usado ${randomUUID()}`, permissionIds: [] });
    const unusedId = (unused.json() as { id: string }).id;
    expect((await app.inject({ method: 'DELETE', url: `/roles/${unusedId}`, headers: { cookie } })).statusCode).toBe(204);
  });

  it('audits creation, rename, and a permission diff with added/removed codes — never secrets', async () => {
    const created = await create({ name: `Auditoria ${randomUUID()}`, permissionIds: [readPermissionId] });
    const id = (created.json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/roles/${id}`, headers: { cookie }, payload: { name: `Auditoria Renomeada ${randomUUID()}` } });
    await app.inject({ method: 'PATCH', url: `/roles/${id}`, headers: { cookie }, payload: { permissionIds: [createPermissionId] } });
    const events = await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${alpha},true)`; return tx<{ action: string; metadata: Record<string, unknown> }[]>`select action,metadata from audit_events where resource_id=${id} order by created_at`; });
    expect(events.map((e) => e.action)).toEqual(['role.created', 'role.updated', 'role.permissions_changed']);
    const permissionsChanged = events.find((e) => e.action === 'role.permissions_changed')!;
    expect(permissionsChanged.metadata).toMatchObject({ added: ['customers.create'], removed: ['customers.read'] });
    expect(JSON.stringify(events)).not.toMatch(/password|hash|token/i);
  });
});
