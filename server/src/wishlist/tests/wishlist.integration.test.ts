import { z } from 'zod';

import { SEARCH_PRICING_ROUTE_PATH } from '../../card-pricing/routes/search-pricing.ts';
import { PricingSearchResponseSchema } from '../../card-pricing/schemas/responses.ts';
import { PRICING_SOURCES } from '../../card-pricing/types.ts';
import { serializePricedCard } from '../../card-pricing/utils/pricing.ts';
import { printingKey } from '../../card-pricing/utils/printing-key.ts';
import { cardPrice, wishlist } from '../../db/schema/index.ts';
import { sessionHeaders } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { WishlistCardSchema } from '../schemas/responses.ts';

const path = '/app-api/wishlist';

const alternateArt = {
  pricingSource: PRICING_SOURCES.SCRYDEX_STATIC,
  game: 'one_piece',
  pricingCardId: 'op05-119:alternate',
  name: 'Monkey.D.Luffy',
  cardNumber: 'OP05-119',
  prices: { variantName: 'Alternate Art', setName: 'Awakening of the New Era' },
} satisfies Omit<typeof cardPrice.$inferInsert, 'pricedOn'>;

const pageSchema = z.object({ entries: z.array(WishlistCardSchema), next_cursor: z.string().nullable() });

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
    const visitor = await createUser();
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
    expect(await strangerPage.json()).toEqual({ entries: [], next_cursor: null });
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
    const visitor = await createUser();
    const searchPath = `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina`;
    const initial = await app.request(searchPath, { headers: authenticatedHeaders });
    expect(initial.status).toBe(200);
    const [match] = PricingSearchResponseSchema.parse(await initial.json()).matches;
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
    expect(owner.matches.find(card => card.id === match.id)?.is_wishlisted).toBe(true);
    expect(other.matches.find(card => card.id === match.id)?.is_wishlisted).toBe(false);
  },
);
