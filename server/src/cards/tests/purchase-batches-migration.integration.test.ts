import fs from 'node:fs/promises';

import { sql } from 'drizzle-orm';

import { createCardRequest } from './utils.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { CardSchema } from '../schemas/responses.ts';

integrationTest('migrates every existing condition quantity to an unpriced purchase batch', async ({ app, db }) => {
  const user = await createTestUser(app, db);
  const created = CardSchema.parse(await (await createCardRequest(app, user.sessionToken)).json());
  const quantities = await db.query.cardConditionQuantity.findMany({ where: { cardId: created.id } });
  await db.execute(sql`drop table card_purchase_batch`);

  const migration = await fs.readFile(
    new URL('../../../drizzle/20261008073449_cooing_klaw/migration.sql', import.meta.url),
    'utf8',
  );

  await db.execute(sql.raw(migration));
  const batches = await db.query.cardPurchaseBatch.findMany({ where: { cardId: created.id } });
  expect(batches).toHaveLength(quantities.length);
  expect(
    batches.map(batch => ({ condition: batch.condition, quantity: batch.quantity, createdAt: batch.createdAt })),
  ).toEqual(quantities.map(row => ({ condition: row.condition, quantity: row.quantity, createdAt: row.createdAt })));
  expect(
    batches.every(
      batch => batch.purchasePrice === null && batch.currency === null && batch.automaticPriceDate === null,
    ),
  ).toBe(true);
  expect(await db.query.card.findFirst({ where: { id: created.id } })).toMatchObject({ name: created.name });
});
