import childProcess from 'node:child_process';
import url from 'node:url';
import util from 'node:util';

import { z } from 'zod';

import { migrationFixture } from './migration-fixture.ts';
import { squashMigrations } from '../migration-files.ts';

const execute = util.promisify(childProcess.execFile);
const script = url.fileURLToPath(new URL('../../../scripts/check-migrations.ts', import.meta.url));

function check(root: string, connectionString: string, args: string[] = ['--json']) {
  return execute(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: connectionString },
  });
}

test('an empty database reports pending migrations without creating the ledger', async t => {
  const fixture = await migrationFixture(t);
  const database = await fixture.database(0);
  const before = (await database.db.$client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name")).rows;
  const result = await check(fixture.root, database.connectionString);
  expect(JSON.parse(result.stdout)).toEqual({ protocol: 1, status: 'pending', pending: 4 });
  expect((await database.db.$client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name")).rows).toEqual(
    before,
  );
});

test('partial legacy history and squash compatibility are inspected without changing data or history', async t => {
  const fixture = await migrationFixture(t);
  const database = await fixture.database(2);
  await database.db.$client.query('ALTER TABLE drizzle.__drizzle_migrations DROP COLUMN name, DROP COLUMN applied_at');
  await squashMigrations({
    folder: fixture.folder,
    first: z.string().parse(fixture.names[0]),
    last: z.string().parse(fixture.names[3]),
  });
  const before = (await database.db.$client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
  const result = await check(fixture.root, database.connectionString);
  expect(JSON.parse(result.stdout)).toEqual({ protocol: 1, status: 'pending', pending: 3 });
  expect((await database.db.$client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows).toEqual(
    before,
  );
  expect((await database.db.$client.query('SELECT * FROM migration_probe')).rows).toEqual([{ id: 1, value: 10 }]);
});

test('a migrated database reports ready in JSON and preserves the plain-text readiness contract', async t => {
  const fixture = await migrationFixture(t);
  const database = await fixture.database(4);
  expect(JSON.parse((await check(fixture.root, database.connectionString)).stdout)).toEqual({
    protocol: 1,
    status: 'ready',
    pending: 0,
  });
  expect((await check(fixture.root, database.connectionString, [])).stdout.trim()).toBe(
    'Required database migrations are applied.',
  );
});

test('corrupted history fails without presenting migrations as safe to run', async t => {
  const fixture = await migrationFixture(t);
  const database = await fixture.database(2);
  await database.db.$client.query("UPDATE drizzle.__drizzle_migrations SET hash = 'changed'");
  await expect(check(fixture.root, database.connectionString)).rejects.toMatchObject({ code: 1, stdout: '' });
  expect((await database.db.$client.query('SELECT * FROM migration_probe')).rows).toEqual([{ id: 1, value: 10 }]);
});

test('unreachable database errors fail without printing the private connection URL', async t => {
  const fixture = await migrationFixture(t);
  await expect(
    check(fixture.root, 'postgres://private-user:private-password@127.0.0.1:1/private-db'),
  ).rejects.toMatchObject({
    code: 1,
    stdout: '',
    stderr: 'Migration readiness check failed. Verify database connectivity and migration history before retrying.\n',
  });
});
