import assert from 'node:assert/strict';

import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';
import { and, eq } from 'drizzle-orm';
import { err } from 'neverthrow';
import { Client } from 'pg';

import { imageKeyForOriginURL } from '../../card-images/keys.ts';
import { LIST_CARDS_ROUTE_PATH } from '../../cards/routes/list-cards.ts';
import { createTestCard, requestOwnedPrices, createCardRequest } from '../../cards/tests/utils.ts';
import { CARD_CONDITION_MAP } from '../../cards/types.ts';
import { cardImage } from '../../db/schema/card-images.ts';
import { cardPrice } from '../../db/schema/card-pricing.ts';
import { createNodeApplication } from '../../runtime/node/app.ts';
import { deferred } from '../../tests/async.ts';
import { expectErrorResponse, expectValidationIssueForField, sessionHeaders } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestRequestId } from '../../tests/logs.ts';
import { PRICING_CLIENT_ERROR_REASONS, type PricingClient } from '../client.ts';
import { SEARCH_PRICING_ROUTE_PATH } from '../routes/search-pricing.ts';
import { PricingSearchResponseSchema } from '../schemas/responses.ts';
import { StaticScrydexClient } from '../scrydex/static-client.ts';
import { searchPageKey } from '../utils/pagination.ts';
import { queryKey, todayUTC } from '../utils/query.ts';

