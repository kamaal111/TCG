import App from '../../app.ts';
import { eq } from 'drizzle-orm';
import { Client } from 'pg';
import { STATUS_CODES } from '../../constants/http.ts';
import { card } from '../../db/schema/cards.ts';
import type { TCGGOClient } from '../tcggo/client.ts';
import { StaticTCGGOClient } from '../tcggo/static-client.ts';
import { expectErrorResponse, expectValidationIssueForField } from '../../tests/auth.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { createCardRequest, sessionHeaders, validCardPayload } from '../../cards/tests/utils.ts';
import { OWNED_PRICING_ROUTE_PATH } from '../handlers/owned-pricing.ts';
import { SEARCH_PRICING_ROUTE_PATH } from '../handlers/search-pricing.ts';
import { OwnedPricingResponseSchema, PricingSearchResponseSchema } from '../schemas/responses.ts';
import { queryKey, todayUTC } from '../utils/query.ts';

describe('Card pricing integration', () => {
  integrationTest('requires an authenticated session', async ({ app }) => {
    const response = await app.request(OWNED_PRICING_ROUTE_PATH);
    expect(await expectErrorResponse(response, STATUS_CODES.NOT_FOUND)).toMatchObject({
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
    expect(body.status).toBe('ok');
    expect(body.matches[0]).toMatchObject({
      tcggo_card_id: 'pokemon-giratina-vstar-gg69',
      headline: { amount: 146.69, currency: 'EUR', metric: 'lowest_near_mint' },
      cardmarket: { trend: 'up' },
    });
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
      status: 'no_results',
      matches: [],
    });
    await expectValidationIssueForField(invalid, 'query');
  });

  integrationTest('prices an owned card and persists its TCGGO identifier', async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const cardResponse = await createCardRequest(app, user.sessionToken, {
      ...validCardPayload,
      game: 'pokemon',
      name: 'Giratina VSTAR',
      set_name: 'Crown Zenith',
      card_number: 'GG69',
    });
    const createdCard = (await cardResponse.json()) as { id: string };
    const response = await app.request(OWNED_PRICING_ROUTE_PATH, {
      headers: sessionHeaders(user.sessionToken),
    });

    const body = OwnedPricingResponseSchema.parse(await response.json());
    expect(body.prices).toEqual([
      expect.objectContaining({
        card_id: createdCard.id,
        status: 'priced',
        price: expect.objectContaining({ tcggo_card_id: 'pokemon-giratina-vstar-gg69' }),
      }),
    ]);
    await expect(db.query.card.findFirst({ where: { id: createdCard.id } })).resolves.toMatchObject({
      tcggoCardId: 'pokemon-giratina-vstar-gg69',
    });
  });

  integrationTest('reports no match for an owned card without upstream results', async ({ app, db }) => {
    const user = await createTestUser(app, db);
    await createCardRequest(app, user.sessionToken, {
      ...validCardPayload,
      game: 'pokemon',
      name: 'no',
      set_name: 'Unknown',
      card_number: 'results',
    });
    const response = await app.request(OWNED_PRICING_ROUTE_PATH, {
      headers: sessionHeaders(user.sessionToken),
    });

    expect(OwnedPricingResponseSchema.parse(await response.json()).prices[0]?.status).toBe('no_match');
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
    const tcggo = new BlockingTCGGOClient('search');
    const firstApp = new App({ db, tcggo }).app;
    const secondApp = new App({ db, tcggo }).app;
    const firstUser = await createTestUser(firstApp, db);
    const secondUser = await createTestUser(secondApp, db);
    const path = `${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Charizard%20ex%20199`;

    const firstRequest = firstApp.request(path, { headers: sessionHeaders(firstUser.sessionToken) });
    await tcggo.started;
    const secondRequest = secondApp.request(path, { headers: sessionHeaders(secondUser.sessionToken) });
    await waitForAdvisoryLockWaiter(connectionString);
    tcggo.release();

    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    expect(first.status).toBe(STATUS_CODES.OK);
    expect(second.status).toBe(STATUS_CODES.OK);
    expect(await first.json()).toEqual(await second.json());
    expect(tcggo.searchCallCount).toBe(1);
  });

  integrationTest('deduplicates concurrent card-id lookups across app instances', async ({ connectionString, db }) => {
    const tcggo = new BlockingTCGGOClient('card');
    const firstApp = new App({ db, tcggo }).app;
    const secondApp = new App({ db, tcggo }).app;
    const firstUser = await createTestUser(firstApp, db);
    const secondUser = await createTestUser(secondApp, db);
    const cardId = 'pokemon-charizard-ex-199';
    const firstOwnedCardId = await createOwnedCardWithTCGGOId(firstApp, db, firstUser.sessionToken, cardId);
    const secondOwnedCardId = await createOwnedCardWithTCGGOId(secondApp, db, secondUser.sessionToken, cardId);

    const firstRequest = firstApp.request(OWNED_PRICING_ROUTE_PATH, {
      headers: sessionHeaders(firstUser.sessionToken),
    });
    await tcggo.started;
    const secondRequest = secondApp.request(OWNED_PRICING_ROUTE_PATH, {
      headers: sessionHeaders(secondUser.sessionToken),
    });
    await waitForAdvisoryLockWaiter(connectionString);
    tcggo.release();

    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    const firstBody = OwnedPricingResponseSchema.parse(await first.json());
    const secondBody = OwnedPricingResponseSchema.parse(await second.json());
    expect(firstBody.prices[0]).toMatchObject({ card_id: firstOwnedCardId, status: 'priced' });
    expect(secondBody.prices[0]).toMatchObject({ card_id: secondOwnedCardId, status: 'priced' });
    expect(tcggo.getByIdCallCount).toBe(1);
  });

  integrationTest('returns a retryable 503 when the pricing lock times out', async ({ connectionString, db }) => {
    const tcggo = new CountingTCGGOClient();
    const { app } = new App({ db, tcggo });
    const user = await createTestUser(app, db);
    const query = 'Charizard ex 199';
    const lockKey = `pricing:search:${todayUTC()}:pokemon:${queryKey('pokemon', query)}`;
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
      expect(tcggo.searchCallCount).toBe(0);
    } finally {
      await lockHolder.query('rollback');
      await lockHolder.end();
    }
  });

  integrationTest('releases the lock after an upstream failure', async ({ db }) => {
    const tcggo = new FailOnceTCGGOClient();
    const firstApp = new App({ db, tcggo }).app;
    const secondApp = new App({ db, tcggo }).app;
    const firstUser = await createTestUser(firstApp, db);
    const secondUser = await createTestUser(secondApp, db);
    const path = `${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Giratina%20VSTAR%20GG69`;

    const first = await firstApp.request(path, { headers: sessionHeaders(firstUser.sessionToken) });
    const second = await secondApp.request(path, { headers: sessionHeaders(secondUser.sessionToken) });

    expect(first.status).toBe(STATUS_CODES.INTERNAL_SERVER_ERROR);
    expect(second.status).toBe(STATUS_CODES.OK);
    expect(tcggo.searchCallCount).toBe(2);
  });

  integrationTest('allows different pricing keys to proceed concurrently', async ({ db }) => {
    const tcggo = new TwoCallBarrierTCGGOClient();
    const firstApp = new App({ db, tcggo }).app;
    const secondApp = new App({ db, tcggo }).app;
    const firstUser = await createTestUser(firstApp, db);
    const secondUser = await createTestUser(secondApp, db);

    const firstRequest = firstApp.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Charizard%20ex%20199`, {
      headers: sessionHeaders(firstUser.sessionToken),
    });
    const secondRequest = secondApp.request(`${SEARCH_PRICING_ROUTE_PATH}?game=pokemon&query=Giratina%20VSTAR%20GG69`, {
      headers: sessionHeaders(secondUser.sessionToken),
    });
    await withTimeout(tcggo.bothStarted, 750, 'Different pricing keys did not proceed concurrently');
    tcggo.release();

    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    expect(first.status).toBe(STATUS_CODES.OK);
    expect(second.status).toBe(STATUS_CODES.OK);
    expect(tcggo.searchCallCount).toBe(2);
  });
});

class CountingTCGGOClient implements TCGGOClient {
  readonly source = 'static' as const;
  searchCallCount = 0;
  getByIdCallCount = 0;
  private readonly client = new StaticTCGGOClient();

  searchCards(game: Parameters<TCGGOClient['searchCards']>[0], query: string) {
    this.searchCallCount += 1;
    return this.client.searchCards(game, query);
  }

  getCardById(game: Parameters<TCGGOClient['getCardById']>[0], id: string) {
    this.getByIdCallCount += 1;
    return this.client.getCardById(game, id);
  }
}

class BlockingTCGGOClient extends CountingTCGGOClient {
  private readonly gate = deferred<void>();
  private readonly startedGate = deferred<void>();
  readonly started = this.startedGate.promise;

  constructor(private readonly method: 'card' | 'search') {
    super();
  }

  override async searchCards(game: Parameters<TCGGOClient['searchCards']>[0], query: string) {
    if (this.method === 'search' && this.searchCallCount === 0) {
      this.startedGate.resolve();
      await this.gate.promise;
    }
    return super.searchCards(game, query);
  }

  override async getCardById(game: Parameters<TCGGOClient['getCardById']>[0], id: string) {
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

class FailOnceTCGGOClient extends CountingTCGGOClient {
  override async searchCards(game: Parameters<TCGGOClient['searchCards']>[0], query: string) {
    if (this.searchCallCount === 0) {
      this.searchCallCount += 1;
      throw new Error('Simulated upstream failure');
    }
    return super.searchCards(game, query);
  }
}

class TwoCallBarrierTCGGOClient extends CountingTCGGOClient {
  private readonly gate = deferred<void>();
  private readonly startedGate = deferred<void>();
  readonly bothStarted = this.startedGate.promise;

  override async searchCards(game: Parameters<TCGGOClient['searchCards']>[0], query: string) {
    this.searchCallCount += 1;
    if (this.searchCallCount === 2) this.startedGate.resolve();
    await this.gate.promise;
    return new StaticTCGGOClient().searchCards(game, query);
  }

  release() {
    this.gate.resolve();
  }
}

async function createOwnedCardWithTCGGOId(
  app: App['app'],
  db: Parameters<typeof createTestUser>[1],
  sessionToken: string,
  tcggoCardId: string,
) {
  const response = await createCardRequest(app, sessionToken, {
    ...validCardPayload,
    game: 'pokemon',
    name: 'Charizard ex',
    set_name: '151',
    card_number: '199',
  });
  const created = (await response.json()) as { id: string };
  await db.update(card).set({ tcggoCardId }).where(eq(card.id, created.id));
  return created.id;
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
