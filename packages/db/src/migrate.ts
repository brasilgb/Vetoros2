import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.js';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
const { client, db } = createDatabase(url, { max: 1 });
try { await migrate(db, { migrationsFolder: new URL('../migrations', import.meta.url).pathname }); }
finally { await client.end(); }
