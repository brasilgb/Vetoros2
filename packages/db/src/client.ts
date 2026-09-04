import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export const createDatabase = (url: string, options: postgres.Options<Record<string, postgres.PostgresType>> = {}) => {
  const client = postgres(url, { max: 10, ...options });
  return { client, db: drizzle(client, { schema }) };
};

export type Database = ReturnType<typeof createDatabase>['db'];
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
