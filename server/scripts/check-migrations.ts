import assert from 'node:assert/strict';
import path from 'node:path';

import z from 'zod';

import { withDeploymentDatabase } from './deployment-database.ts';
import { readMigrationCatalog } from '../src/db/migration-files.ts';

// Read migration history only. Schema changes require the explicit migration command.
try {
  const connectionString = z.string().nonempty().parse(process.env.DATABASE_URL);
  const catalog = await readMigrationCatalog(path.resolve('drizzle'));
  await withDeploymentDatabase(connectionString, async client => {
    const result = await client.query('SELECT hash, created_at FROM "drizzle"."__drizzle_migrations"');
    const history = z.array(z.object({ hash: z.string(), created_at: z.coerce.number().int() })).parse(result.rows);
    const applied = new Set(history.map(row => `${row.hash}:${row.created_at}`));
    assert(
      catalog.active.every(migration => applied.has(`${migration.hash}:${migration.timestamp}`)),
      'Migrations are pending.',
    );
  });
  console.log('Required database migrations are applied.');
} catch {
  console.error(
    'Migration readiness check failed. Run migrations explicitly before releasing and verify database connectivity.',
  );
  process.exitCode = 1;
}
