import { sql } from 'drizzle-orm';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/pg-core/async/session';
import { Client } from 'pg';
import { z } from 'zod';

import {
  migrationFailure,
  migrationLeaves,
  migrationMeta,
  readMigrationCatalog,
  type Migration,
  type MigrationCatalog,
} from './migration-files.ts';

const HistorySchema = z.array(
  z.object({
    id: z.number().int(),
    hash: z.string(),
    created_at: z.coerce.number().int(),
    name: z.string().nullish(),
  }),
);

function planMigrations(catalog: MigrationCatalog, applied: ReadonlySet<string>): MigrationMeta[] {
  const covered = new Set<string>();

  for (const name of applied) {
    const migration = catalog.known.get(name);

    if (migration == null) {
      migrationFailure(`Unknown applied migration: ${name}`);
    }

    for (const leaf of migrationLeaves(catalog, migration)) {
      if (covered.has(leaf.name)) {
        migrationFailure(`Overlapping applied migration history: ${name}`);
      }

      covered.add(leaf.name);
    }
  }

  let missing = false;

  for (const leaf of catalog.active.flatMap(migration => migrationLeaves(catalog, migration))) {
    if (!covered.has(leaf.name)) {
      missing = true;
    } else if (missing) {
      migrationFailure(`Applied migration history has a gap before ${leaf.name}.`);
    }
  }

  function pending(migration: Migration): MigrationMeta[] {
    if (applied.has(migration.name)) {
      return [];
    }

    const leaves = migrationLeaves(catalog, migration);

    if (leaves.every(leaf => !covered.has(leaf.name))) {
      return [migrationMeta(migration)];
    }

    if (leaves.every(leaf => covered.has(leaf.name))) {
      return [migrationMeta(migration, '')];
    }

    const sources = catalog.replacements.get(migration.name);

    if (sources == null) {
      migrationFailure(`Cannot reconcile migration: ${migration.name}`);
    }

    return [...sources.flatMap(source => pending(source)), migrationMeta(migration, '')];
  }

  return catalog.active.flatMap(migration => pending(migration));
}

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

      const applied = new Set<string>();

      const resolvedHistory = history.map(row => {
        const migration =
          row.name == null
            ? [...catalog.known.values()].find(
                candidate => candidate.hash === row.hash && candidate.timestamp === row.created_at,
              )
            : catalog.known.get(row.name);

        if (
          migration == null ||
          migration.hash !== row.hash ||
          migration.timestamp !== row.created_at ||
          applied.has(migration.name)
        ) {
          migrationFailure(
            `Unknown or changed database migration: ${row.name ?? row.id}. Restore the matching migration files before retrying.`,
          );
        }

        applied.add(migration.name);

        return { ...row, migration };
      });

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
