import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { migrationFixture, repositoryMigrationFixture } from './migration-fixture.ts';
import { createTestDatabase } from '../../tests/utils.ts';
import { migrateDatabase } from '../migrate.ts';
import { readMigrationCatalog, squashMigrations } from '../migration-files.ts';

test.each([0, 1, 2, 3, 4])(
  'preserves data and runs custom SQL exactly once with %i original migrations applied',
  async applied => {
    const fixture = await migrationFixture();
    const database = await fixture.database(applied);

    const baseline = await squashMigrations({
      folder: fixture.folder,
      first: z.string().parse(fixture.names[0]),
      last: z.string().parse(fixture.names[3]),
    });

    await migrateDatabase({ folder: fixture.folder, connectionString: database.connectionString });
    await migrateDatabase({ folder: fixture.folder, connectionString: database.connectionString });
    expect((await database.db.$client.query('SELECT * FROM migration_probe ORDER BY id')).rows).toEqual([
      { id: 1, value: 11 },
      { id: 2, value: 20 },
    ]);
    expect((await database.db.$client.query('SELECT name FROM drizzle.__drizzle_migrations')).rows).toEqual([
      { name: baseline },
    ]);
  },
);

test('catches up a partial middle range and applies the following migration', async t => {
  const fixture = await migrationFixture(t);
  const database = await fixture.database(2);

  const baseline = await squashMigrations({
    folder: fixture.folder,
    first: z.string().parse(fixture.names[1]),
    last: z.string().parse(fixture.names[2]),
  });

  await migrateDatabase({ folder: fixture.folder, connectionString: database.connectionString });
  expect((await database.db.$client.query('SELECT * FROM migration_probe ORDER BY id')).rows).toEqual([
    { id: 1, value: 11 },
    { id: 2, value: 20 },
  ]);
  expect(
    (await database.db.$client.query('SELECT name FROM drizzle.__drizzle_migrations ORDER BY created_at')).rows.map(
      row => row.name,
    ),
  ).toEqual([fixture.names[0], baseline, fixture.names[3]]);
});

test.each([1, 2, 3])('adopts nested squashes from %i original migrations', async applied => {
  const fixture = await migrationFixture();
  const database = await fixture.database(applied);

  const first = await squashMigrations({
    folder: fixture.folder,
    first: z.string().parse(fixture.names[0]),
    last: z.string().parse(fixture.names[1]),
  });

  const final = await squashMigrations({ folder: fixture.folder, first, last: z.string().parse(fixture.names[3]) });
  await migrateDatabase({ folder: fixture.folder, connectionString: database.connectionString });
  expect((await database.db.$client.query('SELECT * FROM migration_probe ORDER BY id')).rows).toEqual([
    { id: 1, value: 11 },
    { id: 2, value: 20 },
  ]);
  expect((await database.db.$client.query('SELECT name FROM drizzle.__drizzle_migrations')).rows).toEqual([
    { name: final },
  ]);
});