describe('Card pricing integration', () => {
  integrationTest(
    'keeps owned cards visible when the lock pool is unavailable and returns a retryable search failure',
    async ({ app, db, user, authenticatedHeaders, storageClient, getLogsForRequestId, withRequestId }) => {
      const created = await createTestCard(app, user.sessionToken, {
        game: 'pokemon',
        name: 'Giratina VSTAR',
        set_name: 'Crown Zenith',
        card_number: 'GG69',
        purchases: [{ condition: 'near_mint', quantity: 1, purchase_price: null, currency: null }],
      });

      await db.delete(cardPrice);
      const composed = createNodeApplication({ db, storageClient, pricingClient: new StaticScrydexClient() });
      await composed.dependencies.persistence.close();

      try {
        const { headers, requestId } = withRequestId(authenticatedHeaders, createTestRequestId());
        const listed = await composed.app.request(LIST_CARDS_ROUTE_PATH, { headers });

        expect(listed.status).toBe(200);
        expect(await listed.json()).toMatchObject({
          entries: [{ name: 'Giratina VSTAR' }],
        });
        const priced = await requestOwnedPrices(composed.app, headers, [created.id]);
        expect(priced.status).toBe(200);
        expect(await priced.json()).toMatchObject({ prices: [{ id: created.id, price: { status: 'unavailable' } }] });
        expect(getLogsForRequestId(requestId)).toContainEqual(
          expect.objectContaining({
            event: 'pricing.lock.completed',
            outcome: 'failure',
            lock_status: 'failed',
            error_code: 'PRICING_LOCK_UNAVAILABLE',
          }),
        );

        const search = await composed.app.request(
          `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Charizard`,
          {
            headers,
          },
        );

        expect(await expectErrorResponse(search, 503)).toEqual({
          code: 'PRICING_LOCK_UNAVAILABLE',
          message: 'Card pricing is temporarily unavailable; try again shortly.',
        });
        expect(search.headers.get('Retry-After')).toBe('1');
      } finally {
        await composed.dispose();
      }
    },
  );

  integrationTest('requires an authenticated session', async ({ app }) => {
    const response = await app.request(SEARCH_PRICING_ROUTE_PATH);
    expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.UNAUTHORIZED)).toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });

  integrationTest(
    'separates filtered caches and reuses equivalent unrestricted selections',
    async ({ db, createApp, authenticatedHeaders: headers }) => {
      const pricingClient = new CountingPricingClient('scrydex_static');
      const app = createApp({ pricingClient });

      const path = `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina`;

      const unrestricted = await app.request(path, { headers });
      const empty = await app.request(`${path}&languages=`, { headers });
      const complete = await app.request(`${path}&languages=ja,en,ja`, { headers });
      const english = await app.request(`${path}&languages=en,en`, { headers });
      const englishAgain = await app.request(`${path}&languages=en`, { headers });
      const japanese = await app.request(`${path}&languages=ja`, { headers });

      expect(unrestricted.status).toBe(200);
      expect(empty.status).toBe(200);
      expect(complete.status).toBe(200);
      expect(english.status).toBe(200);
      expect(englishAgain.status).toBe(200);
      expect(japanese.status).toBe(200);

      const unfilteredBody = PricingSearchResponseSchema.parse(await unrestricted.json());
      expect(PricingSearchResponseSchema.parse(await empty.json())).toEqual(unfilteredBody);
      expect(PricingSearchResponseSchema.parse(await complete.json())).toEqual(unfilteredBody);

      const englishBody = PricingSearchResponseSchema.parse(await english.json());

      expect(englishBody.entries).toMatchObject([{ name: 'Giratina VSTAR', card_number: 'GG69' }]);
      expect(PricingSearchResponseSchema.parse(await englishAgain.json())).toEqual(englishBody);
      expect(PricingSearchResponseSchema.parse(await japanese.json())).toEqual({ entries: [], next_cursor: null });
      expect(pricingClient.searchCallCount).toBe(3);
      expect(await db.query.cardPriceSearch.findMany()).toHaveLength(3);
    },
  );

  integrationTest(
    'returns language validation errors for unknown codes and unsupported games',
    async ({ app, db, authenticatedHeaders: headers }) => {
      const unknown = await app.request(
        `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Shiftry&languages=fr`,
        {
          headers,
        },
      );

      const unsupported = await app.request(
        `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=one_piece&query=Nami&languages=ja`,
        {
          headers,
        },
      );

      await expectValidationIssueForField(unknown, 'languages');
      await expectValidationIssueForField(unsupported, 'languages');

      expect(await db.query.cardPriceSearch.findMany()).toEqual([]);
    },
  );

  integrationTest('searches and returns normalized market pricing', async ({ app, authenticatedHeaders }) => {
    const response = await app.request(
      `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina%20VSTAR%20GG69`,
      {
        headers: authenticatedHeaders,
      },
    );

    expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
    const body = PricingSearchResponseSchema.parse(await response.json());
    expect(body.entries[0]).toMatchObject({
      id: expect.any(String),
      set_name: 'Crown Zenith',
      headline: { amount: 146.69, currency: 'USD', metric: 'lowest_near_mint' },
      market: {
        condition: 'near_mint',
        market: 172.42,
        trend_7d: { price_change: 7.36, percent_change: 4.46 },
      },
    });
    expect(body.entries[0]).not.toHaveProperty('pricing_card_id');
  });

  integrationTest(
    'returns One Piece set metadata from fresh and cached pricing',
    async ({ app, authenticatedHeaders }) => {
      const path = `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=one_piece&query=OP09-093`;
      const first = await app.request(path, { headers: authenticatedHeaders });
      expect(first.status).toBe(200);
      const firstBody = PricingSearchResponseSchema.parse(await first.json());
      expect(firstBody.entries[0]).toMatchObject({ game: 'one_piece', set_name: 'Emperors in the New World' });

      const second = await app.request(path, { headers: authenticatedHeaders });
      expect(second.status).toBe(200);
      expect(PricingSearchResponseSchema.parse(await second.json())).toEqual(firstBody);
    },
  );

  integrationTest(
    'omits set name from legacy cached pricing without normalized metadata',
    async ({ app, db, authenticatedHeaders }) => {
      const path = `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina`;
      const first = await app.request(path, { headers: authenticatedHeaders });
      expect(first.status).toBe(200);
      const cachedRow = await db.query.cardPrice.findFirst();
      assert(cachedRow != null);
      const { setName, ...legacyPrices } = cachedRow.prices;
      expect(setName).toBe('Crown Zenith');
      await db.update(cardPrice).set({ prices: legacyPrices });

      const cached = await app.request(path, { headers: authenticatedHeaders });
      expect(cached.status).toBe(200);
      const body = PricingSearchResponseSchema.parse(await cached.json());
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0]).not.toHaveProperty('set_name');
    },
  );

  integrationTest(
    'recovers raw and standard graded quotes for the selected variant on a legacy cache hit',
    async ({ app, db, authenticatedHeaders, pricingClient }) => {
      const providerSearch = vi.spyOn(pricingClient, 'searchCards');
      const path = `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina`;
      const fresh = await app.request(path, { headers: authenticatedHeaders });
      expect(fresh.status).toBe(200);
      expect(providerSearch).toHaveBeenCalledTimes(1);

      const cached = await db.query.cardPrice.findFirst();
      assert(cached != null);
      const { conditionPrices, gradedPrices, ...legacy } = cached.prices;
      expect(conditionPrices).toHaveLength(1);
      expect(gradedPrices).toEqual([]);
      await db.update(cardPrice).set({
        prices: legacy,
        raw: {
          id: cached.pricingCardId,
          name: cached.name,
          number: cached.cardNumber,
          variants: [
            {
              name: 'reverseHolofoil',
              prices: [
                { type: 'raw', condition: 'MP', currency: 'USD', market: 99 },
                { type: 'graded', company: 'PSA', grade: '10', currency: 'USD', market: 999 },
              ],
              pop_reports: [{ company: 'PSA', grades: [{ grade: '9.5', count: 999 }] }],
            },
            {
              name: 'normal',
              prices: [
                { type: 'raw', condition: 'LP', currency: 'USD', market: 20 },
                { type: 'raw', condition: 'HP', currency: 'USD', market: 12 },
                { type: 'graded', company: ' psa ', grade: '9.5', currency: 'USD', market: 70 },
                { type: 'graded', company: 'PSA', grade: '10', currency: 'USD', market: 100, low: 80 },
                { type: 'graded', company: 'PSA', grade: '10', currency: 'USD', low: 1 },
                { type: 'graded', company: 'CGC', grade: '10', currency: 'USD', market: 300, is_perfect: true },
                { type: 'graded', company: 'PSA', grade: '10', currency: 'USD', market: 600, is_signed: true },
                { type: 'graded', company: 'PSA', grade: '10', currency: 'USD', market: 400, is_error: true },
                { type: 'graded', company: 'BGS', grade: 'unknown', currency: 'USD', market: 95 },
                { type: 'graded', company: 'BGS', grade: '9.5', currency: 'USD', low: -30 },
              ],
              pop_reports: [
                { company: 'CGC', grades: [{ grade: '9.5', count: 240 }] },
                {
                  company: ' psa ',
                  total: 1500,
                  grades: [
                    { grade: '10Q', count: 12 },
                    { grade: '9.5', count: -10 },
                    { grade: '10', count: 125 },
                  ],
                },
              ],
            },
          ],
        },
      });

      const hit = await app.request(path, { headers: authenticatedHeaders });
      expect(hit.status).toBe(200);
      const body = PricingSearchResponseSchema.parse(await hit.json());
      expect(body.entries[0]?.graded_prices).toEqual([
        { company: 'PSA', grade: 10, currency: 'USD', market: 100, low: 80, population: 125 },
        { company: 'PSA', grade: 9.5, currency: 'USD', market: 70 },
      ]);
      expect(body.entries[0]?.condition_prices?.map(quote => quote.condition)).toEqual([
        'near_mint',
        'excellent',
        'played',
      ]);
      expect(
        body.entries[0]?.condition_values?.find(value => value.condition === CARD_CONDITION_MAP.GOOD),
      ).toMatchObject({
        amount: 16,
        currency: 'USD',
        basis: 'interpolated',
      });
      expect(providerSearch).toHaveBeenCalledTimes(1);
    },
  );

  integrationTest(
    'recovers the sole unfamiliar Pokémon variant quote from the raw cache',
    async ({ app, db, authenticatedHeaders, pricingClient }) => {
      const providerSearch = vi.spyOn(pricingClient, 'searchCards');
      const path = `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina`;
      const fresh = await app.request(path, { headers: authenticatedHeaders });
      expect(fresh.status).toBe(200);

      const cached = await db.query.cardPrice.findFirst();
      assert(cached != null);
      await db.update(cardPrice).set({
        prices: {},
        raw: {
          id: cached.pricingCardId,
          name: cached.name,
          number: cached.cardNumber,
          variants: [
            { name: 'futureFoil', prices: [{ type: 'raw', condition: 'NM', currency: 'JPY', market: 25_000 }] },
          ],
        },
      });

      const hit = await app.request(path, { headers: authenticatedHeaders });
      expect(hit.status).toBe(200);
      const body = PricingSearchResponseSchema.parse(await hit.json());
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0]).toMatchObject({
        id: cached.id,
        condition_prices: [{ condition: 'near_mint', currency: 'JPY', market: 25_000 }],
      });
      expect(providerSearch).toHaveBeenCalledTimes(1);
    },
  );

  integrationTest(
    'registers images when serving legacy cached pricing results',
    async ({ app, db, authenticatedHeaders }) => {
      const path = `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina%20VSTAR%20GG69`;
      const first = await app.request(path, { headers: authenticatedHeaders });
      const firstBody = PricingSearchResponseSchema.parse(await first.json());
      const originURL = 'https://images.example.com/giratina-vstar-gg69.png';
      const imageKey = imageKeyForOriginURL(originURL);

      await db.delete(cardImage);

      const second = await app.request(path, { headers: authenticatedHeaders });
      expect(second.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(PricingSearchResponseSchema.parse(await second.json()).entries).toEqual(firstBody.entries);
      expect(await db.query.cardImage.findFirst({ where: { imageKey } })).toMatchObject({
        imageKey,
        originUrl: originURL,
        status: 'pending',
      });
    },
  );

  integrationTest('returns no-results and rejects invalid search queries', async ({ app, authenticatedHeaders }) => {
    const noResults = await app.request(`${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=no%20results`, {
      headers: authenticatedHeaders,
    });

    const invalid = await app.request(`${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=x`, {
      headers: authenticatedHeaders,
    });

    expect(PricingSearchResponseSchema.parse(await noResults.json())).toMatchObject({
      entries: [],
    });
    await expectValidationIssueForField(invalid, 'query');
  });

  integrationTest(
    'deduplicates repeated provider cards before bulk upserting them',
    async ({ db, createApp, authenticatedHeaders }) => {
      const pricingClient = new DuplicateSearchPricingClient();
      const app = createApp({ pricingClient });

      const response = await app.request(
        `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina%20VSTAR%20GG69`,
        {
          headers: authenticatedHeaders,
        },
      );

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(PricingSearchResponseSchema.parse(await response.json()).entries).toHaveLength(1);
      expect(
        await db
          .select()
          .from(cardPrice)
          .where(and(eq(cardPrice.game, 'pokemon'), eq(cardPrice.pricingCardId, 'crown-zenith-GG69'))),
      ).toHaveLength(1);
    },
  );

  integrationTest(
    'relinks an owned card when the active pricing source changes',
    async ({ db, createApp, user, authenticatedHeaders }) => {
      const staticClient = new CountingPricingClient('scrydex_static');
      const staticApp = createApp({ pricingClient: staticClient });

      const created = await createCardRequest(staticApp, user.sessionToken, {
        game: 'pokemon',
        name: 'Giratina VSTAR',
        set_name: 'Crown Zenith',
        card_number: 'GG69',
        purchases: [{ condition: 'near_mint', quantity: 1, purchase_price: null, currency: null }],
      });

      expect(created.status).toBe(CONTENTFUL_STATUS_CODES.CREATED);
      const ownedCard = await db.query.card.findFirst({ where: { userId: user.userId } });
      assert(ownedCard != null);
      expect(ownedCard).toMatchObject({ pricingCardId: 'crown-zenith-GG69', pricingSource: 'scrydex_static' });

      const realModeClient = new CountingPricingClient('scrydex_real');
      const realModeApp = createApp({ pricingClient: realModeClient });
      const listed = await requestOwnedPrices(realModeApp, authenticatedHeaders, [ownedCard.id]);

      expect(listed.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      await expect(db.query.card.findFirst({ where: { id: ownedCard.id } })).resolves.toMatchObject({
        pricingCardId: 'crown-zenith-GG69',
        pricingSource: 'scrydex_real',
      });
      expect(realModeClient.searchCallCount).toBe(1);
    },
  );

  integrationTest(
    'logs one redacted lock-completion event',
    async ({ app, getLogsForRequestId, withRequestId, authenticatedHeaders }) => {
      const { headers, requestId } = withRequestId(authenticatedHeaders, createTestRequestId());

      const response = await app.request(
        `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Sensitive%20Search%20Term`,
        {
          headers,
        },
      );

      expect(response.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      const lockEvents = getLogsForRequestId(requestId).filter(log => log.event === 'pricing.lock.completed');
      expect(lockEvents).toEqual([
        expect.objectContaining({
          game: 'pokemon',
          lock_key_type: 'search',
          lock_status: 'acquired',
          lock_wait_ms: expect.any(Number),
          outcome: 'success',
          priced_on: todayUTC(),
        }),
      ]);
      expect(lockEvents[0]).not.toHaveProperty('lock_key');
      expect(JSON.stringify(lockEvents)).not.toContain('Sensitive Search Term');
    },
  );

  integrationTest(
    'deduplicates concurrent searches across app instances',
    async ({ connectionString, createApp, createUser, authenticatedHeaders }) => {
      const pricingClient = new BlockingPricingClient('search');
      const firstApp = createApp({ pricingClient });
      const secondApp = createApp({ pricingClient });

      const secondUser = await createUser({});
      const path = `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Charizard%20ex%20199`;

      const firstRequest = firstApp.request(path, { headers: authenticatedHeaders });
      await pricingClient.started;
      const secondRequest = secondApp.request(path, { headers: sessionHeaders(secondUser.sessionToken) });
      await waitForAdvisoryLockWaiter(connectionString);
      pricingClient.release();

      const [first, second] = await Promise.all([firstRequest, secondRequest]);
      expect(first.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(second.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(await first.json()).toEqual(await second.json());
      expect(pricingClient.searchCallCount).toBe(1);
    },
  );

  integrationTest(
    'returns a retryable 503 when the pricing lock times out',
    async ({ connectionString, createApp, authenticatedHeaders }) => {
      const pricingClient = new CountingPricingClient('scrydex_static');
      const app = createApp({ pricingClient });

      const query = 'Charizard ex 199';
      const lockKey = `pricing:search:scrydex_static:${todayUTC()}:pokemon:${searchPageKey(queryKey('pokemon', query, { languages: [], searchBy: 'card' }), 0)}`;
      const lockHolder = new Client({ connectionString });
      await lockHolder.connect();

      try {
        await lockHolder.query('begin');
        await lockHolder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);

        const response = await app.request(
          `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Charizard%20ex%20199`,
          {
            headers: authenticatedHeaders,
          },
        );

        expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE)).toEqual({
          code: 'PRICING_LOCK_TIMEOUT',
          message: 'Pricing is busy; try again shortly.',
        });
        expect(response.headers.get('Retry-After')).toBe('1');
        expect(pricingClient.searchCallCount).toBe(0);
      } finally {
        await lockHolder.query('rollback');
        await lockHolder.end();
      }
    },
  );

  integrationTest(
    'releases the lock after an upstream failure',
    async ({ createApp, createUser, authenticatedHeaders }) => {
      const pricingClient = new FailOncePricingClient('scrydex_static');
      const firstApp = createApp({ pricingClient });
      const secondApp = createApp({ pricingClient });

      const secondUser = await createUser({});
      const path = `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina%20VSTAR%20GG69`;

      const first = await firstApp.request(path, { headers: authenticatedHeaders });
      const second = await secondApp.request(path, { headers: sessionHeaders(secondUser.sessionToken) });

      expect(first.status).toBe(CONTENTFUL_STATUS_CODES.INTERNAL_SERVER_ERROR);
      expect(second.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(pricingClient.searchCallCount).toBe(2);
    },
  );

  integrationTest(
    'logs the safe provider failure details when search pricing is unavailable',
    async ({ getLogsForRequestId, withRequestId, createApp, authenticatedHeaders }) => {
      const pricingClient = new UnavailablePricingClient();
      const app = createApp({ pricingClient });

      const { headers, requestId } = withRequestId(authenticatedHeaders, createTestRequestId());

      const response = await app.request(
        `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina%20VSTAR%20GG69`,
        {
          headers,
        },
      );

      expect(await expectErrorResponse(response, CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE)).toMatchObject({
        code: 'PRICING_PROVIDER_UNAVAILABLE',
      });
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'pricing.provider.request_completed',
            outcome: 'failure',
            provider: 'scrydex',
            provider_operation: 'search',
            pricing_source: 'scrydex_static',
            provider_error_reason: 'http_error',
            provider_error_message: 'Scrydex search failed with status 429',
            provider_status_code: 429,
          }),
        ]),
      );
    },
  );

  integrationTest(
    'allows different pricing keys to proceed concurrently',
    async ({ createApp, createUser, authenticatedHeaders }) => {
      const pricingClient = new TwoCallBarrierPricingClient('scrydex_static');
      const firstApp = createApp({ pricingClient });
      const secondApp = createApp({ pricingClient });

      const secondUser = await createUser({});

      const firstRequest = firstApp.request(
        `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Charizard%20ex%20199`,
        {
          headers: authenticatedHeaders,
        },
      );

      const secondRequest = secondApp.request(
        `${SEARCH_PRICING_ROUTE_PATH}?search_by=card&game=pokemon&query=Giratina%20VSTAR%20GG69`,
        {
          headers: sessionHeaders(secondUser.sessionToken),
        },
      );

      await withTimeout(pricingClient.bothStarted, 750, 'Different pricing keys did not proceed concurrently');
      pricingClient.release();

      const [first, second] = await Promise.all([firstRequest, secondRequest]);
      expect(first.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(second.status).toBe(CONTENTFUL_STATUS_CODES.OK);
      expect(pricingClient.searchCallCount).toBe(2);
    },
  );
});

