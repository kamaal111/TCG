import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { TestContext } from 'vitest';
import { z } from 'zod';

import { createTestDatabase } from '../../tests/utils.ts';
import { readMigrationCatalog } from '../migration-files.ts';

export async function migrationFixture(t: Pick<TestContext, 'onTestFinished'> = { onTestFinished }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-migrations-'));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'drizzle');
  await fs.mkdir(folder);

  const definitions = [
    {
      name: '20260101000000_create',
      sql: 'CREATE TABLE migration_probe (id integer PRIMARY KEY, value integer NOT NULL);',
    },
    { name: '20260102000000_seed', sql: 'INSERT INTO migration_probe VALUES (1, 10);' },
    { name: '20260103000000_increment', sql: 'UPDATE migration_probe SET value = value + 1;' },
    { name: '20260104000000_append', sql: 'INSERT INTO migration_probe VALUES (2, 20);' },
  ];

  let previous = '00000000-0000-0000-0000-000000000000';

  for (const definition of definitions) {
    const id = crypto.randomUUID();
    await fs.mkdir(path.join(folder, definition.name));
    await fs.writeFile(path.join(folder, definition.name, 'migration.sql'), definition.sql);
    await fs.writeFile(
      path.join(folder, definition.name, 'snapshot.json'),
      JSON.stringify({
        version: '8',
        dialect: 'postgres',
        id,
        prevIds: [previous],
        ddl: [],
      }),
    );
    previous = id;
  }

  const names = definitions.map(definition => definition.name);

  async function database(applied: number) {
    const prefix = path.join(root, `prefix-${crypto.randomUUID()}`);
    await fs.mkdir(prefix);

    for (const name of names.slice(0, applied)) {
      await fs.cp(path.join(folder, name), path.join(prefix, name), { recursive: true });
    }

    const database = await createTestDatabase(prefix);
    t.onTestFinished(database.cleanup);

    return database;
  }

  return { root, folder, names, database };
}

export async function repositoryMigrationFixture(t: Pick<TestContext, 'onTestFinished'>) {
  const { root, folder } = await migrationFixture(t);
  await fs.rm(folder, { recursive: true });
  await fs.cp('./drizzle', folder, { recursive: true });
  const catalog = await readMigrationCatalog(folder);
  const last = z.object({ name: z.string(), timestamp: z.number() }).parse(catalog.active.at(-1));

  const snapshot = z
    .looseObject({ id: z.string() })
    .parse(JSON.parse(await fs.readFile(path.join(folder, last.name, 'snapshot.json'), 'utf8')));

  const timestamp = new Date(last.timestamp + 1000).toISOString().replaceAll(/\D/g, '').slice(0, 14);
  const next = path.join(folder, `${timestamp}_fixture_followup`);
  await fs.mkdir(next);
  await fs.writeFile(path.join(next, 'migration.sql'), 'SELECT 1;');
  await fs.writeFile(
    path.join(next, 'snapshot.json'),
    JSON.stringify({ ...snapshot, id: crypto.randomUUID(), prevIds: [snapshot.id] }),
  );

  return { root, folder };
}

export async function readTree(folder: string): Promise<Record<string, string>> {
  const files = await fs.readdir(folder, { recursive: true, withFileTypes: true });

  const entries = await Promise.all(
    files
      .filter(file => file.isFile())
      .map(async file => {
        const absolute = path.join(file.parentPath, file.name);

        return [path.relative(folder, absolute), await fs.readFile(absolute, 'utf8')];
      }),
  );

  return Object.fromEntries(entries);
}
