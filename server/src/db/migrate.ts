import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/pg-core/async/session';
import { Client } from 'pg';
import { z } from 'zod';

import { migrationFailure, readMigrationCatalog } from './migration-files.ts';
import { HistorySchema, planMigrations, resolveHistory } from './migration-plan.ts';

export async function migrateDatabase(options: { folder: string; connectionString: string }): Promise<void> {
  const catalog = await readMigrationCatalog(options.folder);
  const client = new Client({ connectionString: options.connectionString, connectionTimeoutMillis: 10_000 });

  try {
    await client.connect();
    const db = drizzle({ client });
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(1952671597, 1)`);
      const latest = await readMigrationCatalog(options.folder);

      if (latest.revision !== catalog.revision) {
        migrationFailure('Migration files changed while waiting for the database lock; retry.');
      }

      const table = await tx.execute(sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS name`);
      const tableExists = z.array(z.object({ name: z.string().nullable() })).parse(table.rows)[0]?.name != null;

      const history = tableExists
        ? HistorySchema.parse(
            (
              await tx.execute(sql`SELECT to_jsonb(m) AS entry FROM drizzle.__drizzle_migrations m ORDER BY id`)
            ).rows.map(row => z.object({ entry: z.unknown() }).parse(row).entry),
          )
        : [];

      const { applied, resolvedHistory } = resolveHistory(catalog, history);

      const pending = planMigrations(catalog, applied);

      if (tableExists) {
        await tx.execute(sql`ALTER TABLE drizzle.__drizzle_migrations ADD COLUMN IF NOT EXISTS name text`);
        await tx.execute(
          sql`ALTER TABLE drizzle.__drizzle_migrations ADD COLUMN IF NOT EXISTS applied_at timestamp with time zone DEFAULT now()`,
        );

        for (const row of resolvedHistory) {
          if (row.name == null) {
            await tx.execute(
              sql`UPDATE drizzle.__drizzle_migrations SET name = ${row.migration.name} WHERE id = ${row.id}`,
            );
          }
        }
      }

      await migrate(pending, tx, { migrationsFolder: options.folder });
      const activeNames = new Set(catalog.active.map(migration => migration.name));

      for (const name of catalog.known.keys()) {
        if (!activeNames.has(name)) {
          await tx.execute(sql`DELETE FROM drizzle.__drizzle_migrations WHERE name = ${name}`);
        }
      }
    });
  } finally {
    await client.end();
  }
}
