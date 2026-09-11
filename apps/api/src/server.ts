import { parseServerEnv } from '@vetoros/config';
import { buildApp } from './app.js';
import { AuthService } from './auth/service.js';
import { FocusNfeProvider } from './fiscal/provider.js';
import { Redis } from 'ioredis';

const env = parseServerEnv(process.env);
const authService = new AuthService(env.AUTH_DATABASE_URL, env.DATABASE_URL, env.SESSION_TTL_SECONDS);
const redis = new Redis(env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0 });
redis.on('error', () => undefined);
const app = buildApp({
  authService,
  secureCookie: env.COOKIE_SECURE,
  sessionTtlSeconds: env.SESSION_TTL_SECONDS,
  webOrigin: env.WEB_ORIGIN,
  trustProxy: env.TRUST_PROXY,
  fiscalProvider: new FocusNfeProvider(env.FOCUS_NFE_API_KEY),
  readinessCheck: async () => {
    await authService.readiness();
    if (redis.status === 'wait') await redis.connect();
    await redis.ping();
  },
});
app.addHook('onClose', async () => {
  await authService.close();
  if (redis.status === 'ready') await redis.quit(); else redis.disconnect();
});
await app.listen({ host: env.API_HOST, port: env.API_PORT });

let closing = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'graceful shutdown started');
  await app.close();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
