import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';
import { eq } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';

import { PRICING_CLIENT_ERROR_REASONS } from '../../card-pricing/client.ts';
import { SEARCH_PRICING_ROUTE_PATH } from '../../card-pricing/routes/search-pricing.ts';
import { PricingSearchResponseSchema } from '../../card-pricing/schemas/responses.ts';
import { CARD_GAME_MAP, PRICING_SOURCES } from '../../card-pricing/types.ts';
import { pricedCardMetadata, serializePricedCard } from '../../card-pricing/utils/pricing.ts';
import { printingKey } from '../../card-pricing/utils/printing-key.ts';
import { todayUTC } from '../../card-pricing/utils/query.ts';
import { APP_API_ROUTE_NAME } from '../../constants/common.ts';
import { cardMetadata, cardPrice, wishlist } from '../../db/schema/index.ts';
import { seedExchangeRate } from '../../forex/tests/utils.ts';
import { sessionHeaders, setPreferredCurrency } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { WISHLIST_ROUTE_NAME } from '../constants.ts';
import { WishlistCardSchema, WishlistPageSchema } from '../schemas/responses.ts';

const path = `${APP_API_ROUTE_NAME}${WISHLIST_ROUTE_NAME}`;

const alternateArt = {
  pricingSource: PRICING_SOURCES.SCRYDEX_STATIC,
  game: CARD_GAME_MAP.ONE_PIECE,
  pricingCardId: 'op05-119:alternate',
  name: 'Monkey.D.Luffy',
  cardNumber: 'OP05-119',
  prices: { variantName: 'Alternate Art', setName: 'Awakening of the New Era' },
} satisfies Omit<typeof cardPrice.$inferInsert, 'pricedOn'>;

const pageSchema = WishlistPageSchema.extend({ entries: z.array(WishlistCardSchema) });

