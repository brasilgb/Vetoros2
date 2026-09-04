import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations/generated',
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? 'postgresql://vetoros_migration:local_migration_only@localhost:5432/vetoros' },
  strict: true,
  verbose: true,
});
