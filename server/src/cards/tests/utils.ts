import assert from 'node:assert/strict';

import { sha256Hex } from '@tcg/crypto/sha256';
import type { Hono } from 'hono';
import type { z } from 'zod';

import { StaticScrydexClient } from '../../card-pricing/scrydex/static-client.ts';
import type { PricingSource } from '../../card-pricing/types.ts';
import { buildSearchQuery, todayUTC } from '../../card-pricing/utils/query.ts';
import type { HonoEnvironment } from '../../context.ts';
import type { Database } from '../../db/index.ts';
import { cardPrice } from '../../db/schema/card-pricing.ts';
import { cardMetadata } from '../../db/schema/cards.ts';
import { sessionHeaders } from '../../tests/auth.ts';
import { CREATE_CARD_ROUTE_PATH } from '../routes/create-card.ts';
import { CardCoreFieldsSchema } from '../schemas/fields.ts';
import type { UpdateCard } from '../schemas/payloads.ts';
import { CardWithPriceSchema } from '../schemas/responses.ts';

type FixturePrinting = z.infer<typeof CardCoreFieldsSchema>;

type CardApp = Hono<HonoEnvironment>;

type CardFixture = FixturePrinting & UpdateCard & { priced_card_id?: string };

const appDatabases = new WeakMap<CardApp, Database>();

export function registerCardFixtureDatabase(app: CardApp, db: Database) {
  appDatabases.set(app, db);
}

export const validCardPayload: CardFixture = {
  game: 'one_piece',
  name: 'Monkey D. Luffy',
  set_name: 'Romance Dawn',
  card_number: 'OP01-003',
  purchases: [
    { condition: 'near_mint', quantity: 2, purchase_price: null, currency: null },
    { condition: 'played', quantity: 1, purchase_price: null, currency: null },
  ],
};

export function ownershipPayload({
  game: _game,
  name: _name,
  set_name: _setName,
  card_number: _cardNumber,
  priced_card_id: _printing,
  ...ownership
}: CardFixture): UpdateCard {
  return ownership;
}

export async function seedCatalogPrinting(
  db: Database,
  { game, name, set_name, card_number }: FixturePrinting,
  source: PricingSource,
  variant?: string,
) {
  const query = buildSearchQuery(name, card_number);
  const options = { languages: [], searchBy: 'card' } as const;
  const matches = (await new StaticScrydexClient().searchCards(game, query, options, 1))._unsafeUnwrap().records;
  const match = matches.find(({ card }) => card.name === name && card.cardNumber === card_number);
  const exact = match?.card.pricing.setName === set_name ? match : undefined;

  const key = sha256Hex(JSON.stringify([game, name, set_name, card_number, variant]));

  const pricingCardId = variant == null && exact != null ? exact.card.id : `fixture-${key}`;
  const pricedOn = todayUTC();
  await db
    .insert(cardPrice)
    .values({
      game,
      pricingSource: source,
      pricingCardId,
      name,
      cardNumber: card_number,
      prices: { ...match?.card.pricing, setName: set_name || undefined, variantName: variant },
      raw: match?.raw ?? {},
      pricedOn,
    })
    .onConflictDoNothing();
  const row = await db.query.cardPrice.findFirst({ where: { game, pricingSource: source, pricingCardId, pricedOn } });
  assert(row != null);

  if (row.prices.illustrator != null) {
    await db
      .insert(cardMetadata)
      .values({ game, pricingSource: source, pricingCardId, illustrator: row.prices.illustrator })
      .onConflictDoNothing();
  }

  return row;
}

export async function createCardRequest(app: CardApp, sessionToken: string, payload: CardFixture) {
  let printingID = payload.priced_card_id;

  if (printingID == null) {
    const db = appDatabases.get(app);
    assert(db != null, 'Register a database or supply a catalog printing to create a card fixture');
    printingID = (await seedCatalogPrinting(db, payload, 'scrydex_static')).id;
  }

  return postCard(
    app,
    sessionHeaders(sessionToken),
    JSON.stringify({ ...ownershipPayload(payload), priced_card_id: printingID }),
  );
}

export function postCard(app: CardApp, headers: HeadersInit, body: string) {
  return app.request(CREATE_CARD_ROUTE_PATH, {
    method: 'POST',
    headers,
    body,
  });
}

export async function createTestCard(app: Hono<HonoEnvironment>, sessionToken: string, payload: CardFixture) {
  const response = await createCardRequest(app, sessionToken, payload);
  expect(response.status).toBe(201);

  return CardWithPriceSchema.parse(await response.json());
}

export function requestOwnedPrices(app: Hono<HonoEnvironment>, headers: HeadersInit, ids: readonly string[]) {
  return app.request('/app-api/cards/prices', {
    method: 'POST',
    headers,
    body: JSON.stringify({ card_ids: ids }),
  });
}

export async function csvImportPayload(
  db: Database,
  cards: readonly (Omit<FixturePrinting, 'game'> & {
    game: string;
    id: string;
    notes?: string | null;
    created_at: string;
    updated_at: string;
    purchases: unknown;
  })[],
  source: PricingSource,
) {
  const inputs = await Promise.all(
    cards.map(async input => {
      const printing = await seedCatalogPrinting(db, CardCoreFieldsSchema.parse(input), source);

      return {
        id: input.id,
        notes: input.notes,
        created_at: input.created_at,
        updated_at: input.updated_at,
        purchases: input.purchases,
        priced_card_id: printing.id,
      };
    }),
  );

  return { cards: inputs };
}