integrationTest(
  'fetches the exact saved printing once per day and displays it in the preferred currency',
  async ({ app, db, authenticatedHeaders, pricingClient }) => {
    const [saved] = await db
      .insert(cardPrice)
      .values([
        {
          ...alternateArt,
          pricedOn: '2026-01-01',
          prices: { ...alternateArt.prices, market: { condition: 'near_mint', currency: 'USD', low: 15 } },
        },
        {
          ...alternateArt,
          pricingCardId: 'op05-119',
          pricedOn: todayUTC(),
          prices: { market: { condition: 'near_mint', currency: 'USD', low: 10 } },
        },
      ])
      .returning();

    assert(saved);

    const lookup = vi.spyOn(pricingClient, 'getCardById').mockResolvedValue(
      ok({
        card: {
          id: saved.pricingCardId,
          name: saved.name,
          cardNumber: saved.cardNumber,
          pricing: {
            ...alternateArt.prices,
            conditionPrices: [
              { condition: 'near_mint', currency: 'USD', low: 25, market: 30 },
              { condition: 'good', currency: 'USD', market: 20 },
            ],
          },
        },
        raw: null,
      }),
    );

    await setPreferredCurrency(app, authenticatedHeaders, 'EUR');
    const headers = authenticatedHeaders;
    expect(
      (
        await app.request(path, {
          method: 'POST',
          headers,
          body: JSON.stringify({ priced_card_id: saved.id }),
        })
      ).status,
    ).toBe(204);

    const readList = async () => {
      const filters = new URLSearchParams({ game: CARD_GAME_MAP.ONE_PIECE, set_name: alternateArt.prices.setName });
      const response = await app.request(`${path}?${filters}`, { headers });
      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);

      const page = WishlistPageSchema.parse(await response.json());
      expect(page.available_set_names).toEqual([alternateArt.prices.setName]);
      expect(page.available_illustrators).toEqual([]);

      return page.entries;
    };

    const [first, concurrent] = await Promise.all([readList(), readList()]);
    expect(first).toEqual(concurrent);
    expect(first).toMatchObject([
      {
        id: saved.id,
        printing_key: printingKey(saved),
        priced_on: `${todayUTC()}T00:00:00.000Z`,
        headline: { amount: 25, currency: 'USD' },
        condition_prices: [
          { condition: 'near_mint', currency: 'USD', low: 25, market: 30 },
          { condition: 'good', currency: 'USD', market: 20 },
        ],
        display: {
          preferred_currency: 'EUR',
          conversion_unavailable: true,
          headline: { amount: 25, currency: 'USD' },
        },
      },
    ]);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(saved.game, saved.pricingCardId);

    await seedExchangeRate(db, {});
    expect(await readList()).toMatchObject([
      {
        display: {
          preferred_currency: 'EUR',
          conversion_unavailable: false,
          condition_prices: [
            { condition: 'near_mint', currency: 'EUR', low: 20, market: 24 },
            { condition: 'good', currency: 'EUR', market: 16 },
          ],
          headline: { amount: 20, currency: 'EUR' },
          market: { market: 24, currency: 'EUR' },
        },
      },
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
  },
);

integrationTest(
  'recovers a missing saved pricing record through the daily search for the exact printing',
  async ({ app, db, authenticatedHeaders: headers, pricingClient }) => {
    const initial = await app.request(`${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina`, {
      headers,
    });

    expect(initial.status).toBe(200);
    const [card] = PricingSearchResponseSchema.parse(await initial.json()).entries;
    assert(card?.printing_key && card.headline);
    expect(
      (
        await app.request(path, {
          method: 'POST',
          headers,
          body: JSON.stringify({ priced_card_id: card.id }),
        })
      ).status,
    ).toBe(204);
    await db.delete(cardPrice).where(eq(cardPrice.id, card.id));
    const search = vi.spyOn(pricingClient, 'searchCards');

    const response = await app.request(path, { headers });
    expect(response.status).toBe(200);
    expect(WishlistPageSchema.parse(await response.json()).entries).toMatchObject([
      {
        id: card.id,
        printing_key: card.printing_key,
        headline: card.headline,
      },
    ]);
    expect(search).toHaveBeenCalledTimes(1);

    const next = await app.request(path, { headers });
    expect(next.status).toBe(200);
    expect(WishlistPageSchema.parse(await next.json()).entries).toMatchObject([{ headline: card.headline }]);
    expect(search).toHaveBeenCalledTimes(1);
  },
);

integrationTest(
  'prices only the requested page and preserves cached prices when a provider lookup fails',
  async ({ app, db, user, authenticatedHeaders, pricingClient }) => {
    const rows = await db
      .insert(cardPrice)
      .values(
        Array.from({ length: 51 }, (_, index) => ({
          ...alternateArt,
          pricingCardId: `op05-119:variant-${index}`,
          pricedOn: index < 2 ? '2026-01-01' : todayUTC(),
          prices:
            index === 2
              ? alternateArt.prices
              : {
                  ...alternateArt.prices,
                  market: { condition: 'near_mint' as const, currency: 'USD' as const, low: 25 },
                },
        })),
      )
      .returning();

    await db.insert(wishlist).values(
      rows.map((row, index) => ({
        userId: user.userId,
        printingKey: printingKey(row),
        card: WishlistCardSchema.parse(pricedCardMetadata(row)),
        savedAt: new Date(Date.UTC(2026, 10, 17, 0, 0, index)),
      })),
    );

    const lookup = vi.spyOn(pricingClient, 'getCardById').mockResolvedValue(
      err({
        reason: PRICING_CLIENT_ERROR_REASONS.INVALID_RESPONSE,
        message: 'Provider fixture did not return a quote',
        isRetryable: false,
      }),
    );

    const first = await app.request(path, { headers: authenticatedHeaders });
    expect(first.status).toBe(200);
    const page = WishlistPageSchema.parse(await first.json());
    expect(page.entries).toHaveLength(50);
    expect(page.entries.filter(entry => entry.headline?.amount === 25)).toHaveLength(48);
    expect(page.entries.at(-2)?.headline).toBeUndefined();
    expect(page.entries.at(-1)).toMatchObject({
      printing_key: printingKey({ ...alternateArt, pricingCardId: 'op05-119:variant-1' }),
    });
    expect(page.entries.at(-1)?.headline).toBeUndefined();
    expect(lookup).toHaveBeenCalledExactlyOnceWith(alternateArt.game, 'op05-119:variant-1');
    assert(page.next_cursor);
    const second = await app.request(`${path}?cursor=${page.next_cursor}`, { headers: authenticatedHeaders });
    expect(second.status).toBe(200);
    expect(WishlistPageSchema.parse(await second.json()).entries).toMatchObject([
      {
        printing_key: printingKey({ ...alternateArt, pricingCardId: 'op05-119:variant-0' }),
      },
    ]);
    expect(lookup).toHaveBeenNthCalledWith(2, alternateArt.game, 'op05-119:variant-0');
  },
);

integrationTest(
  'recognizes the same alternate art across dates and concurrent saves without changing its save time',
  async ({ app, db, authenticatedHeaders }) => {
    const rows = await db
      .insert(cardPrice)
      .values([
        { ...alternateArt, pricedOn: '2026-11-17' },
        { ...alternateArt, pricedOn: '2026-11-18' },
        { ...alternateArt, pricedOn: '2026-11-18', pricingCardId: 'op05-119' },
      ])
      .returning();

    const [today, tomorrow, regular] = rows.map(row => serializePricedCard(row.game, row, 'https://example.com'));
    assert(today);
    assert(tomorrow);
    assert(regular);

    const save = (id: string) => {
      return app.request(path, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify({ priced_card_id: id }),
      });
    };

    expect(today.id).not.toBe(tomorrow.id);
    expect(today.printing_key).toBe(tomorrow.printing_key);
    expect(regular.printing_key).not.toBe(tomorrow.printing_key);
    expect((await save(today.id)).status).toBe(204);
    const saved = await db.select().from(wishlist);
    expect(saved).toHaveLength(1);

    const requests = await Promise.all([save(tomorrow.id), save(today.id)]);
    expect(requests.map(response => response.status)).toEqual([204, 204]);
    expect(await db.select().from(wishlist)).toEqual(saved);
  },
);

