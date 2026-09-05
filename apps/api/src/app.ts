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

export function buildApp(options?: { authService?: AuthService; secureCookie?: boolean; sessionTtlSeconds?: number; loginRateLimitMax?: number; webOrigin?: string }) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  void app.register(cors, { origin: options?.webOrigin ?? 'http://localhost:3000', credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  app.get('/health', async () => healthResponseSchema.parse({ status: 'ok' }));
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
  }
  return app;
}
