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
let administratorRoleAlpha: string, readOnlyRoleAlpha: string, administratorRoleBeta: string;

const cookieFrom = (response: Awaited<ReturnType<typeof app.inject>>) => String(response.headers['set-cookie']).split(';')[0]!;
const roleId = async (tenantId: string, code: string) => {
  const [row] = await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${tenantId},true)`; return tx<{ id: string }[]>`select id from tenant_roles where tenant_id=${tenantId} and code=${code}`; });
  return row!.id;
};

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'single@vetoros.local', password } });
  cookie = cookieFrom(login);
  administratorRoleAlpha = await roleId(alpha, 'administrator');
  readOnlyRoleAlpha = await roleId(alpha, 'read_only');
  administratorRoleBeta = await roleId(beta, 'administrator');
});
afterAll(async () => { await app.close(); await service.close(); await admin.end(); });

describe('ADM-01 API and PostgreSQL policies', () => {
  it('creates a user with a brand-new identity, returns a one-time temporary password, and never leaks it in audit', async () => {
    const email = `novo-${randomUUID()}@example.test`;
    const response = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'Fulano Novo', email, roleId: readOnlyRoleAlpha, status: 'active' } });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; temporaryPassword?: string };
    expect(body.temporaryPassword).toBeTruthy();
    expect(body.temporaryPassword!.length).toBeGreaterThanOrEqual(8);
    const events = await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${alpha},true)`; return tx<{ metadata: Record<string, unknown> }[]>`select metadata from audit_events where resource_id=${body.id} and action='user.created'`; });
    expect(JSON.stringify(events)).not.toContain(body.temporaryPassword);
    expect(JSON.stringify(events)).not.toMatch(/password/i);
  });

  it('reuses an existing Identity across tenants without touching its password or fabricating one', async () => {
    // Identity fresca criada direto no banco (sem passar pelo módulo de usuários) para simular
    // com segurança "Identity já existente, sem membership em nenhum tenant ainda" — seção 21 do
    // correio.md. Não reaproveita nenhuma identity do seed: uma vez que `POST /users` gera um
    // audit_event referenciando o profile criado, esse profile nunca mais pode ser fisicamente
    // apagado (audit_events é append-only, com FK para tenant_user_profiles) — usar uma identity
    // fixa do seed e tentar "limpar" entre execuções da suíte não é uma estratégia válida aqui.
    const preexistingEmail = `existente-${randomUUID()}@example.test`;
    await admin`insert into identities (email_normalized,display_name,status) values (${preexistingEmail},'Já Existente','active')`;
    const response = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'Sem Membership Ainda', email: preexistingEmail, roleId: readOnlyRoleAlpha, status: 'active' } });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { temporaryPassword?: string };
    expect(body.temporaryPassword).toBeUndefined();
  });

  it('rejects creating a second membership for the same identity in the same tenant', async () => {
    const email = `duplicado-${randomUUID()}@example.test`;
    const first = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'Primeiro', email, roleId: readOnlyRoleAlpha, status: 'active' } });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'Segundo', email, roleId: readOnlyRoleAlpha, status: 'active' } });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: 'membership_already_exists' });
  });

  it('rejects an unknown role and a role that belongs to another tenant', async () => {
    const email = () => `role-invalida-${randomUUID()}@example.test`;
    expect((await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'X', email: email(), roleId: randomUUID(), status: 'active' } })).statusCode).toBe(400);
    // `administratorRoleBeta` é um UUID real de um tenant_role — só que do tenant Beta. Sob o
    // contexto de Alpha (RLS), a busca desse id não encontra nada: prova que não é possível
    // atribuir a um usuário um papel de outro tenant só porque o UUID existe.
    const crossTenant = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'X', email: email(), roleId: administratorRoleBeta, status: 'active' } });
    expect(crossTenant.statusCode).toBe(400);
    expect(crossTenant.json()).toMatchObject({ error: 'invalid_role' });
  });

  it('lists, paginates and searches by name and by e-mail prefix', async () => {
    const marker = `Busca${randomUUID().slice(0, 8)}`;
    const email = `${marker.toLowerCase()}@example.test`;
    const created = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: marker, email, roleId: readOnlyRoleAlpha, status: 'active' } });
    expect(created.statusCode).toBe(201);
    const byName = await app.inject({ method: 'GET', url: `/users?search=${marker}&page=1&pageSize=5`, headers: { cookie } });
    expect(byName.statusCode).toBe(200);
    const byNameBody = byName.json() as { items: Array<{ name: string; email: string; role: { name: string } | null }> };
    expect(byNameBody.items.some((row) => row.name === marker && row.email === email && row.role?.name === 'Somente leitura')).toBe(true);
    const byEmail = await app.inject({ method: 'GET', url: `/users?search=${marker.toLowerCase()}&page=1&pageSize=5`, headers: { cookie } });
    expect((byEmail.json() as { items: Array<{ name: string }> }).items.some((row) => row.name === marker)).toBe(true);
  });

  it('shows a read-only, module-grouped list of effective permissions on the detail endpoint', async () => {
    const created = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'Detalhe', email: `detalhe-${randomUUID()}@example.test`, roleId: readOnlyRoleAlpha, status: 'active' } });
    const id = (created.json() as { id: string }).id;
    const detail = await app.inject({ method: 'GET', url: `/users/${id}`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as { role: { code: string }; permissions: Array<{ code: string; module: string }> };
    expect(body.role.code).toBe('read_only');
    expect(body.permissions.length).toBeGreaterThan(0);
    expect(body.permissions.every((p) => p.code.endsWith('.read') || p.code === 'operational.context.select')).toBe(true);
  });

  it('updates name, role and status, and records one audit event per changed dimension', async () => {
    const created = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'Antes', email: `editar-${randomUUID()}@example.test`, roleId: readOnlyRoleAlpha, status: 'active' } });
    const id = (created.json() as { id: string }).id;
    expect((await app.inject({ method: 'PATCH', url: `/users/${id}`, headers: { cookie }, payload: { name: 'Depois' } })).statusCode).toBe(200);
    const roleChange = await app.inject({ method: 'PATCH', url: `/users/${id}`, headers: { cookie }, payload: { roleId: administratorRoleAlpha } });
    expect(roleChange.statusCode).toBe(200);
    expect((roleChange.json() as { role: { code: string } }).role.code).toBe('administrator');
    expect((await app.inject({ method: 'PATCH', url: `/users/${id}`, headers: { cookie }, payload: { status: 'inactive' } })).statusCode).toBe(200);
    // reload confirms persistência (não só o retorno do PATCH)
    const reloaded = await app.inject({ method: 'GET', url: `/users/${id}`, headers: { cookie } });
    expect(reloaded.json()).toMatchObject({ name: 'Depois', status: 'inactive', role: { code: 'administrator' } });
    const events = await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${alpha},true)`; return tx<{ action: string }[]>`select action from audit_events where resource_id=${id} order by created_at`; });
    expect(events.map((e) => e.action)).toEqual(['user.created', 'user.profile_updated', 'user.role_changed', 'user.status_changed']);
  });

  it('denies access without the users.* permissions and hides users of another tenant end-to-end (RBAC and RLS)', async () => {
    const created = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'Isolado', email: `isolado-${randomUUID()}@example.test`, roleId: readOnlyRoleAlpha, status: 'active' } });
    const id = (created.json() as { id: string }).id;
    // `shared@vetoros.local` não tem nenhum access_grant em nenhum tenant (seed) — cobre RBAC.
    const login = await service.login('shared@vetoros.local', password, {});
    const session = await service.selectTenant(login!.session, beta);
    expect(await service.hasPermission(session!, 'users.read', { requireTenant: true })).toBe(false);
    // Prova mais funda: mesmo contornando a API e consultando direto com RLS ativa no contexto
    // de Beta, o profile criado em Alpha é invisível — não é só a permission check que protege.
    const runtime = postgres(runtimeUrl);
    try {
      const rows = await runtime.begin(async (tx) => { await tx`select set_config('app.tenant_id',${beta},true)`; return tx`select id from tenant_user_profiles where id=${id}`; });
      expect(rows).toHaveLength(0);
    } finally { await runtime.end(); }
  });

  it('protects the last administrator: blocks inactivation and role change, allows once a second administrator exists, race-safe under concurrency', async () => {
    // Neutraliza temporariamente (via valid_until, sem tocar status) os access_grants
    // administrativos que já existem em Alpha (ex.: o usuário faker usado pelo E2E) para montar,
    // de forma isolada e sem interferir com outras suítes concorrentes, um cenário controlado de
    // "só resta um administrador". Restaurado no `finally`.
    const existing = await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${alpha},true)`; return tx<{ id: string }[]>`select g.id from access_grants g join tenant_roles r on r.tenant_id=g.tenant_id and r.id=g.role_id where g.tenant_id=${alpha} and r.code in ('owner','administrator') and g.status='active'`; });
    const existingIds = existing.map((row) => row.id);
    try {
      await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${alpha},true)`; await tx`update access_grants set valid_until=now()-interval '1 minute' where id = any(${existingIds})`; });
      const soloEmail = `admin-solo-${randomUUID()}@example.test`;
      const created = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'Admin Solo', email: soloEmail, roleId: administratorRoleAlpha, status: 'active' } });
      expect(created.statusCode).toBe(201);
      const soloId = (created.json() as { id: string }).id;

      const blockInactivate = await app.inject({ method: 'PATCH', url: `/users/${soloId}`, headers: { cookie }, payload: { status: 'inactive' } });
      expect(blockInactivate.statusCode).toBe(409);
      expect(blockInactivate.json()).toMatchObject({ error: 'last_administrator_protected' });
      const blockRoleChange = await app.inject({ method: 'PATCH', url: `/users/${soloId}`, headers: { cookie }, payload: { roleId: readOnlyRoleAlpha } });
      expect(blockRoleChange.statusCode).toBe(409);
      // confirma que nada mudou de fato
      const stillAdmin = await app.inject({ method: 'GET', url: `/users/${soloId}`, headers: { cookie } });
      expect(stillAdmin.json()).toMatchObject({ status: 'active', role: { code: 'administrator' } });

      // com um segundo administrador, a mesma ação passa a ser legítima (seção 11)
      const second = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'Admin Dupla', email: `admin-dupla-${randomUUID()}@example.test`, roleId: administratorRoleAlpha, status: 'active' } });
      expect(second.statusCode).toBe(201);
      const secondId = (second.json() as { id: string }).id;
      expect((await app.inject({ method: 'PATCH', url: `/users/${soloId}`, headers: { cookie }, payload: { status: 'inactive' } })).statusCode).toBe(200);

      // condição de corrida: um TERCEIRO administrador é criado, então "Admin Dupla" e ele viram
      // os dois únicos administradores ativos do tenant — inativar os dois AO MESMO TEMPO deve
      // deixar exatamente um sobrevivente (qual dos dois vence a corrida de lock não importa;
      // importa que nunca os dois consigam passar juntos).
      const third = await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload: { name: 'Admin Tripla', email: `admin-tripla-${randomUUID()}@example.test`, roleId: administratorRoleAlpha, status: 'active' } });
      expect(third.statusCode).toBe(201);
      const thirdId = (third.json() as { id: string }).id;
      const [concurrentA, concurrentB] = await Promise.all([
        app.inject({ method: 'PATCH', url: `/users/${secondId}`, headers: { cookie }, payload: { status: 'inactive' } }),
        app.inject({ method: 'PATCH', url: `/users/${thirdId}`, headers: { cookie }, payload: { status: 'inactive' } }),
      ]);
      const codes = [concurrentA.statusCode, concurrentB.statusCode].sort();
      expect(codes).toEqual([200, 409]);
      const remainingAdmins = await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${alpha},true)`; return tx<{ n: string }[]>`select count(*) as n from access_grants g join tenant_roles r on r.tenant_id=g.tenant_id and r.id=g.role_id join tenant_user_profiles p on p.tenant_id=g.tenant_id and p.id=g.user_profile_id where g.tenant_id=${alpha} and r.code in ('owner','administrator') and g.status='active' and p.status='active' and g.user_profile_id in (${secondId},${thirdId})`; });
      expect(Number(remainingAdmins[0]!.n)).toBe(1);

      // limpeza: com os administradores pré-existentes (ex.: o usuário faker do E2E) restaurados
      // logo abaixo no `finally`, é seguro inativar quem sobrou da corrida — sem isso, cada
      // execução desta suíte deixaria mais um administrador ativo "de sobra" em Alpha, o que
      // quebraria testes/QA manual que assumem quem é (ou não) administrador no tenant.
      // se A (secondId) foi quem conseguiu se inativar (200), sobrou thirdId ativo — e vice-versa.
      const survivorId = concurrentA.statusCode === 200 ? thirdId : secondId;
      await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${alpha},true)`; await tx`update access_grants set valid_until=null where id = any(${existingIds})`; });
      expect((await app.inject({ method: 'PATCH', url: `/users/${survivorId}`, headers: { cookie }, payload: { status: 'inactive' } })).statusCode).toBe(200);
    } finally {
      await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${alpha},true)`; await tx`update access_grants set valid_until=null where id = any(${existingIds})`; });
    }
  });

  it('lists the tenant roles with friendly pt-BR names for the role picker', async () => {
    const response = await app.inject({ method: 'GET', url: '/roles', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const roles = response.json() as Array<{ code: string; name: string }>;
    expect(roles.map((r) => r.code)).toEqual(expect.arrayContaining(['administrator', 'attendance', 'technician', 'read_only']));
    expect(roles.find((r) => r.code === 'administrator')?.name).toBe('Administrador');
  });

  it('GET /branches/:id now returns the same fields as the listing (ADM-01 seção 19)', async () => {
    const branch = await admin.begin(async (tx) => { await tx`select set_config('app.tenant_id',${alpha},true)`; return tx<{ id: string }[]>`select id from branches where tenant_id=${alpha} limit 1`; });
    const response = await app.inject({ method: 'GET', url: `/branches/${branch[0]!.id}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: branch[0]!.id, name: expect.any(String), code: expect.any(String), status: expect.any(String), timezone: expect.any(String) });
  });
});
