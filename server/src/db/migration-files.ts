import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { z } from 'zod';

import { InternalServerError } from '../exceptions/index.ts';

const MigrationSchema = z.object({
  name: z.string().regex(/^\d{14}_[a-zA-Z0-9_-]+$/),
  sql: z.string().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  timestamp: z.number().int(),
});

const ArchiveSchema = z.object({
  version: z.literal(1),
  replacements: z.array(
    z.object({
      migration: MigrationSchema,
      sources: z.array(MigrationSchema).min(2),
    }),
  ),
});

const SnapshotSchema = z.looseObject({
  version: z.literal('8'),
  dialect: z.literal('postgres'),
  id: z.uuid(),
  prevIds: z.array(z.uuid()).length(1),
  ddl: z.array(z.unknown()),
});

export type Migration = z.infer<typeof MigrationSchema>;

type Archive = z.infer<typeof ArchiveSchema>;

export interface MigrationCatalog {
  revision: string;
  active: readonly Migration[];
  archive: Archive;
  known: ReadonlyMap<string, Migration>;
  replacements: ReadonlyMap<string, readonly Migration[]>;
}

export function migrationFailure(message: string): never {
  throw new InternalServerError(undefined, { diagnosticMessage: message });
}

function hashSql(sql: string): string {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

function combine(migrations: readonly Migration[]): string {
  return migrations.map(migration => migration.sql).join('\n--> statement-breakpoint\n');
}

function timestampFor(name: string): number {
  const date = `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}T${name.slice(8, 10)}:${name.slice(10, 12)}:${name.slice(12, 14)}Z`;
  const timestamp = Date.parse(date);

  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().replace(/\D/g, '').slice(0, 14) !== name.slice(0, 14)
  ) {
    migrationFailure(`Invalid migration timestamp: ${name}`);
  }

  return timestamp;
}

export function migrationMeta(migration: Migration, sql = migration.sql): MigrationMeta {
  return {
    name: migration.name,
    hash: migration.hash,
    folderMillis: migration.timestamp,
    bps: true,
    sql: sql === '' ? [] : sql.split('--> statement-breakpoint'),
  };
}

function workspaceFor(folder: string): string {
  return path.join(path.dirname(folder), `.${path.basename(folder)}-squash`);
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);

    return true;
  } catch (error) {
    if (z.object({ code: z.literal('ENOENT') }).safeParse(error).success) {
      return false;
    }

    throw error;
  }
}

async function assertNoInterruptedSquash(folder: string): Promise<void> {
  const workspace = workspaceFor(folder);

  if (await exists(workspace)) {
    migrationFailure(
      `Squash workspace exists: ${workspace}. Another squash may be running. If it was interrupted, inspect staged/ and original/ there. If ${folder} is missing, restore original/ to ${folder}; otherwise keep the complete version you intend to use. Remove the squash workspace only after recovery, then retry.`,
    );
  }
}

export async function readMigrationCatalog(folder: string): Promise<MigrationCatalog> {
  await assertNoInterruptedSquash(folder);

  return readCatalog(folder);
}

async function readCatalog(folder: string): Promise<MigrationCatalog> {
  const active = readMigrationFiles({ migrationsFolder: folder }).map(meta =>
    MigrationSchema.parse({
      name: meta.name,
      sql: meta.sql.join('--> statement-breakpoint'),
      timestamp: meta.folderMillis,
      hash: meta.hash,
    }),
  );

  const archivePath = path.join(folder, 'compatibility', 'manifest.json');

  const archive = (await exists(archivePath))
    ? ArchiveSchema.parse(JSON.parse(await fs.readFile(archivePath, 'utf8')))
    : ArchiveSchema.parse({ version: 1, replacements: [] });

  const known = new Map<string, Migration>();
  const replacements = new Map<string, readonly Migration[]>();

  for (const migration of [...active, ...archive.replacements.flatMap(entry => [entry.migration, ...entry.sources])]) {
    if (migration.hash !== hashSql(migration.sql) || migration.timestamp !== timestampFor(migration.name)) {
      migrationFailure(`Migration identity is corrupt: ${migration.name}`);
    }

    const previous = known.get(migration.name);

    if (previous != null && (previous.hash !== migration.hash || previous.timestamp !== migration.timestamp)) {
      migrationFailure(`Conflicting migration identity: ${migration.name}`);
    }

    known.set(migration.name, migration);
  }

  for (const entry of archive.replacements) {
    if (replacements.has(entry.migration.name) || entry.migration.sql !== combine(entry.sources)) {
      migrationFailure(`Invalid squash archive: ${entry.migration.name}`);
    }

    validateOrder(entry.sources);

    if (entry.migration.timestamp !== entry.sources.at(-1)?.timestamp) {
      migrationFailure(`Invalid squash timestamp: ${entry.migration.name}`);
    }

    replacements.set(entry.migration.name, entry.sources);
  }

  validateOrder(active);
  const catalog = { revision: '', active, archive, known, replacements };
  const leaves = active.flatMap(migration => migrationLeaves(catalog, migration));
  validateOrder(leaves);
  const reachable = new Set<string>();

  function visit(migration: Migration): void {
    reachable.add(migration.name);

    for (const source of replacements.get(migration.name) ?? []) {
      visit(source);
    }
  }

  for (const migration of active) {
    visit(migration);
  }

  if (reachable.size !== known.size) {
    migrationFailure('Squash archive contains unreachable migration history.');
  }

  let predecessor = '00000000-0000-0000-0000-000000000000';
  const snapshots: string[] = [];

  for (const migration of active) {
    const content = await fs.readFile(path.join(folder, migration.name, 'snapshot.json'), 'utf8');
    const snapshot = SnapshotSchema.parse(JSON.parse(content));
    snapshots.push(content);

    if (snapshot.prevIds[0] !== predecessor) {
      migrationFailure(`Broken snapshot chain: ${migration.name}`);
    }

    predecessor = snapshot.id;
  }

  return { ...catalog, revision: hashSql(JSON.stringify({ active, archive, snapshots })) };
}