class CountingPricingClient implements PricingClient {
  readonly source: PricingClient['source'];
  searchCallCount = 0;
  getByIdCallCount = 0;
  private readonly client = new StaticScrydexClient();

  constructor(source: PricingClient['source']) {
    this.source = source;
  }

  searchCards(
    game: Parameters<PricingClient['searchCards']>[0],
    query: string,
    languages: Parameters<PricingClient['searchCards']>[2],
    page: number,
  ) {
    this.searchCallCount += 1;

    return this.client.searchCards(game, query, languages, page);
  }

  getCardById(game: Parameters<PricingClient['getCardById']>[0], id: string) {
    this.getByIdCallCount += 1;

    return this.client.getCardById(game, id);
  }
}

class UnavailablePricingClient extends StaticScrydexClient {
  override async searchCards() {
    return err({
      reason: PRICING_CLIENT_ERROR_REASONS.HTTP_ERROR,
      message: 'Scrydex search failed with status 429',
      statusCode: 429,
      isRetryable: true,
    });
  }
}

class DuplicateSearchPricingClient extends StaticScrydexClient {
  override async searchCards(game: Parameters<PricingClient['searchCards']>[0], query: string) {
    const result = await super.searchCards(game, query, { languages: [], searchBy: 'card' }, 1);

    return result.map(search => ({
      ...search,
      records: [...search.records, ...search.records.slice(0, 1)],
    }));
  }
}

