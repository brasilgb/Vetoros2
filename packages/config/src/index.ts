import { z } from 'zod';

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().url(),
  AUTH_DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
}).superRefine((env, context) => {
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) context.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'COOKIE_SECURE must be true in production' });
  if (env.NODE_ENV === 'production' && !env.WEB_ORIGIN.startsWith('https://')) context.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'WEB_ORIGIN must use HTTPS in production' });
  if (!env.DATABASE_URL.startsWith('postgresql://')) context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'DATABASE_URL must use PostgreSQL' });
  if (!env.AUTH_DATABASE_URL.startsWith('postgresql://')) context.addIssue({ code: 'custom', path: ['AUTH_DATABASE_URL'], message: 'AUTH_DATABASE_URL must use PostgreSQL' });
  if (!env.REDIS_URL.startsWith('redis://') && !env.REDIS_URL.startsWith('rediss://')) context.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'REDIS_URL must use Redis' });
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export const parseServerEnv = (env: NodeJS.ProcessEnv): ServerEnv => serverEnvSchema.parse(env);
