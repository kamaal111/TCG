import { eq } from 'drizzle-orm';
import z from 'zod';

import { createTestScrydexClient } from './utils.ts';
import { LIST_CARDS_ROUTE_PATH } from '../../cards/routes/list-cards.ts';
import { CardsListResponseSchema } from '../../cards/schemas/responses.ts';
import { createTestCard, validCardPayload } from '../../cards/tests/utils.ts';
import { card, cardMetadata } from '../../db/schema/cards.ts';
import { PostgresCardPricingRepository } from '../../persistence/postgres/card-pricing.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { SEARCH_PRICING_ROUTE_PATH } from '../routes/search-pricing.ts';
import { PricingSearchResponseSchema } from '../schemas/responses.ts';

const ARITA_CARD = {
  id: 'base1-4',
  name: 'Charizard',
  number: '4',
  artist: '  Mitsuhiro Arita  ',
  language_code: 'EN',
};

describe('Illustrator search and owned filtering', () => {
  integrationTest('requires an explicit search mode', async ({ app, authenticatedHeaders }) => {
    const response = await app.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Arita`, {
      headers: authenticatedHeaders,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ context: { validations: [{ path: ['search_by'] }] } });
  });
  integrationTest(
    'searches artist phrases with languages and caches independently from card names',
    async ({ createApp, authenticatedHeaders, db }) => {
      const queries: (string | null)[] = [];

      const app = createApp({
        pricingClient: createTestScrydexClient(async input => {
          const url = z.instanceof(URL).parse(input);
          queries.push(url.searchParams.get('q'));

          return Response.json({ data: [ARITA_CARD] });
        }),
      });

      const illustratorURL = `${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Mitsuhiro%20Arita&search_by=illustrator&languages=en`;
      const first = await app.request(illustratorURL, { headers: authenticatedHeaders });
      expect(first.status).toBe(200);
      expect(PricingSearchResponseSchema.parse(await first.json()).matches[0]).toMatchObject({
        illustrator: 'Mitsuhiro Arita',
        name: 'Charizard',
      });
      const cached = await app.request(illustratorURL, { headers: authenticatedHeaders });
      expect(cached.status).toBe(200);

      const byName = await app.request(
        `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Mitsuhiro%20Arita&languages=en`,
        { headers: authenticatedHeaders },
      );

      expect(byName.status).toBe(200);
      expect(queries).toEqual([
        '(artist:"Mitsuhiro Arita") AND (!language_code:EN)',
        '(name:"Mitsuhiro Arita") AND (!language_code:EN)',
      ]);
      expect(await db.query.cardPriceSearch.findMany()).toHaveLength(2);
      expect(await db.query.cardMetadata.findMany()).toMatchObject([
        {
          pricingSource: 'scrydex_real',
          game: 'pokemon',
          pricingCardId: 'base1-4',
          illustrator: 'Mitsuhiro Arita',
        },
      ]);
    },
  );

  integrationTest(
    'updates shared metadata in batches and preserves credits when a response omits the artist',
    async ({ db, user }) => {
      const repository = new PostgresCardPricingRepository(db, { requireUserId: () => user.userId });
      const identity = { game: 'pokemon', pricingSource: 'scrydex_static' } as const;
      const providerCard = { id: 'shared', name: 'Charizard', cardNumber: '4' };
      await repository.upsertCardPrices([
        {
          ...identity,
          pricedOn: '2026-01-01',
          card: { ...providerCard, pricing: {} },
          raw: { artist: ' Mitsuhiro Arita ' },
        },
        {
          ...identity,
          pricedOn: '2026-01-02',
          card: { ...providerCard, pricing: { illustrator: 'Mitsuhiro Arita' } },
          raw: {},
        },
      ]);
      await db.update(cardMetadata).set({ updatedAt: new Date(0) });
      const known = await db.query.cardMetadata.findMany();
      expect(known).toMatchObject([{ ...identity, pricingCardId: 'shared', illustrator: 'Mitsuhiro Arita' }]);
      await repository.upsertCardPrice({
        ...identity,
        pricedOn: '2026-01-03',
        card: { ...providerCard, pricing: {} },
        raw: { artist: 42 },
      });
      expect(await db.query.cardMetadata.findMany()).toEqual(known);
      await repository.upsertCardPrice({
        ...identity,
        pricedOn: '2026-01-04',
        card: { ...providerCard, pricing: { illustrator: 'Mitsuhiro Arita' } },
        raw: {},
      });
      expect(await db.query.cardMetadata.findMany()).toEqual(known);
      await repository.upsertCardPrice({
        ...identity,
        pricedOn: '2026-01-05',
        card: { ...providerCard, pricing: { illustrator: 'Corrected Credit' } },
        raw: {},
      });
      const corrected = await db.query.cardMetadata.findFirst({ where: { ...identity, pricingCardId: 'shared' } });
      expect(corrected).toMatchObject({ illustrator: 'Corrected Credit' });
      expect(corrected?.updatedAt.getTime()).toBeGreaterThan(0);
    },
  );

  integrationTest(
    'rejects illustrator searches and owned filters for One Piece',
    async ({ app, authenticatedHeaders }) => {
      const search = await app.request(
        `${SEARCH_PRICING_ROUTE_PATH}?game=one_piece&query=Arita&search_by=illustrator`,
        { headers: authenticatedHeaders },
      );

      expect(search.status).toBe(400);
      expect(await search.json()).toMatchObject({ context: { validations: [{ path: ['search_by'] }] } });

      const owned = await app.request(`${LIST_CARDS_ROUTE_PATH}?game=one_piece&illustrator=Arita`, {
        headers: authenticatedHeaders,
      });

      expect(owned.status).toBe(400);
      expect(await owned.json()).toMatchObject({ context: { validations: [{ path: ['illustrator'] }] } });
    },
  );

  integrationTest(
    'filters owned pages through shared metadata without duplicate or cross-user choices',
    async ({ app, db, user, createUser, authenticatedHeaders }) => {
      const other = await createUser();

      const first = await createTestCard(app, user.sessionToken, {
        ...validCardPayload,
        game: 'pokemon',
        name: 'Charizard',
        card_number: '4',
      });

      const second = await createTestCard(app, user.sessionToken, {
        ...validCardPayload,
        game: 'pokemon',
        name: 'Pikachu',
        card_number: '58',
      });

      const third = await createTestCard(app, user.sessionToken, {
        ...validCardPayload,
        game: 'pokemon',
        name: 'Giratina',
        card_number: '69',
      });

      const unknown = await createTestCard(app, user.sessionToken, {
        ...validCardPayload,
        game: 'pokemon',
        name: 'Mew',
        card_number: '1',
      });

      const foreign = await createTestCard(app, other.sessionToken, {
        ...validCardPayload,
        game: 'pokemon',
        name: 'Foreign',
        card_number: '2',
      });

      for (const [owned, identity] of [
        [first, 'arita-one'],
        [second, 'arita-one'],
        [third, 'egawa'],
        [unknown, 'unknown'],
        [foreign, 'foreign'],
      ] as const) {
        await db
          .update(card)
          .set({ pricingCardId: identity, pricingSource: 'scrydex_static' })
          .where(eq(card.id, owned.id));
      }

      await db.insert(cardMetadata).values([
        {
          game: 'pokemon',
          pricingCardId: 'arita-one',
          pricingSource: 'scrydex_static',
          illustrator: 'Mitsuhiro Arita',
        },
        { game: 'pokemon', pricingCardId: 'egawa', pricingSource: 'scrydex_static', illustrator: 'Akira Egawa' },
        { game: 'pokemon', pricingCardId: 'foreign', pricingSource: 'scrydex_static', illustrator: 'Private Artist' },
        { game: 'pokemon', pricingCardId: 'arita-one', pricingSource: 'scrydex_real', illustrator: 'Wrong Source' },
        { game: 'one_piece', pricingCardId: 'arita-one', pricingSource: 'scrydex_static', illustrator: 'Wrong Game' },
      ]);
      const url = `${LIST_CARDS_ROUTE_PATH}?game=pokemon&illustrator=mitsuhiro%20arita&limit=1`;
      const response = await app.request(url, { headers: authenticatedHeaders });
      expect(response.status).toBe(200);
      const page = CardsListResponseSchema.parse(await response.json());
      expect(page.cards.map(entry => entry.id)).toEqual([second.id]);
      expect(page.cards[0]).toMatchObject({ illustrator: 'Mitsuhiro Arita' });
      expect(page.available_illustrators).toEqual(['Akira Egawa', 'Mitsuhiro Arita']);
      expect(page.next_cursor).toEqual(expect.any(String));
      const next = await app.request(`${url}&cursor=${page.next_cursor}`, { headers: authenticatedHeaders });
      expect(next.status).toBe(200);
      const last = CardsListResponseSchema.parse(await next.json());
      expect(last.cards.map(entry => entry.id)).toEqual([first.id]);
      expect(last.next_cursor).toBeNull();

      const combined = await app.request(
        `${LIST_CARDS_ROUTE_PATH}?illustrator=Mitsuhiro%20Arita&illustrator=Akira%20Egawa&query=Giratina`,
        { headers: authenticatedHeaders },
      );

      expect(combined.status).toBe(200);
      expect(CardsListResponseSchema.parse(await combined.json()).cards.map(entry => entry.id)).toEqual([third.id]);

      const missing = await app.request(`${LIST_CARDS_ROUTE_PATH}?illustrator=Nobody`, {
        headers: authenticatedHeaders,
      });

      expect(missing.status).toBe(200);
      expect(CardsListResponseSchema.parse(await missing.json())).toMatchObject({
        cards: [],
        next_cursor: null,
        available_illustrators: ['Akira Egawa', 'Mitsuhiro Arita'],
      });
    },
  );
});
