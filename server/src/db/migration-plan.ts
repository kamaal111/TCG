import type { MigrationMeta } from 'drizzle-orm/migrator';
import { z } from 'zod';

import {
  migrationFailure,
  migrationLeaves,
  migrationMeta,
  type Migration,
  type MigrationCatalog,
} from './migration-files.ts';

export const HistorySchema = z.array(
  z.object({
    id: z.number().int(),
    hash: z.string(),
    created_at: z.coerce.number().int(),
    name: z.string().nullish(),
  }),
);

export function planMigrations(catalog: MigrationCatalog, applied: ReadonlySet<string>): MigrationMeta[] {
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

export function resolveHistory(catalog: MigrationCatalog, history: z.infer<typeof HistorySchema>) {
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

  return { applied, resolvedHistory };
}
