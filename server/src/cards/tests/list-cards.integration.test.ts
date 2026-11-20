import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { createCardRequest, validCardPayload, createTestCard } from './utils.ts';
import { StaticScrydexClient } from '../../card-pricing/scrydex/static-client.ts';
import { CARD_GAME_MAP } from '../../card-pricing/types.ts';
import { todayUTC } from '../../card-pricing/utils/query.ts';
import { CollectionSchema } from '../../collections/schemas/responses.ts';
import { cardPrice } from '../../db/schema/card-pricing.ts';
import { card, cardMetadata } from '../../db/schema/cards.ts';
import { appRelations } from '../../db/schema/index.ts';
import { expectErrorResponse } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { LIST_CARDS_ROUTE_PATH } from '../routes/list-cards.ts';
import { CardsListResponseSchema } from '../schemas/responses.ts';

describe('List cards integration', () => {
  integrationTest(
    'backfills each page of linked Pokémon in one statement without calling Scrydex',
    async ({ db, createApp, user, createUser, authenticatedHeaders: headers }) => {
      const otherUser = await createUser();
      const identity = { game: CARD_GAME_MAP.POKEMON, pricingSource: 'scrydex_static' } as const;
      const owned = { ...identity, userId: user.userId, setName: 'Cyber Judge' };
      const shiftry = { ...owned, name: 'ダーテング', cardNumber: '072/071', pricingCardId: 'sv5m_ja-72' };

      const seed = [
        shiftry,
        shiftry,
        { ...owned, name: 'ピカチュウ', cardNumber: '025', pricingCardId: 'pikachu' },
        { ...owned, name: 'イーブイ', cardNumber: '133', pricingCardId: 'eevee' },
        { ...owned, name: 'コダック', cardNumber: '054', pricingCardId: 'psyduck' },
        { ...shiftry, userId: otherUser.userId },
      ];

      await db.insert(card).values(
        seed.map((entry, index) => ({
          ...entry,
          createdAt: new Date(Date.UTC(2026, 0, 10 - index)),
        })),
      );
      const cached = { ...identity, pricedOn: '2026-01-01', prices: {} };

      await db.insert(cardPrice).values([
        {
          ...cached,
          pricingCardId: shiftry.pricingCardId,
          name: shiftry.name,
          cardNumber: shiftry.cardNumber,
          raw: { translation: { en: { name: ' Shiftry ' } } },
        },
        {
          ...cached,
          pricingCardId: shiftry.pricingCardId,
          name: shiftry.name,
          cardNumber: shiftry.cardNumber,
          pricedOn: '2026-01-02',
          raw: { translation: { en: { name: 123 } } },
        },
        {
          ...cached,
          pricingCardId: 'pikachu',
          name: 'ピカチュウ',
          cardNumber: '025',
          raw: { translation: { en: { name: 'Pikachu' } } },
        },
        {
          ...cached,
          pricingCardId: 'eevee',
          name: 'イーブイ',
          cardNumber: '133',
          raw: { translation: { en: { name: 'Eevee' } } },
        },
        {
          ...cached,
          pricingCardId: 'psyduck',
          name: 'コダック',
          cardNumber: '054',
          pricingSource: 'scrydex_real',
          raw: { translation: { en: { name: 'Psyduck' } } },
        },
      ]);
      await db
        .insert(cardMetadata)
        .values({ ...identity, pricingCardId: shiftry.pricingCardId, illustrator: 'Known artist' });

      const logQuery = vi.fn<(query: string, parameters: unknown[]) => void>();
      const loggedDB = drizzle({ client: db.$client, relations: appRelations, logger: { logQuery } });
      const pricingClient = new StaticScrydexClient();
      const search = vi.spyOn(pricingClient, 'searchCards');
      const lookup = vi.spyOn(pricingClient, 'getCardById');
      const app = createApp({ db: loggedDB, pricingClient });

      const list = async (parameters: Record<string, string>) => {
        const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?${new URLSearchParams(parameters)}`, { headers });

        expect(response.status).toBe(200);

        return CardsListResponseSchema.parse(await response.json());
      };

      const page = await list({ limit: '3' });

      expect(page.entries.map(({ name, english_search_alias }) => [name, english_search_alias])).toEqual([
        ['ダーテング', 'Shiftry'],
        ['ダーテング', 'Shiftry'],
        ['ピカチュウ', 'Pikachu'],
      ]);
      expect(page.entries[0]?.illustrator).toBe('Known artist');
      expect(await db.query.cardMetadata.findFirst({ where: { ...identity, pricingCardId: 'eevee' } })).toBeUndefined();
      const firstStatementCount = logQuery.mock.calls.length;

      expect(
        logQuery.mock.calls.filter(([statement]) => statement.includes('insert into "card_metadata"')),
      ).toHaveLength(1);
      logQuery.mockClear();
      await list({ limit: '3' });
      expect(logQuery).toHaveBeenCalledTimes(firstStatementCount - 1);

      const next = await list({ limit: '3', cursor: page.next_cursor ?? '' });

      expect(next.entries.map(({ name, english_search_alias }) => [name, english_search_alias])).toEqual([
        ['イーブイ', 'Eevee'],
        ['コダック', undefined],
      ]);

      for (const query of ['sHiFtRy', 'ダーテング', '072/071']) {
        expect((await list({ query })).entries.map(({ name }) => name)).toEqual(['ダーテング', 'ダーテング']);
      }

      expect((await list({ query: 'Cyber Judge' })).entries).toHaveLength(5);
      expect((await list({ query: 'Psyduck' })).entries).toEqual([]);
      expect((await list({ query: '054' })).entries).toMatchObject([{ name: 'コダック' }]);
      expect(search).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  integrationTest(
    'searches across collections with owned paginated results and literal wildcard characters',
    async ({ app, user: owner, createUser, authenticatedHeaders: headers }) => {
      const other = await createUser();

      const created = await app.request('/app-api/collections', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Favorites' }),
      });

      expect(created.status).toBe(201);
      const collection = CollectionSchema.parse(await created.json());
      const unfiled = await createTestCard(app, owner.sessionToken, validCardPayload);

      const filed = await createTestCard(app, owner.sessionToken, {
        ...validCardPayload,
        collection_id: collection.id,
        card_number: '50%_Luffy',
      });

      await createCardRequest(app, other.sessionToken, validCardPayload);
      const first = await app.request(`${LIST_CARDS_ROUTE_PATH}?query=lUfFy&limit=1`, { headers });
      expect(first.status).toBe(200);
      const page = CardsListResponseSchema.parse(await first.json());
      expect(page.entries.map(card => card.id)).toEqual([filed.id]);
      expect(page.next_cursor).toEqual(expect.any(String));

      const next = await app.request(`${LIST_CARDS_ROUTE_PATH}?query=lUfFy&limit=1&cursor=${page.next_cursor}`, {
        headers,
      });

      expect(next.status).toBe(200);
      const last = CardsListResponseSchema.parse(await next.json());
      expect(last.entries.map(card => card.id)).toEqual([unfiled.id]);
      expect(last.next_cursor).toBeNull();
      const literal = await app.request(`${LIST_CARDS_ROUTE_PATH}?query=${encodeURIComponent('%_')}`, { headers });
      expect(literal.status).toBe(200);
      expect(CardsListResponseSchema.parse(await literal.json()).entries.map(card => card.id)).toEqual([filed.id]);

      const scoped = await app.request(`${LIST_CARDS_ROUTE_PATH}?query=dawn&collection_id=${collection.id}`, {
        headers,
      });

      expect(scoped.status).toBe(200);
      expect(CardsListResponseSchema.parse(await scoped.json()).entries.map(card => card.id)).toEqual([filed.id]);
    },
  );

  integrationTest('requires an authenticated session', async ({ app }) => {
    const response = await app.request(LIST_CARDS_ROUTE_PATH);
    expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.UNAUTHORIZED)).toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });

  integrationTest('returns an empty collection for a fresh user', async ({ app, authenticatedHeaders }) => {
    const response = await app.request(LIST_CARDS_ROUTE_PATH, { headers: authenticatedHeaders });
    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    expect(await response.json()).toEqual({
      entries: [],
      available_set_names: [],
      available_illustrators: [],
      next_cursor: null,
    });
  });

  integrationTest(
    'returns only the session user cards newest first and logs success',
    async ({ app, getLogsForRequestId, withRequestId, user: owner, createUser, authenticatedHeaders }) => {
      const otherUser = await createUser();
      const first = await createTestCard(app, owner.sessionToken, validCardPayload);

      const second = await createTestCard(app, owner.sessionToken, {
        ...validCardPayload,
        game: 'pokemon',
        name: 'Pikachu',
        set_name: 'Base Set',
        card_number: '58/102',
        purchases: [{ condition: 'mint', quantity: 1, purchase_price: null, currency: null }],
      });

      await createCardRequest(app, otherUser.sessionToken, validCardPayload);

      const { headers, requestId } = withRequestId(authenticatedHeaders);
      const response = await app.request(LIST_CARDS_ROUTE_PATH, { headers });
      const body = CardsListResponseSchema.parse(await response.json());

      expect(body.entries.map(card => card.id)).toEqual([second.id, first.id]);
      expect(
        body.entries[0]?.purchases.map(({ condition, quantity }) => ({
          condition,
          quantity,
          purchase_price: null,
          currency: null,
        })),
      ).toEqual([{ condition: 'mint', quantity: 1, purchase_price: null, currency: null }]);
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: 'cards.list', result_count: 2 })]),
      );
    },
  );

  integrationTest('filters the session user collection by game', async ({ app, user: owner, authenticatedHeaders }) => {
    const onePiece = await createTestCard(app, owner.sessionToken, validCardPayload);
    await createCardRequest(app, owner.sessionToken, {
      ...validCardPayload,
      game: 'pokemon',
      name: 'Pikachu',
      set_name: 'Base Set',
      card_number: '58/102',
    });

    const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?game=one_piece`, {
      headers: authenticatedHeaders,
    });

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    const body = CardsListResponseSchema.parse(await response.json());
    expect(body.entries.map(card => card.id)).toEqual([onePiece.id]);
  });

  integrationTest(
    'combines game and repeated exact sets while retaining all owned set choices',
    async ({ app, user: owner, createUser, authenticatedHeaders }) => {
      const otherUser = await createUser();
      const first = await createTestCard(app, owner.sessionToken, validCardPayload);
      const specialSet = 'Special, Set & + 日本語';

      const second = await createTestCard(app, owner.sessionToken, { ...validCardPayload, set_name: specialSet });

      await createCardRequest(app, owner.sessionToken, { ...validCardPayload, set_name: 'Unselected set' });
      await createCardRequest(app, owner.sessionToken, { ...validCardPayload, game: 'pokemon' });
      await createCardRequest(app, otherUser.sessionToken, { ...validCardPayload, set_name: 'Other user only' });
      const query = new URLSearchParams({ game: 'one_piece' });
      query.append('set_name', specialSet);
      query.append('set_name', first.set_name);
      query.append('set_name', specialSet);

      const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?${query}`, {
        headers: authenticatedHeaders,
      });

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      const body = CardsListResponseSchema.parse(await response.json());
      expect(body.entries.map(card => card.id)).toEqual([second.id, first.id]);
      expect(
        body.entries.map(card => {
          return card.purchases.map(({ condition, quantity }) => ({
            condition,
            quantity,
            purchase_price: null,
            currency: null,
          }));
        }),
      ).toEqual([
        expect.arrayContaining(validCardPayload.purchases),
        expect.arrayContaining(validCardPayload.purchases),
      ]);
      expect(body.available_set_names).toEqual(['Romance Dawn', specialSet, 'Unselected set']);
    },
  );

  integrationTest(
    'filters one set across games and deduplicates available names',
    async ({ app, user: owner, authenticatedHeaders }) => {
      const first = await createTestCard(app, owner.sessionToken, validCardPayload);

      const second = await createTestCard(app, owner.sessionToken, { ...validCardPayload, game: 'pokemon' });

      await createCardRequest(app, owner.sessionToken, { ...validCardPayload, set_name: 'Other set' });
      const query = new URLSearchParams({ set_name: first.set_name });

      const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?${query}`, {
        headers: authenticatedHeaders,
      });

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      const body = CardsListResponseSchema.parse(await response.json());
      expect(body.entries.map(card => card.id)).toEqual([second.id, first.id]);
      expect(body.available_set_names).toEqual(['Other set', 'Romance Dawn']);
    },
  );

  integrationTest(
    'reads a bounded card page and complete set choices when no selected sets match',
    async ({ app, db, createApp, user: owner, authenticatedHeaders }) => {
      await createCardRequest(app, owner.sessionToken, validCardPayload);
      const query = new URLSearchParams();
      query.append('set_name', 'romance dawn');
      query.append('set_name', 'Unknown');

      const statements: string[] = [];

      const observedDB = drizzle({
        client: db.$client,
        relations: appRelations,
        logger: { logQuery: query => statements.push(query) },
      });

      const observedApp = createApp({ db: observedDB, pricingClient: new StaticScrydexClient() });

      const response = await observedApp.request(`${LIST_CARDS_ROUTE_PATH}?${query}`, {
        headers: authenticatedHeaders,
      });

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(CardsListResponseSchema.parse(await response.json())).toEqual({
        entries: [],
        available_set_names: ['Romance Dawn'],
        available_illustrators: [],
        next_cursor: null,
      });
      expect(statements.filter(statement => statement.includes('from "card"'))).toHaveLength(3);
    },
  );

  integrationTest(
    'returns no cards or sets when only other games and users own cards',
    async ({ app, user: owner, createUser, authenticatedHeaders }) => {
      const otherUser = await createUser();
      await createCardRequest(app, owner.sessionToken, { ...validCardPayload, game: 'pokemon' });
      await createCardRequest(app, otherUser.sessionToken, validCardPayload);

      const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?game=one_piece`, {
        headers: authenticatedHeaders,
      });

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(CardsListResponseSchema.parse(await response.json())).toEqual({
        entries: [],
        available_set_names: [],
        available_illustrators: [],
        next_cursor: null,
      });
    },
  );

  for (const setName of ['', 'x'.repeat(201)]) {
    integrationTest(`rejects a set name with ${setName.length} characters`, async ({ app, authenticatedHeaders }) => {
      const query = new URLSearchParams({ set_name: setName });

      const response = await app.request(`${LIST_CARDS_ROUTE_PATH}?${query}`, {
        headers: authenticatedHeaders,
      });

      expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.BAD_REQUEST)).toMatchObject({
        code: 'INVALID_PAYLOAD',
      });
    });
  }

  integrationTest(
    'returns card details while the pricing lock is held',
    async ({ app, connectionString, db, user, authenticatedHeaders }) => {
      const created = await createTestCard(app, user.sessionToken, validCardPayload);
      const pricingCardId = 'one-piece-pricing-lock-test';
      await db.update(card).set({ pricingCardId, pricingSource: 'scrydex_static' }).where(eq(card.id, created.id));

      const lockHolder = new Client({ connectionString });
      await lockHolder.connect();

      try {
        await lockHolder.query('begin');
        await lockHolder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `pricing:card:scrydex_static:${todayUTC()}:one_piece:${pricingCardId}`,
        ]);

        const response = await app.request(LIST_CARDS_ROUTE_PATH, { headers: authenticatedHeaders });
        const body = CardsListResponseSchema.parse(await response.json());

        expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
        expect(body.entries).toEqual([expect.objectContaining({ id: created.id })]);
      } finally {
        await lockHolder.query('rollback');
        await lockHolder.end();
      }
    },
  );
});