integrationTest(
  'isolates the paged list and deletion by account',
  async ({ app, db, user, createUser, authenticatedHeaders }) => {
    const visitor = await createUser({});
    const key = printingKey(alternateArt);

    const [row] = await db
      .insert(cardPrice)
      .values({ ...alternateArt, pricedOn: '2026-11-17' })
      .returning();

    assert(row);
    const card = WishlistCardSchema.parse(serializePricedCard(row.game, row, 'https://example.com'));
    const savedAt = new Date('2026-11-17T10:00:00.000Z');

    const keys = Array.from({ length: 51 }, (_, index) => {
      return printingKey({
        ...alternateArt,
        pricingCardId: `op05-${index}`,
      });
    });

    await db.insert(wishlist).values(
      [...keys, key].map(printingKey => ({
        userId: user.userId,
        printingKey,
        card: { ...card, printing_key: printingKey },
        savedAt,
      })),
    );

    const headers = sessionHeaders(visitor.sessionToken);
    const strangerPage = await app.request(path, { headers });
    expect(await strangerPage.json()).toEqual({
      entries: [],
      next_cursor: null,
      available_set_names: [],
      available_illustrators: [],
    });
    expect((await app.request(`${path}/${key}`, { headers, method: 'DELETE' })).status).toBe(204);

    const first = await app.request(path, { headers: authenticatedHeaders });
    const firstPage = pageSchema.parse(await first.json());
    expect(firstPage.entries).toHaveLength(50);
    assert(firstPage.next_cursor);
    const second = await app.request(`${path}?cursor=${firstPage.next_cursor}`, { headers: authenticatedHeaders });
    const secondPage = pageSchema.parse(await second.json());
    expect(secondPage.entries).toHaveLength(2);
    expect(secondPage.next_cursor).toBeNull();
    expect([...firstPage.entries, ...secondPage.entries].map(entry => entry.printing_key)).toEqual(
      [...keys, key].sort().reverse(),
    );

    const saveForVisitor = await app.request(path, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ priced_card_id: row.id }),
    });

    expect(saveForVisitor.status).toBe(204);
    expect((await app.request(`${path}/${key}`, { method: 'DELETE', headers: authenticatedHeaders })).status).toBe(204);
    const visitorPage = await app.request(path, { headers });
    expect(pageSchema.parse(await visitorPage.json()).entries.map(entry => entry.printing_key)).toEqual([key]);
  },
);

