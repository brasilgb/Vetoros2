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
  COOKIE_SECURE: z.string().default('false').transform((value) => value === 'true'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export const parseServerEnv = (env: NodeJS.ProcessEnv): ServerEnv => serverEnvSchema.parse(env);
