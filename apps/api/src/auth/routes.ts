import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthService, AuthSession } from './service.js';

const loginSchema = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(1024) }).strict();
const selectTenantSchema = z.object({ tenantId: z.string().uuid() }).strict();
const cookieName = 'vetoros_session';
const unauthorized = { error: 'unauthorized', message: 'Sessão inválida ou expirada.' };

export function registerAuthRoutes(app: FastifyInstance, service: AuthService, options: { secureCookie: boolean; ttlSeconds: number; loginRateLimitMax: number }) {
  app.register(cookie);
  app.register(rateLimit, { global: false });
  const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: options.secureCookie, path: '/', maxAge: options.ttlSeconds };

  async function authenticated(request: FastifyRequest, reply: FastifyReply): Promise<AuthSession | undefined> {
    const session = await service.session(request.cookies[cookieName]);
    if (!session) { reply.code(401).send(unauthorized); return undefined; }
    return session;
  }

  app.post('/auth/login', { config: { rateLimit: { max: options.loginRateLimitMax, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const result = await service.login(parsed.data.email, parsed.data.password, { ip: request.ip, ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}) });
    if (!result) return reply.code(401).send({ error: 'invalid_credentials', message: 'E-mail ou senha inválidos.' });
    reply.setCookie(cookieName, result.token, cookieOptions);
    return { authenticated: true, tenantSelectionRequired: result.tenants.length !== 1, hasAvailableTenant: result.tenants.length > 0, activeTenantId: result.session.activeTenantId };
  });

  app.get('/auth/session', async (request, reply) => {
    const session = await authenticated(request, reply); if (!session) return;
    return { authenticated: true, identityId: session.identityId, activeTenantId: session.activeTenantId, activeMembershipId: session.activeMembershipId, activeUserProfileId: session.activeUserProfileId, activeCompanyId: session.activeCompanyId, activeBranchId: session.activeBranchId, tenantSelectionRequired: !session.activeTenantId, profile: await service.sessionProfile(session) };
  });

  app.get('/auth/tenants', async (request, reply) => {
    const session = await authenticated(request, reply); if (!session) return;
    return { tenants: await service.tenants(session), activeTenantId: session.activeTenantId };
  });

  app.post('/auth/select-tenant', async (request, reply) => {
    const session = await authenticated(request, reply); if (!session) return;
    const parsed = selectTenantSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const updated = await service.selectTenant(session, parsed.data.tenantId);
    if (!updated) return reply.code(403).send({ error: 'tenant_forbidden', message: 'Tenant indisponível para esta identidade.' });
    return { activeTenantId: updated.activeTenantId };
  });

  app.post('/auth/logout', async (request, reply) => {
    const session = await authenticated(request, reply);
    reply.clearCookie(cookieName, { path: '/' });
    if (!session) return;
    await service.logout(session);
    return reply.code(204).send();
  });
}