integrationTest(
  'rejects unauthenticated access and invalid or unknown identifiers',
  async ({ app, authenticatedHeaders }) => {
    const headers = authenticatedHeaders;
    expect((await app.request(path)).status).toBe(401);
    expect((await app.request(`${path}/invalid`, { method: 'DELETE', headers })).status).toBe(400);
    expect((await app.request(`${path}?cursor=invalid`, { headers })).status).toBe(400);

    const missing = await app.request(path, {
      method: 'POST',
      headers,
      body: JSON.stringify({ priced_card_id: '550e8400-e29b-41d4-a716-446655440000' }),
    });

    expect(missing.status).toBe(404);
  },
);

integrationTest(
  'annotates shared search results with the current account’s wishlist membership',
  async ({ app, createUser, authenticatedHeaders }) => {
    const visitor = await createUser({});
    const searchPath = `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina`;
    const initial = await app.request(searchPath, { headers: authenticatedHeaders });
    expect(initial.status).toBe(200);
    const [match] = PricingSearchResponseSchema.parse(await initial.json()).entries;
    assert(match);
    expect(match.is_wishlisted).toBe(false);

    const save = await app.request(path, {
      method: 'POST',
      headers: authenticatedHeaders,
      body: JSON.stringify({ priced_card_id: match.id }),
    });

    expect(save.status).toBe(204);

    const ownerSearch = await app.request(searchPath, { headers: authenticatedHeaders });
    const visitorSearch = await app.request(searchPath, { headers: sessionHeaders(visitor.sessionToken) });

    expect(ownerSearch.status).toBe(200);
    expect(visitorSearch.status).toBe(200);
    const owner = PricingSearchResponseSchema.parse(await ownerSearch.json());
    const other = PricingSearchResponseSchema.parse(await visitorSearch.json());
    expect(owner.entries.find(card => card.id === match.id)?.is_wishlisted).toBe(true);
    expect(other.entries.find(card => card.id === match.id)?.is_wishlisted).toBe(false);
  },
);

integrationTest(
  'finds saved Japanese printings by cached or stored English aliases while retaining their saved names',
  async ({ app, db, createUser, authenticatedHeaders }) => {
    const visitor = await createUser({});

    const printing = {
      game: CARD_GAME_MAP.POKEMON,
      pricingSource: PRICING_SOURCES.SCRYDEX_STATIC,
      pricingCardId: 'sv5m_ja-72',
      name: 'ダーテング',
      cardNumber: '072/071',
      prices: { setName: 'Cyber Judge' },
    };

    const [saved, other] = await db
      .insert(cardPrice)
      .values([
        { ...printing, pricedOn: '2026-11-18' },
        { ...printing, pricingCardId: 'another-shiftry', pricedOn: '2026-11-18' },
      ])
      .returning();

    assert(saved && other);

    const save = (id: string, headers: Headers) => {
      return app.request(path, {
        method: 'POST',
        headers,
        body: JSON.stringify({ priced_card_id: id }),
      });
    };

    expect((await save(saved.id, authenticatedHeaders)).status).toBe(204);
    expect((await save(other.id, sessionHeaders(visitor.sessionToken))).status).toBe(204);

    const search = async (query: string) => {
      const response = await app.request(`${path}?${new URLSearchParams({ query })}`, {
        headers: authenticatedHeaders,
      });

      expect(response.status).toBe(200);

      return pageSchema.parse(await response.json()).entries;
    };

    expect(await search('Shiftry')).toEqual([]);
    await db.insert(cardPrice).values([
      { ...printing, pricedOn: '2026-11-17', raw: { translation: { en: { name: 'Shiftry' } } } },
      {
        ...printing,
        pricingSource: PRICING_SOURCES.SCRYDEX_REAL,
        pricedOn: '2026-11-19',
        raw: { translation: { en: { name: 'Wrong alias' } } },
      },
      {
        ...printing,
        pricingCardId: other.pricingCardId,
        pricedOn: '2026-11-19',
        raw: { translation: { en: { name: 'Shiftry' } } },
      },
    ]);

    for (const query of ['  sHiFtRy  ', 'ダーテング', 'Cyber Judge', '072/071']) {
      expect(await search(query)).toMatchObject([{ id: saved.id, name: 'ダーテング' }]);
    }

    expect(await search('Wrong alias')).toEqual([]);
    await db.insert(cardMetadata).values({
      game: printing.game,
      pricingSource: printing.pricingSource,
      pricingCardId: printing.pricingCardId,
      englishSearchAlias: 'Shiftry corrected',
    });
    expect(await search('corrected')).toMatchObject([{ id: saved.id, name: 'ダーテング' }]);
  },
);

