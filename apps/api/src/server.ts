import { parseServerEnv } from '@vetoros/config';
import { buildApp } from './app.js';
import { AuthService } from './auth/service.js';

const env = parseServerEnv(process.env);
const authService = new AuthService(env.AUTH_DATABASE_URL, env.DATABASE_URL, env.SESSION_TTL_SECONDS);
const app = buildApp({ authService, secureCookie: env.COOKIE_SECURE, sessionTtlSeconds: env.SESSION_TTL_SECONDS, webOrigin: env.WEB_ORIGIN });
app.addHook('onClose', () => authService.close());
await app.listen({ host: env.API_HOST, port: env.API_PORT });
