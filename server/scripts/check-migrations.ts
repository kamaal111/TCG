import path from 'node:path';

import z from 'zod';

import { withDeploymentDatabase } from './deployment-database.ts';
import { migrationFailure, readMigrationCatalog } from '../src/db/migration-files.ts';
import { HistorySchema, planMigrations, resolveHistory } from '../src/db/migration-plan.ts';

// This operation never creates or updates the migration ledger.
try {
  const connectionString = z.string().nonempty().parse(process.env.DATABASE_URL);
  const catalog = await readMigrationCatalog(path.resolve('drizzle'));

  const status = await withDeploymentDatabase(connectionString, async client => {
    await client.query('BEGIN READ ONLY');
    const table = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name");
    const exists = z.array(z.object({ name: z.string().nullable() })).parse(table.rows)[0]?.name != null;

    const history = exists
      ? HistorySchema.parse(
          (await client.query('SELECT to_jsonb(m) AS entry FROM drizzle.__drizzle_migrations m ORDER BY id')).rows.map(
            row => z.object({ entry: z.unknown() }).parse(row).entry,
          ),
        )
      : [];

    const identities = new Set(history.map(row => `${row.hash}:${row.created_at}`));

    // Older application releases can still be ready after a newer schema was applied.
    if (catalog.active.every(migration => identities.has(`${migration.hash}:${migration.timestamp}`))) {
      return { protocol: 1, status: 'ready', pending: 0 };
    }

    const { applied } = resolveHistory(catalog, history);
    const pending = planMigrations(catalog, applied).length;

    return { protocol: 1, status: pending ? 'pending' : 'ready', pending };
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(status));
  } else if (status.status === 'ready') {
    console.log('Required database migrations are applied.');
  } else {
    migrationFailure('Migrations are pending.');
  }
} catch {
  console.error(
    'Migration readiness check failed. Verify database connectivity and migration history before retrying.',
  );
  process.exitCode = 1;
}
