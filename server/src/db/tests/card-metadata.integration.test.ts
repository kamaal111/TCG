import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createTestDatabase } from '../../tests/utils.ts';
import { migrateDatabase } from '../migrate.ts';
import { readMigrationCatalog } from '../migration-files.ts';

test('backfills the latest known illustrator once per provider and game from historical caches', async t => {
  const catalog = await readMigrationCatalog('./drizzle');
  const metadataIndex = catalog.active.findIndex(migration => migration.name.endsWith('_card_metadata'));

  expect(metadataIndex).toBeGreaterThan(0);

  const prefix = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-metadata-migration-'));
  t.onTestFinished(() => fs.rm(prefix, { recursive: true, force: true }));

  for (const migration of catalog.active.slice(0, metadataIndex)) {
    await fs.cp(path.join('./drizzle', migration.name), path.join(prefix, migration.name), { recursive: true });
  }

  const database = await createTestDatabase(prefix);
  t.onTestFinished(database.cleanup);
  await database.db.$client.query(`
    INSERT INTO card_price (id, pricing_source, game, pricing_card_id, card_number, name, priced_on, prices, raw)
    VALUES
      ('1', 'scrydex_static', 'pokemon', 'shared', '1', 'Card', '2026-01-01', '{}', '{"artist":" Old Artist "}'),
      ('2', 'scrydex_static', 'pokemon', 'shared', '1', 'Card', '2026-01-02', '{"illustrator":" New Artist "}', '{"artist":"Ignored"}'),
      ('3', 'scrydex_static', 'pokemon', 'shared', '1', 'Card', '2026-01-03', '{"illustrator":" "}', '{"artist":42}'),
      ('4', 'scrydex_real', 'pokemon', 'shared', '1', 'Card', '2026-01-01', '{}', '{"artist":" Real Artist "}'),
      ('5', 'scrydex_static', 'one_piece', 'shared', '1', 'Card', '2026-01-01', '{"illustrator":"Other Game"}', '{}'),
      ('6', 'scrydex_static', 'pokemon', 'unknown', '1', 'Card', '2026-01-01', '{"illustrator":true}', '{"artist":[]}'),
      ('7', 'scrydex_static', 'pokemon', 'raw', '1', 'Card', '2026-01-01', '{"illustrator":" "}', '{"artist":" Raw Artist "}');
  `);
  await migrateDatabase({ folder: './drizzle', connectionString: database.connectionString });

  const metadata = await database.db.query.cardMetadata.findMany({
    orderBy: { pricingSource: 'asc', game: 'asc', pricingCardId: 'asc' },
    columns: { pricingSource: true, game: true, pricingCardId: true, illustrator: true },
  });

  expect(metadata).toEqual([
    { pricingSource: 'scrydex_real', game: 'pokemon', pricingCardId: 'shared', illustrator: 'Real Artist' },
    { pricingSource: 'scrydex_static', game: 'one_piece', pricingCardId: 'shared', illustrator: 'Other Game' },
    { pricingSource: 'scrydex_static', game: 'pokemon', pricingCardId: 'raw', illustrator: 'Raw Artist' },
    { pricingSource: 'scrydex_static', game: 'pokemon', pricingCardId: 'shared', illustrator: 'New Artist' },
  ]);
  await database.db.$client.query(
    "UPDATE card_metadata SET illustrator = 'Preserved' WHERE pricing_source = 'scrydex_real'",
  );
  await migrateDatabase({ folder: './drizzle', connectionString: database.connectionString });
  expect(await database.db.query.cardMetadata.findFirst({ where: { pricingSource: 'scrydex_real' } })).toMatchObject({
    illustrator: 'Preserved',
  });
});
