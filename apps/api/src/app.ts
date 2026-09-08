import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthResponseSchema } from '@vetoros/contracts';
import type { AuthService } from './auth/service.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerCoreRoutes } from './core/routes.js';
import { registerCustomerRoutes } from './customers/routes.js';
import { registerAssetRoutes } from './assets/routes.js';
import { registerServiceOrderRoutes } from './service-orders/routes.js';
import { registerQuoteRoutes } from './quotes/routes.js';
import { registerInventoryRoutes } from './inventory/routes.js';
import { registerSupplierRoutes } from './suppliers/routes.js';
import { registerPurchaseOrderRoutes } from './purchase-orders/routes.js';
import { registerPurchaseReceiptRoutes } from './purchase-receipts/routes.js';
import { registerPurchaseReturnRoutes } from './purchase-returns/routes.js';
import { registerSaleRoutes } from './sales/routes.js';
import { registerUserRoutes } from './users/routes.js';
import { registerRoleRoutes } from './roles/routes.js';
import { registerAuditRoutes } from './audit/routes.js';
import { registerCashRoutes } from './cash/routes.js';
import { registerReceivableRoutes } from './receivables/routes.js';
import { registerPayableRoutes } from './payables/routes.js';
import { registerFinancialAccountRoutes } from './financial-accounts/routes.js';
import { registerScheduleRoutes } from './schedules/routes.js';
import { registerReportRoutes } from './reports/routes.js';

export function buildApp(options?: { authService?: AuthService; secureCookie?: boolean; sessionTtlSeconds?: number; loginRateLimitMax?: number; webOrigin?: string; trustProxy?: boolean; readinessCheck?: () => Promise<void> }) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', trustProxy: options?.trustProxy ?? false, requestIdHeader: 'x-request-id' });
  void app.register(cors, { origin: options?.webOrigin ?? 'http://localhost:3000', credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    done();
  });
  // ADM-01: "inativar usuário" torna MEMBERSHIP_INACTIVE (lançado por withAuthenticatedTenant
  // quando a sessão corrente pertence a um profile/membership que acabou de ser inativado) um
  // caminho real pela primeira vez — antes disso era um caso de borda raro. Sem este handler,
  // qualquer rota que não passe pelo `authorize()`/hasPermission (que já absorve esse erro)
  // devolveria um 500 cru vazando `error.message`. TENANT_REQUIRED é a mesma ideia para sessões
  // sem tenant ativo chegando a withAuthenticatedTenant.
  app.setErrorHandler((error: Error, request, reply) => {
    if (error.message === 'MEMBERSHIP_INACTIVE') return reply.code(403).send({ error: 'membership_inactive', message: 'Seu acesso a este tenant foi desativado.' });
    if (error.message === 'TENANT_REQUIRED') return reply.code(409).send({ error: 'tenant_required' });
    const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode < 500) return reply.code(statusCode).send({ error: 'invalid_request', requestId: request.id });
    request.log.error({ requestId: request.id, method: request.method, url: request.url, errorType: error.name }, 'unhandled request error');
    return reply.code(500).send({ error: 'internal_server_error', requestId: request.id });
  });
  app.get('/health', async () => healthResponseSchema.parse({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try { await options?.readinessCheck?.(); return healthResponseSchema.parse({ status: 'ok' }); }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  if (options?.authService) {
    registerAuthRoutes(app, options.authService, { secureCookie: options.secureCookie ?? false, ttlSeconds: options.sessionTtlSeconds ?? 28_800, loginRateLimitMax: options.loginRateLimitMax ?? 5 });
    registerCoreRoutes(app, options.authService);
    registerCustomerRoutes(app, options.authService);
    registerAssetRoutes(app, options.authService);
    registerServiceOrderRoutes(app, options.authService);
    registerQuoteRoutes(app, options.authService);
    registerInventoryRoutes(app, options.authService);
    registerSupplierRoutes(app, options.authService);
    registerPurchaseOrderRoutes(app, options.authService);
    registerPurchaseReceiptRoutes(app, options.authService);
    registerPurchaseReturnRoutes(app, options.authService);
    registerSaleRoutes(app, options.authService);
    registerUserRoutes(app, options.authService);
    registerRoleRoutes(app, options.authService);
    registerAuditRoutes(app, options.authService);
    registerCashRoutes(app, options.authService);
    registerReceivableRoutes(app, options.authService);
    registerPayableRoutes(app, options.authService);
    registerFinancialAccountRoutes(app, options.authService);
    registerScheduleRoutes(app, options.authService);
    registerReportRoutes(app, options.authService);
  }
  return app;
}
