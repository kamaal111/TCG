import assert from 'node:assert/strict';

import { and, eq } from 'drizzle-orm';
import { err } from 'neverthrow';
import { Client } from 'pg';

import App from '../../app.ts';
import { LIST_CARDS_ROUTE_PATH } from '../../cards/handlers/list-cards.ts';
import { createCardRequest, sessionHeaders } from '../../cards/tests/utils.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import { cardPrice } from '../../db/schema/card-pricing.ts';
import { expectErrorResponse, expectValidationIssueForField } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { PRICING_CLIENT_ERROR_REASONS, type PricingClient } from '../client.ts';
import { SEARCH_PRICING_ROUTE_PATH } from '../handlers/search-pricing.ts';
import { PricingSearchResponseSchema } from '../schemas/responses.ts';
import { StaticScrydexClient } from '../scrydex/static-client.ts';
import { queryKey, todayUTC } from '../utils/query.ts';

describe('Card pricing integration', () => {
  integrationTest('requires an authenticated session', async ({ app }) => {
    const response = await app.request(SEARCH_PRICING_ROUTE_PATH);
    expect(await expectErrorResponse(response, STATUS_CODES.UNAUTHORIZED)).toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });

  integrationTest('searches and returns normalized market pricing', async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const response = await app.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Giratina%20VSTAR%20GG69`, {
      headers: sessionHeaders(user.sessionToken),
    });

    expect(response.status).toBe(STATUS_CODES.OK);
    const body = PricingSearchResponseSchema.parse(await response.json());
    expect(body.matches[0]).toMatchObject({
      id: expect.any(String),
      headline: { amount: 146.69, currency: 'USD', metric: 'lowest_near_mint' },
      market: {
        condition: 'near_mint',
        market: 172.42,
        trend_7d: { price_change: 7.36, percent_change: 4.46 },
      },
    });
    expect(body.matches[0]).not.toHaveProperty('pricing_card_id');
  });

  integrationTest('returns no-results and rejects invalid search queries', async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const noResults = await app.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=no%20results`, {
      headers: sessionHeaders(user.sessionToken),
    });
    const invalid = await app.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=x`, {
      headers: sessionHeaders(user.sessionToken),
    });

    expect(PricingSearchResponseSchema.parse(await noResults.json())).toMatchObject({
      matches: [],
    });
    await expectValidationIssueForField(invalid, 'query');
  });

  integrationTest('deduplicates repeated provider cards before bulk upserting them', async ({ db }) => {
    const pricingClient = new DuplicateSearchPricingClient();
    const { app } = new App({ db, pricingClient });
    const user = await createTestUser(app, db);

    const response = await app.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Giratina%20VSTAR%20GG69`, {
      headers: sessionHeaders(user.sessionToken),
    });

    expect(response.status).toBe(STATUS_CODES.OK);
    expect(PricingSearchResponseSchema.parse(await response.json()).matches).toHaveLength(1);
    expect(
      await db
        .select()
        .from(cardPrice)
        .where(and(eq(cardPrice.game, 'pokemon'), eq(cardPrice.pricingCardId, 'crown-zenith-GG69'))),
    ).toHaveLength(1);
  });

  integrationTest('relinks an owned card when the active pricing source changes', async ({ db }) => {
    const staticClient = new CountingPricingClient();
    const staticApp = new App({ db, pricingClient: staticClient }).app;
    const user = await createTestUser(staticApp, db);
    const created = await createCardRequest(staticApp, user.sessionToken, {
      game: 'pokemon',
      name: 'Giratina VSTAR',
      set_name: 'Crown Zenith',
      card_number: 'GG69',
      quantities: [{ condition: 'near_mint', quantity: 1 }],
    });
    expect(created.status).toBe(STATUS_CODES.CREATED);
    const ownedCard = await db.query.card.findFirst({ where: { userId: user.userId } });
    assert(ownedCard != null);
    expect(ownedCard).toMatchObject({ pricingCardId: 'crown-zenith-GG69', pricingSource: 'scrydex_static' });

    const realModeClient = new CountingPricingClient('scrydex_real');
    const realModeApp = new App({ db, pricingClient: realModeClient }).app;
    const listed = await realModeApp.request(LIST_CARDS_ROUTE_PATH, { headers: sessionHeaders(user.sessionToken) });

    expect(listed.status).toBe(STATUS_CODES.OK);
    await expect(db.query.card.findFirst({ where: { id: ownedCard.id } })).resolves.toMatchObject({
      pricingCardId: 'crown-zenith-GG69',
      pricingSource: 'scrydex_real',
    });
    expect(realModeClient.searchCallCount).toBe(1);
  });

  integrationTest(
    'logs one redacted lock-completion event',
    async ({ app, db, getLogsForRequestId, withRequestId }) => {
      const user = await createTestUser(app, db);
      const { headers, requestId } = withRequestId(Object.fromEntries(sessionHeaders(user.sessionToken).entries()));
      const response = await app.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Sensitive%20Search%20Term`, {
        headers,
      });

      expect(response.status).toBe(STATUS_CODES.OK);
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

  integrationTest('deduplicates concurrent searches across app instances', async ({ connectionString, db }) => {
    const pricingClient = new BlockingPricingClient('search');
    const firstApp = new App({ db, pricingClient }).app;
    const secondApp = new App({ db, pricingClient }).app;
    const firstUser = await createTestUser(firstApp, db);
    const secondUser = await createTestUser(secondApp, db);
    const path = `${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Charizard%20ex%20199`;

    const firstRequest = firstApp.request(path, { headers: sessionHeaders(firstUser.sessionToken) });
    await pricingClient.started;
    const secondRequest = secondApp.request(path, { headers: sessionHeaders(secondUser.sessionToken) });
    await waitForAdvisoryLockWaiter(connectionString);
    pricingClient.release();

    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    expect(first.status).toBe(STATUS_CODES.OK);
    expect(second.status).toBe(STATUS_CODES.OK);
    expect(await first.json()).toEqual(await second.json());
    expect(pricingClient.searchCallCount).toBe(1);
  });

  integrationTest('returns a retryable 503 when the pricing lock times out', async ({ connectionString, db }) => {
    const pricingClient = new CountingPricingClient();
    const { app } = new App({ db, pricingClient });
    const user = await createTestUser(app, db);
    const query = 'Charizard ex 199';
    const lockKey = `pricing:search:scrydex_static:${todayUTC()}:pokemon:${queryKey('pokemon', query)}`;
    const lockHolder = new Client({ connectionString });
    await lockHolder.connect();

    try {
      await lockHolder.query('begin');
      await lockHolder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
      const response = await app.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Charizard%20ex%20199`, {
        headers: sessionHeaders(user.sessionToken),
      });

      expect(await expectErrorResponse(response, STATUS_CODES.SERVICE_UNAVAILABLE)).toEqual({
        code: 'PRICING_LOCK_TIMEOUT',
        message: 'Pricing is busy; try again shortly.',
      });
      expect(response.headers.get('Retry-After')).toBe('1');
      expect(pricingClient.searchCallCount).toBe(0);
    } finally {
      await lockHolder.query('rollback');
      await lockHolder.end();
    }
  });

  integrationTest('releases the lock after an upstream failure', async ({ db }) => {
    const pricingClient = new FailOncePricingClient();
    const firstApp = new App({ db, pricingClient }).app;
    const secondApp = new App({ db, pricingClient }).app;
    const firstUser = await createTestUser(firstApp, db);
    const secondUser = await createTestUser(secondApp, db);
    const path = `${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Giratina%20VSTAR%20GG69`;

    const first = await firstApp.request(path, { headers: sessionHeaders(firstUser.sessionToken) });
    const second = await secondApp.request(path, { headers: sessionHeaders(secondUser.sessionToken) });

    expect(first.status).toBe(STATUS_CODES.INTERNAL_SERVER_ERROR);
    expect(second.status).toBe(STATUS_CODES.OK);
    expect(pricingClient.searchCallCount).toBe(2);
  });

  integrationTest(
    'logs the safe provider failure details when search pricing is unavailable',
    async ({ db, getLogsForRequestId, withRequestId }) => {
      const pricingClient = new UnavailablePricingClient();
      const { app } = new App({ db, pricingClient });
      const user = await createTestUser(app, db);
      const { headers, requestId } = withRequestId(Object.fromEntries(sessionHeaders(user.sessionToken).entries()));

      const response = await app.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Giratina%20VSTAR%20GG69`, {
        headers,
      });

      expect(await expectErrorResponse(response, STATUS_CODES.SERVICE_UNAVAILABLE)).toMatchObject({
        code: 'PRICING_PROVIDER_UNAVAILABLE',
      });
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'pricing.provider.request_completed',
            outcome: 'failure',
            provider: 'scrydex',
            provider_operation: 'search',
            provider_source: 'scrydex_static',
            provider_error_reason: 'http_error',
            provider_error_message: 'Scrydex search failed with status 429',
            provider_status_code: 429,
          }),
        ]),
      );
    },
  );

  integrationTest('allows different pricing keys to proceed concurrently', async ({ db }) => {
    const pricingClient = new TwoCallBarrierPricingClient();
    const firstApp = new App({ db, pricingClient }).app;
    const secondApp = new App({ db, pricingClient }).app;
    const firstUser = await createTestUser(firstApp, db);
    const secondUser = await createTestUser(secondApp, db);

    const firstRequest = firstApp.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Charizard%20ex%20199`, {
      headers: sessionHeaders(firstUser.sessionToken),
    });
    const secondRequest = secondApp.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Giratina%20VSTAR%20GG69`, {
      headers: sessionHeaders(secondUser.sessionToken),
    });
    await withTimeout(pricingClient.bothStarted, 750, 'Different pricing keys did not proceed concurrently');
    pricingClient.release();

    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    expect(first.status).toBe(STATUS_CODES.OK);
    expect(second.status).toBe(STATUS_CODES.OK);
    expect(pricingClient.searchCallCount).toBe(2);
  });
});

class CountingPricingClient implements PricingClient {
  readonly source: PricingClient['source'];
  searchCallCount = 0;
  getByIdCallCount = 0;
  private readonly client = new StaticScrydexClient();

  constructor(source: PricingClient['source'] = 'scrydex_static') {
    this.source = source;
  }

  searchCards(game: Parameters<PricingClient['searchCards']>[0], query: string) {
    this.searchCallCount += 1;
    return this.client.searchCards(game, query);
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
    const result = await super.searchCards(game, query);
    return result.map(search => ({
      ...search,
      records: [...search.records, ...search.records.slice(0, 1)],
    }));
  }
}

class BlockingPricingClient extends CountingPricingClient {
  private readonly gate = deferred<void>();
  private readonly startedGate = deferred<void>();
  readonly started = this.startedGate.promise;

  constructor(private readonly method: 'card' | 'search') {
    super();
  }

  override async searchCards(game: Parameters<PricingClient['searchCards']>[0], query: string) {
    if (this.method === 'search' && this.searchCallCount === 0) {
      this.startedGate.resolve();
      await this.gate.promise;
    }
    return super.searchCards(game, query);
  }

  override async getCardById(game: Parameters<PricingClient['getCardById']>[0], id: string) {
    if (this.method === 'card' && this.getByIdCallCount === 0) {
      this.startedGate.resolve();
      await this.gate.promise;
    }
    return super.getCardById(game, id);
  }

  release() {
    this.gate.resolve();
  }
}

class FailOncePricingClient extends CountingPricingClient {
  override async searchCards(game: Parameters<PricingClient['searchCards']>[0], query: string) {
    if (this.searchCallCount === 0) {
      this.searchCallCount += 1;
      throw new Error('Simulated upstream failure');
    }
    return super.searchCards(game, query);
  }
}

class TwoCallBarrierPricingClient extends CountingPricingClient {
  private readonly gate = deferred<void>();
  private readonly startedGate = deferred<void>();
  readonly bothStarted = this.startedGate.promise;

  override async searchCards(game: Parameters<PricingClient['searchCards']>[0], query: string) {
    this.searchCallCount += 1;
    if (this.searchCallCount === 2) this.startedGate.resolve();
    await this.gate.promise;
    return new StaticScrydexClient().searchCards(game, query);
  }

  release() {
    this.gate.resolve();
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
      if (result.rows[0]?.waiting === true) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for an advisory-lock waiter');
  } finally {
    await observer.end();
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolver => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout != null) clearTimeout(timeout);
  }
}