function validateOrder(migrations: readonly Migration[]): void {
  let previous = -Infinity;

  for (const migration of migrations) {
    if (migration.timestamp <= previous) {
      migrationFailure(`Migration order is ambiguous: ${migration.name}`);
    }

    previous = migration.timestamp;
  }
}

export function migrationLeaves(
  catalog: MigrationCatalog,
  migration: Migration,
  ancestors: readonly string[] = [],
): readonly Migration[] {
  if (ancestors.includes(migration.name)) {
    migrationFailure(`Cyclic squash history: ${migration.name}`);
  }

  const sources = catalog.replacements.get(migration.name);

  return sources == null
    ? [migration]
    : sources.flatMap(source => migrationLeaves(catalog, source, [...ancestors, migration.name]));
}

export function planSquash(catalog: MigrationCatalog, first: string, last: string) {
  const start = catalog.active.findIndex(migration => migration.name === first);
  const end = catalog.active.findIndex(migration => migration.name === last);

  if (start < 0 || end <= start) {
    migrationFailure('Select an ordered range containing at least two migrations.');
  }

  const sources = catalog.active.slice(start, end + 1);
  const sql = combine(sources);
  const hash = hashSql(sql);
  const name = `${last.slice(0, 14)}_squashed_${hash.slice(0, 12)}`;

  if (catalog.known.has(name)) {
    migrationFailure(`Squash destination already exists: ${name}`);
  }

  const migration = MigrationSchema.parse({ name, sql, hash, timestamp: timestampFor(name) });

  return { sources, migration };
}

export async function squashMigrations(options: {
  folder: string;
  first: string;
  last: string;
  expectedRevision?: string;
}): Promise<string> {
  const { folder, first, last, expectedRevision } = options;
  const catalog = await readMigrationCatalog(folder);

  if (expectedRevision != null && expectedRevision !== catalog.revision) {
    migrationFailure('Migration files changed since the preview; select the range again.');
  }

  const { sources, migration } = planSquash(catalog, first, last);
  const { name, sql } = migration;

  const firstSnapshot = SnapshotSchema.parse(
    JSON.parse(await fs.readFile(path.join(folder, first, 'snapshot.json'), 'utf8')),
  );

  const lastSnapshot = SnapshotSchema.parse(
    JSON.parse(await fs.readFile(path.join(folder, last, 'snapshot.json'), 'utf8')),
  );

  const workspace = workspaceFor(folder);
  await fs.mkdir(workspace);
  const staged = path.join(workspace, 'staged');
  const original = path.join(workspace, 'original');

  try {
    await fs.cp(folder, staged, { recursive: true });
    await fs.mkdir(path.join(staged, name));
    await fs.writeFile(path.join(staged, name, 'migration.sql'), sql);
    await fs.writeFile(
      path.join(staged, name, 'snapshot.json'),
      `${JSON.stringify({ ...lastSnapshot, prevIds: firstSnapshot.prevIds }, null, 2)}\n`,
    );
    await fs.mkdir(path.join(staged, 'compatibility'), { recursive: true });
    await fs.writeFile(
      path.join(staged, 'compatibility', 'manifest.json'),
      `${JSON.stringify({ version: 1, replacements: [...catalog.archive.replacements, { migration, sources }] }, null, 2)}\n`,
    );

    for (const source of sources) {
      await fs.rm(path.join(staged, source.name), { recursive: true });
    }

    await readCatalog(staged);
    const latest = await readCatalog(folder);

    if (latest.revision !== catalog.revision) {
      migrationFailure('Migration files changed during squash; retry.');
    }

    await fs.rename(folder, original);
    await fs.rename(staged, folder);
  } catch (error) {
    if (!(await exists(folder)) && (await exists(original))) {
      await fs.rename(original, folder);
    }

    throw error;
  } finally {
    if (await exists(folder)) {
      await fs.rm(workspace, { recursive: true });
    }
  }

  return name;
}
