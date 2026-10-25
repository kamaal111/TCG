import crypto from 'node:crypto';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Hono } from 'hono';
import { Client } from 'pg';
import { inject } from 'vitest';

import { trackPoolShutdown } from './pool-shutdown.ts';
import { SIGN_UP_ROUTE_PATH } from '../auth/constants.ts';
import { CONTENTFUL_STATUS_CODES } from '../constants/http.ts';
import { MIME_TYPES } from '../constants/request.ts';
import type { HonoEnvironment } from '../context.ts';
import { createDatabase, type Database } from '../db/index.ts';
import env from '../env.ts';

export const createTestDatabase = async (
  migrationsFolder: string,
): Promise<{
  db: Database;
  connectionString: string;
  cleanup: () => Promise<void>;
}> => {
  const baseDatabaseUrl = inject('databaseUrl');
  const client = new Client({ connectionString: baseDatabaseUrl });
  await client.connect();
  const dbName = `test_db_${crypto.randomUUID().replaceAll('-', '_')}`;
  await client.query(`CREATE DATABASE ${dbName}`);
  await client.end();

  const testDbUrl = new URL(baseDatabaseUrl);
  testDbUrl.pathname = `/${dbName}`;

  const testDb = createDatabase({
    url: testDbUrl.toString(),
    connectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT_MS,
  });

  const closePool = trackPoolShutdown(testDb.$client);

  await migrate(testDb, { migrationsFolder });

  const cleanup = async () => {
    await closePool();
    const dropClient = new Client({ connectionString: baseDatabaseUrl });

    try {
      await dropClient.connect();
      await dropClient.query(`DROP DATABASE ${dbName}`);
    } finally {
      await dropClient.end();
    }
  };

  return { db: testDb, connectionString: testDbUrl.toString(), cleanup };
};

export async function createTestUser(
  app: Hono<HonoEnvironment>,
  db: Database,
  overrides: Partial<{ password: string }> = {},
) {
  const email = `test_${crypto.randomUUID()}@example.com`;
  const password = overrides.password ?? 'password123';
  const name = 'Test User';

  const response = await app.request(SIGN_UP_ROUTE_PATH, {
    method: 'POST',
    headers: new Headers({
      'Content-Type': MIME_TYPES.JSON,
    }),
    body: JSON.stringify({
      email,
      password,
      name,
    }),
  });

  if (response.status !== CONTENTFUL_STATUS_CODES.CREATED) {
    throw new Error(`Failed to create test user: HTTP ${response.status} ${await response.text()}`);
  }

  const sessionToken = response.headers.get('set-session-token');

  if (sessionToken == null) {
    throw new Error('Failed to retrieve created session token');
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
    sessionToken,
    userId: user.id,
  };
}