class BlockingPricingClient extends CountingPricingClient {
  private readonly gate = deferred<undefined>();
  private readonly startedGate = deferred<undefined>();
  readonly started = this.startedGate.promise;

  constructor(private readonly method: 'card' | 'search') {
    super('scrydex_static');
  }

  override async searchCards(game: Parameters<PricingClient['searchCards']>[0], query: string) {
    if (this.method === 'search' && this.searchCallCount === 0) {
      this.startedGate.resolve(undefined);
      await this.gate.promise;
    }

    return super.searchCards(game, query, { languages: [], searchBy: 'card' }, 1);
  }

  override async getCardById(game: Parameters<PricingClient['getCardById']>[0], id: string) {
    if (this.method === 'card' && this.getByIdCallCount === 0) {
      this.startedGate.resolve(undefined);
      await this.gate.promise;
    }

    return super.getCardById(game, id);
  }

  release() {
    this.gate.resolve(undefined);
  }
}

class FailOncePricingClient extends CountingPricingClient {
  override async searchCards(game: Parameters<PricingClient['searchCards']>[0], query: string) {
    if (this.searchCallCount === 0) {
      this.searchCallCount += 1;
      throw new Error('Simulated upstream failure');
    }

    return super.searchCards(game, query, { languages: [], searchBy: 'card' }, 1);
  }
}