test('adopts a previously deployed squash and then runs new migrations', async t => {
  const fixture = await migrationFixture(t);

  const first = await squashMigrations({
    folder: fixture.folder,
    first: z.string().parse(fixture.names[0]),
    last: z.string().parse(fixture.names[1]),
  });

  const database = await createTestDatabase(fixture.folder);
  t.onTestFinished(database.cleanup);
  const final = await squashMigrations({ folder: fixture.folder, first, last: z.string().parse(fixture.names[3]) });
  await migrateDatabase({ folder: fixture.folder, connectionString: database.connectionString });
  const catalog = await readMigrationCatalog(fixture.folder);
  const snapshot = await fs.readFile(path.join(fixture.folder, final, 'snapshot.json'), 'utf8');
  const parsed = z.looseObject({ id: z.string() }).parse(JSON.parse(snapshot));
  const next = path.join(fixture.folder, '20260105000000_later');
  await fs.mkdir(next);
  await fs.writeFile(path.join(next, 'migration.sql'), 'UPDATE migration_probe SET value = value + 2;');
  await fs.writeFile(
    path.join(next, 'snapshot.json'),
    JSON.stringify({ ...parsed, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', prevIds: [parsed.id] }),
  );
  await migrateDatabase({ folder: fixture.folder, connectionString: database.connectionString });
  expect(catalog.active).toHaveLength(1);
  expect((await database.db.$client.query('SELECT * FROM migration_probe ORDER BY id')).rows).toEqual([
    { id: 1, value: 13 },
    { id: 2, value: 22 },
  ]);
});

test('rolls back catch-up SQL and migration bookkeeping together on failure', async t => {
  const fixture = await migrationFixture(t);
  const database = await fixture.database(2);
  await fs.writeFile(
    path.join(fixture.folder, z.string().parse(fixture.names[3]), 'migration.sql'),
    'INSERT INTO missing_table VALUES (1);',
  );
  await squashMigrations({
    folder: fixture.folder,
    first: z.string().parse(fixture.names[0]),
    last: z.string().parse(fixture.names[3]),
  });
  const history = (await database.db.$client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
  await expect(
    migrateDatabase({ folder: fixture.folder, connectionString: database.connectionString }),
  ).rejects.toThrow('missing_table');
  expect((await database.db.$client.query('SELECT * FROM migration_probe')).rows).toEqual([{ id: 1, value: 10 }]);
  expect((await database.db.$client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows).toEqual(
    history,
  );
});

test('rejects changed history without applying SQL or replacing bookkeeping', async t => {
  const fixture = await migrationFixture(t);
  const database = await fixture.database(2);
  await squashMigrations({
    folder: fixture.folder,
    first: z.string().parse(fixture.names[0]),
    last: z.string().parse(fixture.names[3]),
  });
  await database.db.$client.query("UPDATE drizzle.__drizzle_migrations SET hash = 'changed'");
  const history = (await database.db.$client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
  await expect(
    migrateDatabase({ folder: fixture.folder, connectionString: database.connectionString }),
  ).rejects.toThrow('Unknown or changed');
  expect((await database.db.$client.query('SELECT * FROM migration_probe')).rows).toEqual([{ id: 1, value: 10 }]);
  expect((await database.db.$client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows).toEqual(
    history,
  );
});

test('rejects gapped history instead of guessing which SQL to replay', async t => {
  const fixture = await migrationFixture(t);
  const database = await fixture.database(3);
  await database.db.$client.query('DELETE FROM drizzle.__drizzle_migrations WHERE name = $1', [fixture.names[1]]);
  await squashMigrations({
    folder: fixture.folder,
    first: z.string().parse(fixture.names[0]),
    last: z.string().parse(fixture.names[3]),
  });
  await expect(
    migrateDatabase({ folder: fixture.folder, connectionString: database.connectionString }),
  ).rejects.toThrow('gap');
  expect((await database.db.$client.query('SELECT * FROM migration_probe')).rows).toEqual([{ id: 1, value: 11 }]);
});

test('serializes concurrent migration runs so data SQL runs once', async t => {
  const fixture = await migrationFixture(t);
  const database = await fixture.database(2);
  await squashMigrations({
    folder: fixture.folder,
    first: z.string().parse(fixture.names[0]),
    last: z.string().parse(fixture.names[3]),
  });
  await Promise.all([
    migrateDatabase({ folder: fixture.folder, connectionString: database.connectionString }),
    migrateDatabase({ folder: fixture.folder, connectionString: database.connectionString }),
  ]);
  expect((await database.db.$client.query('SELECT * FROM migration_probe ORDER BY id')).rows).toEqual([
    { id: 1, value: 11 },
    { id: 2, value: 20 },
  ]);
  expect((await database.db.$client.query('SELECT * FROM drizzle.__drizzle_migrations')).rows).toHaveLength(1);
});

test('recognizes legacy migration records without names using exact hashes and timestamps', async t => {
  const fixture = await migrationFixture(t);
  const database = await fixture.database(2);
  await database.db.$client.query('ALTER TABLE drizzle.__drizzle_migrations DROP COLUMN name, DROP COLUMN applied_at');
  await squashMigrations({
    folder: fixture.folder,
    first: z.string().parse(fixture.names[0]),
    last: z.string().parse(fixture.names[3]),
  });
  await migrateDatabase({ folder: fixture.folder, connectionString: database.connectionString });
  expect((await database.db.$client.query('SELECT * FROM migration_probe ORDER BY id')).rows).toEqual([
    { id: 1, value: 11 },
    { id: 2, value: 20 },
  ]);
});

test('preserves real users, cards, collections, binder slots, quantities and purchases without rebuilding tables', async t => {
  const { folder } = await repositoryMigrationFixture(t);
  const original = await readMigrationCatalog(folder);
  const database = await createTestDatabase(folder);
  t.onTestFinished(database.cleanup);
  await database.db.$client.query(`
    INSERT INTO "user" (id, name, email) VALUES ('squash-user', 'Collector', 'squash@example.com');
    INSERT INTO card_collection (id, user_id, name) VALUES ('11111111-1111-4111-8111-111111111111', 'squash-user', 'Favorites');
    INSERT INTO card (id, user_id, collection_id, game, name, set_name, card_number, notes)
      VALUES ('22222222-2222-4222-8222-222222222222', 'squash-user', '11111111-1111-4111-8111-111111111111', 'pokemon', 'Pikachu', 'Base Set', '58', 'Keep this card');
    INSERT INTO card_condition_quantity (card_id, condition, quantity)
      VALUES ('22222222-2222-4222-8222-222222222222', 'mint', 2);
    INSERT INTO card_purchase_batch (card_id, condition, quantity, purchase_price, currency)
      VALUES ('22222222-2222-4222-8222-222222222222', 'mint', 2, 12.345678, 'EUR');
    INSERT INTO binder_page (id, collection_id, position)
      VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 1);
    INSERT INTO binder_slot (page_id, card_id, "row", "column", quantity)
      VALUES ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 1, 1, 2);
  `);

  const snapshot = async () =>
    Promise.all([
      database.db.$client.query('SELECT to_jsonb(t) AS record, tableoid FROM "user" t ORDER BY id'),
      database.db.$client.query('SELECT to_jsonb(t) AS record, tableoid FROM card_collection t ORDER BY id'),
      database.db.$client.query('SELECT to_jsonb(t) AS record, tableoid FROM card t ORDER BY id'),
      database.db.$client.query('SELECT to_jsonb(t) AS record, tableoid FROM card_condition_quantity t ORDER BY id'),
      database.db.$client.query('SELECT to_jsonb(t) AS record, tableoid FROM card_purchase_batch t ORDER BY id'),
      database.db.$client.query('SELECT to_jsonb(t) AS record, tableoid FROM binder_page t ORDER BY id'),
      database.db.$client.query('SELECT to_jsonb(t) AS record, tableoid FROM binder_slot t ORDER BY id'),
    ]).then(results => results.map(result => result.rows));

  const before = await snapshot();
  await squashMigrations({
    folder,
    first: z.string().parse(original.active[0]?.name),
    last: z.string().parse(original.active.at(-1)?.name),
  });
  await migrateDatabase({ folder, connectionString: database.connectionString });
  expect(await snapshot()).toEqual(before);
  const fresh = await createTestDatabase(folder);
  t.onTestFinished(fresh.cleanup);

  const columns = `SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`;

  const constraints = `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace ORDER BY conname`;

  expect((await fresh.db.$client.query(columns)).rows).toEqual((await database.db.$client.query(columns)).rows);
  expect((await fresh.db.$client.query(constraints)).rows).toEqual((await database.db.$client.query(constraints)).rows);
});