integrationTest(
  'searches all saved printings by literal text within the current account',
  async ({ app, db, user, createUser, authenticatedHeaders }) => {
    const visitor = await createUser({});

    const [row] = await db
      .insert(cardPrice)
      .values({ ...alternateArt, pricedOn: '2026-11-17' })
      .returning();

    assert(row);
    const card = WishlistCardSchema.parse(serializePricedCard(row.game, row, 'https://example.com'));

    const newer = Array.from({ length: 51 }, (_, index) => {
      const key = printingKey({ ...alternateArt, pricingCardId: `zoro-${index}` });

      return {
        userId: user.userId,
        printingKey: key,
        card: { ...card, printing_key: key, name: 'Zoro', set_name: 'Romance Dawn', card_number: 'OP01-025' },
        savedAt: new Date('2026-11-18T10:00:00.000Z'),
      };
    });

    await db.insert(wishlist).values([
      ...newer,
      {
        userId: user.userId,
        printingKey: card.printing_key,
        card: { ...card, name: '100% Luffy' },
        savedAt: new Date('2026-11-17T10:00:00.000Z'),
      },
      { userId: visitor.userId, printingKey: card.printing_key, card },
    ]);

    async function list(query: string, cursor?: string) {
      const params = new URLSearchParams({ query, game: CARD_GAME_MAP.ONE_PIECE });
      params.append('set_name', 'Romance Dawn');
      params.append('set_name', 'Awakening of the New Era');

      if (cursor !== undefined) {
        params.set('cursor', cursor);
      }

      const response = await app.request(`${path}?${params}`, { headers: authenticatedHeaders });
      expect(response.status).toBe(200);

      return pageSchema.parse(await response.json());
    }

    for (const query of ['  lUfFy  ', 'the new era', 'op05-119', '%']) {
      const page = await list(query);
      expect(page.entries.map(entry => entry.name)).toEqual(['100% Luffy']);
      expect(page.next_cursor).toBeNull();
    }

    expect(await list('Pikachu')).toMatchObject({ entries: [], next_cursor: null });

    const first = await list('Zoro');
    expect(first.entries).toHaveLength(50);
    assert(first.next_cursor);
    const second = await list('Zoro', first.next_cursor);
    expect(second.next_cursor).toBeNull();
    expect(second.available_set_names).toEqual(first.available_set_names);
    expect([...first.entries, ...second.entries].map(entry => entry.printing_key)).toEqual(
      newer
        .map(entry => entry.printingKey)
        .sort()
        .reverse(),
    );
  },
);

integrationTest('rejects blank and overlong wishlist queries', async ({ app, authenticatedHeaders }) => {
  for (const query of ['   ', 'a'.repeat(201)]) {
    const response = await app.request(`${path}?${new URLSearchParams({ query })}`, { headers: authenticatedHeaders });
    expect(response.status).toBe(400);
  }
});