class TwoCallBarrierPricingClient extends CountingPricingClient {
  private readonly gate = deferred<undefined>();
  private readonly startedGate = deferred<undefined>();
  readonly bothStarted = this.startedGate.promise;

  override async searchCards(game: Parameters<PricingClient['searchCards']>[0], query: string) {
    this.searchCallCount += 1;

    if (this.searchCallCount === 2) {
      this.startedGate.resolve(undefined);
    }

    await this.gate.promise;

    return new StaticScrydexClient().searchCards(game, query, { languages: [], searchBy: 'card' }, 1);
  }

  release() {
    this.gate.resolve(undefined);
  }
}

async function waitForAdvisoryLockWaiter(connectionString: string) {
  const observer = new Client({ connectionString });
  await observer.connect();

  try {
    const deadline = Date.now() + 750;

    while (Date.now() < deadline) {
      const result = await observer.query<{ waiting: boolean }>(
        `select exists (
           select 1
           from pg_locks
           where locktype = 'advisory'
             and database = (select oid from pg_database where datname = current_database())
             and not granted
         ) as waiting`,
      );

      if (result.rows[0]?.waiting === true) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 10));
    }

    throw new Error('Timed out waiting for an advisory-lock waiter');
  } finally {
    await observer.end();
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined = undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout != null) {
      clearTimeout(timeout);
    }
  }
}
