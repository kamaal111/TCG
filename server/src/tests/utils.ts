import crypto from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Hono } from 'hono';
import { Client, Pool } from 'pg';

import type { HonoEnvironment } from '../context.ts';
import type { Database } from '../db/index.ts';
import { authRelations } from '../db/schema/index.ts';
import { STATUS_CODES } from '../constants/http.ts';
import { MIME_TYPES } from '../constants/request.ts';
import { SIGN_UP_ROUTE_PATH } from '../auth/handlers/sign-up.ts';

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

export async function createTestUser(app: Hono<HonoEnvironment>, db: Database) {
  const email = `test_${crypto.randomUUID()}@example.com`;
  const password = 'password123';
  const name = 'Test User';
  const response = await app.request(SIGN_UP_ROUTE_PATH, {
    method: 'POST',
    headers: new Headers({
      'Content-Type': MIME_TYPES.APPLICATION_JSON,
    }),
    body: JSON.stringify({
      email,
      password,
      name,
    }),
  });
  if (response.status !== STATUS_CODES.CREATED) {
    throw new Error(`Failed to create test user: HTTP ${response.status} ${await response.text()}`);
  }

  const user = await db.query.user.findFirst({
    where: { email },
  });
  if (user == null) {
    throw new Error('Failed to find created test user');
  }

  return {
    email,
    name,
    password,
    userId: user.id,
  };
}