integrationTest(
  'lists complete account and game choices and filters saved Pokémon by catalog or saved illustrator',
  async ({ app, db, user, createUser, authenticatedHeaders }) => {
    const visitor = await createUser({});

    const [row] = await db
      .insert(cardPrice)
      .values({
        pricingSource: PRICING_SOURCES.SCRYDEX_STATIC,
        game: CARD_GAME_MAP.POKEMON,
        pricingCardId: 'wishlist-pikachu',
        name: 'Pikachu',
        cardNumber: '160',
        pricedOn: '2026-11-17',
        prices: { setName: 'Crown Zenith' },
      })
      .returning();

    assert(row);
    const baseCard = WishlistCardSchema.parse(serializePricedCard(row.game, row, 'https://example.com'));

    await db.insert(cardMetadata).values({
      game: row.game,
      pricingSource: row.pricingSource,
      pricingCardId: row.pricingCardId,
      illustrator: 'Mitsuhiro Arita',
    });

    function savedCard(pricingCardId: string, fields: Partial<typeof baseCard>, savedAt: string, userId: string) {
      const key = printingKey({
        pricingSource: PRICING_SOURCES.SCRYDEX_STATIC,
        game: fields.game ?? baseCard.game,
        pricingCardId,
      });

      return {
        userId,
        printingKey: key,
        card: { ...baseCard, ...fields, printing_key: key },
        savedAt: new Date(savedAt),
      };
    }

    const old = '2026-11-18T10:00:00.000Z';
    const recent = '2026-11-19T10:00:00.000Z';

    const fallback = savedCard(
      'wishlist-existing',
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        illustrator: 'Mitsuhiro Arita',
      },
      old,
      user.userId,
    );

    const newer = Array.from({ length: 51 }, (_, index) => {
      return savedCard(
        `wishlist-other-${index}`,
        { id: fallback.card.id, name: 'Eevee', set_name: 'Base Set', illustrator: 'Ken Sugimori' },
        recent,
        user.userId,
      );
    });

    await db
      .insert(wishlist)
      .values([
        ...newer,
        savedCard(row.pricingCardId, {}, old, user.userId),
        fallback,
        savedCard('wishlist-one-piece', { game: CARD_GAME_MAP.ONE_PIECE, set_name: 'Romance Dawn' }, old, user.userId),
        savedCard(
          'wishlist-private',
          { id: fallback.card.id, set_name: 'Private set', illustrator: 'Private artist' },
          old,
          visitor.userId,
        ),
      ]);

    const first = await app.request(`${path}?game=${CARD_GAME_MAP.POKEMON}`, { headers: authenticatedHeaders });
    const firstPage = pageSchema.parse(await first.json());
    expect(first.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    expect(firstPage.entries).toHaveLength(50);
    expect(firstPage.entries.every(entry => entry.set_name === 'Base Set')).toBe(true);
    expect(firstPage.available_set_names).toEqual(['Base Set', 'Crown Zenith']);
    expect(firstPage.available_illustrators).toEqual(['Ken Sugimori', 'Mitsuhiro Arita']);

    const criteria = new URLSearchParams({
      game: CARD_GAME_MAP.POKEMON,
      query: 'Pikachu',
      set_name: 'Crown Zenith',
      illustrator: 'mitsuhiro arita',
    });

    const filtered = await app.request(`${path}?${criteria}`, { headers: authenticatedHeaders });
    const filteredPage = pageSchema.parse(await filtered.json());

    expect(filtered.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    expect(filteredPage.entries.map(entry => entry.printing_key).sort()).toEqual(
      [baseCard.printing_key, fallback.printingKey].sort(),
    );
    expect(filteredPage.entries.every(entry => entry.illustrator === 'Mitsuhiro Arita')).toBe(true);
    expect(filteredPage.available_set_names).toEqual(firstPage.available_set_names);
    expect(filteredPage.available_illustrators).toEqual(firstPage.available_illustrators);
    expect(filteredPage.next_cursor).toBeNull();
  },
);

integrationTest('rejects illustrator filtering for One Piece', async ({ app, authenticatedHeaders }) => {
  const params = new URLSearchParams({ game: CARD_GAME_MAP.ONE_PIECE, illustrator: 'Mitsuhiro Arita' });
  const response = await app.request(`${path}?${params}`, { headers: authenticatedHeaders });
  expect(response.status).toBe(CONTENTFUL_STATUS_CODES.BAD_REQUEST);
  expect(await response.json()).toMatchObject({ code: 'INVALID_PAYLOAD' });
});
