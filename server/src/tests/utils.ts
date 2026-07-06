import crypto from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';

import type { Database } from '../db/index.ts';
import { authRelations } from '../db/schema/index.ts';

const BASE_DATABASE_URL = process.env.DATABASE_URL;

if (!BASE_DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

export const createTestDatabase = async (): Promise<{
  db: Database;
  connectionString: string;
  cleanup: () => Promise<void>;
}> => {
  const client = new Client({ connectionString: BASE_DATABASE_URL });
  await client.connect();
  const dbName = `test_db_${crypto.randomUUID().replaceAll('-', '_')}`;
  await client.query(`CREATE DATABASE ${dbName}`);
  await client.end();

  const testDbUrl = BASE_DATABASE_URL.replace(/\/[^/]+$/, `/${dbName}`);
  const pool = new Pool({ connectionString: testDbUrl });
  const testDb = drizzle<typeof authRelations>({ client: pool, relations: authRelations });

  await migrate(testDb, { migrationsFolder: './drizzle' });

  const cleanup = async () => {
    await pool.end();
    const dropClient = new Client({ connectionString: BASE_DATABASE_URL });
    await dropClient.connect();
    await dropClient.query(
      `
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid();
      `,
      [dbName],
    );
    await dropClient.query(`DROP DATABASE ${dbName}`);
    await dropClient.end();
  };

  return { db: testDb, connectionString: testDbUrl, cleanup };
};
