import { sql } from 'drizzle-orm';
import { ok } from 'neverthrow';

import { createDatabaseOnlyContext } from '../../context.ts';
import type { Database } from '../../db/index.ts';
import { exchangeRate } from '../../db/schema/forex.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { EcbForexClient } from '../client.ts';
import {
  ForexInvalidResponse,
  ForexReadFailed,
  ForexRequestFailed,
  ForexStoredSnapshotInvalid,
  ForexWriteFailed,
} from '../errors.ts';
import { ExchangeRatesReadFailed } from '../exceptions.ts';
import { ForexRepository } from '../repository.ts';
import { LATEST_SNAPSHOT_ROUTE_PATH } from '../routes/latest-snapshot.ts';
import { ForexService } from '../service.ts';

const xml = `<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time="2026-10-16"><Cube currency="USD" rate="1.25"/><Cube currency="JPY" rate="150"/><Cube currency="GBP" rate="0.8"/></Cube></Cube></gesmes:Envelope>`;

integrationTest(
  'logs available snapshots and server-generated request IDs',
  async ({ app, db, getLogsForRequestId }) => {
    const user = await createTestUser(app, db);
    const headers = { Cookie: `better-auth.session_token=${user.sessionToken}` };
    const missing = await app.request(LATEST_SNAPSHOT_ROUTE_PATH, { headers });
    expect(missing.status).toBe(503);
    const missingId = missing.headers.get('tcg-request-id');
    expect(missingId).toEqual(expect.any(String));
    const failures = getLogsForRequestId(String(missingId));
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'request.error',
          outcome: 'failure',
          error_code: 'EXCHANGE_RATES_UNAVAILABLE',
        }),
      ]),
    );
    expect(failures.filter(log => log.event === 'forex.snapshot.loaded')).toHaveLength(0);
    await db.insert(exchangeRate).values({ date: '2026-10-16', rates: { EUR: 1, USD: 1.25, JPY: 150 } });
    const response = await app.request(LATEST_SNAPSHOT_ROUTE_PATH, { headers });
    expect(response.status).toBe(200);
    const requestId = response.headers.get('tcg-request-id');
    expect(requestId).toEqual(expect.any(String));
    expect(requestId).not.toBe(missingId);
    const logs = getLogsForRequestId(String(requestId));
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'forex.snapshot.loaded',
          outcome: 'success',
          user_id: user.userId,
          rate_date: '2026-10-16',
          base_currency: 'EUR',
          result_count: 3,
        }),
      ]),
    );
    expect(logs.filter(log => log.event === 'request.completed')).toHaveLength(1);
  },
);

integrationTest('collects one dated snapshot and tolerates concurrent duplicate collection', async ({ db }) => {
  const fetchFeed = vi.fn<typeof fetch>().mockImplementation(async () => new Response(xml));
  const { service, repository } = createCollector(db, fetchFeed);
  const now = new Date('2026-10-17T17:00:00Z');
  await Promise.all([service.collectLatest(now), service.collectLatest(now)]);
  expect(await db.select().from(exchangeRate)).toHaveLength(1);
  expect(await repository.latestSnapshot()).toEqual(
    ok({
      base: 'EUR',
      date: '2026-10-16',
      rates: { EUR: 1, USD: 1.25, JPY: 150, GBP: 0.8 },
    }),
  );
  expect(await service.collectLatest(now)).toEqual(ok({ status: 'skipped', date: '2026-10-16' }));
});

integrationTest('skips the provider when today already has a snapshot', async ({ db }) => {
  await db.insert(exchangeRate).values({
    date: '2026-10-17',
    rates: { EUR: 1, USD: 1.2, JPY: 140 },
    collectedAt: new Date('2026-10-17T08:00:00Z'),
  });
  const fetchFeed = vi.fn<typeof fetch>();
  const { service } = createCollector(db, fetchFeed);
  expect(await service.collectLatest(new Date('2026-10-17'))).toEqual(ok({ status: 'skipped', date: '2026-10-17' }));
  expect(fetchFeed).not.toHaveBeenCalled();
});

integrationTest('retains stored rates when the provider returns an HTTP failure', async ({ db }) => {
  const collectedAt = new Date('2026-10-15T17:00:00Z');
  await db.insert(exchangeRate).values({ date: '2026-10-15', rates: { EUR: 1, USD: 1.2, JPY: 140 }, collectedAt });
  const fetchFeed = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unavailable', { status: 503 }));
  const { service, repository } = createCollector(db, fetchFeed);
  const collection = await service.collectLatest(new Date('2026-10-17'));
  assert(collection.isErr());
  expect(collection.error).toBeInstanceOf(ForexRequestFailed);
  expect(collection.error.message).toBe('ECB request failed: HTTP 503');
  expect(await repository.latestSnapshot()).toEqual(ok(expect.objectContaining({ date: '2026-10-15' })));
  expect(await repository.latestCollection()).toEqual(ok(expect.objectContaining({ collectedAt })));
});

integrationTest(
  'fetches once per UTC collection day even when the published rate date is unchanged',
  async ({ db }) => {
    const rates = { EUR: 1, USD: 1.2, JPY: 140 };
    await db.insert(exchangeRate).values({
      date: '2026-10-16',
      rates,
      collectedAt: new Date('2026-10-16T17:00:00Z'),
    });
    const fetchFeed = vi.fn<typeof fetch>().mockImplementation(async () => new Response(xml));
    const { service, repository } = createCollector(db, fetchFeed);
    const sunday = new Date('2026-10-18T09:00:00Z');
    expect(await service.collectLatest(sunday)).toEqual(ok({ status: 'skipped', date: '2026-10-16' }));
    expect(await repository.latestCollection()).toEqual(ok(expect.objectContaining({ collectedAt: sunday })));
    expect(await repository.latestSnapshot()).toEqual(ok(expect.objectContaining({ rates })));
    expect(await service.collectLatest(new Date('2026-10-18T23:59:59Z'))).toEqual(
      ok({
        status: 'skipped',
        date: '2026-10-16',
      }),
    );
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    const monday = new Date('2026-10-19T00:00:00Z');

    await service.collectLatest(monday);
    expect(fetchFeed).toHaveBeenCalledTimes(2);
    expect(await repository.latestCollection()).toEqual(ok(expect.objectContaining({ collectedAt: monday })));
    expect(await db.select().from(exchangeRate)).toHaveLength(1);
  },
);

integrationTest('retries failed daily collection instead of marking the day complete', async ({ db }) => {
  const fetchFeed = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
    .mockResolvedValueOnce(new Response(xml));

  const { service } = createCollector(db, fetchFeed);
  const now = new Date('2026-10-18T09:00:00Z');
  const failed = await service.collectLatest(now);
  assert(failed.isErr());
  expect(failed.error).toBeInstanceOf(ForexRequestFailed);
  expect(await db.select().from(exchangeRate)).toHaveLength(0);
  expect(await service.collectLatest(now)).toEqual(ok({ status: 'persisted', date: '2026-10-16' }));
  await service.collectLatest(now);
  expect(fetchFeed).toHaveBeenCalledTimes(2);
});

for (const [name, invalidXML, message] of [
  ['malformed XML', '<broken>', 'Unclosed tag'],
  ['zero rate', xml.replace('rate="150"', 'rate="0"'), 'Too small'],
  ['non-numeric rate', xml.replace('rate="150"', 'rate="NaN"'), 'Invalid input'],
  ['future date', xml.replace('2026-10-16', '2026-10-18'), 'ECB snapshot is in the future'],
]) {
  integrationTest(`rejects ${name} without replacing stored rates`, async ({ db }) => {
    await db.insert(exchangeRate).values({
      date: '2026-10-15',
      rates: { EUR: 1, USD: 1.2, JPY: 140 },
      collectedAt: new Date('2026-10-15T17:00:00Z'),
    });
    const fetchFeed = vi.fn<typeof fetch>().mockResolvedValue(new Response(invalidXML));
    const { service, repository } = createCollector(db, fetchFeed);
    const collection = await service.collectLatest(new Date('2026-10-17'));
    assert(collection.isErr());
    expect(collection.error).toBeInstanceOf(ForexInvalidResponse);
    expect(collection.error.message).toContain(message);
    expect(await repository.latestSnapshot()).toEqual(ok(expect.objectContaining({ date: '2026-10-15' })));
  });
}

integrationTest('serves the last collected rates and requires authentication', async ({ app, db }) => {
  expect((await app.request(LATEST_SNAPSHOT_ROUTE_PATH)).status).toBe(401);
  const user = await createTestUser(app, db);
  const headers = { Cookie: `better-auth.session_token=${user.sessionToken}` };
  const missing = await app.request(LATEST_SNAPSHOT_ROUTE_PATH, { headers });
  expect(missing.status).toBe(503);
  expect(await missing.json()).toEqual({ code: 'EXCHANGE_RATES_UNAVAILABLE', message: 'No exchange rates available' });
  await db.insert(exchangeRate).values({ date: '2026-10-16', rates: { EUR: 1, USD: 1.25, JPY: 150 } });
  const response = await app.request(LATEST_SNAPSHOT_ROUTE_PATH, { headers });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ base: 'EUR', date: '2026-10-16', rates: { EUR: 1, USD: 1.25, JPY: 150 } });
});

integrationTest('distinguishes no stored snapshot from a repository failure', async ({ db }) => {
  const { repository, service } = createCollector(db, vi.fn<typeof fetch>());

  expect(await repository.latestCollection()).toEqual(ok(undefined));
  expect(await repository.latestSnapshot()).toEqual(ok(undefined));
  expect(await service.findLatestSnapshot()).toEqual(ok(undefined));
});

integrationTest('orders snapshots by their rate date rather than collection time', async ({ db }) => {
  await db.insert(exchangeRate).values([
    { date: '2026-10-15', rates: { EUR: 1, USD: 1.2, JPY: 140 }, collectedAt: new Date('2026-10-18') },
    { date: '2026-10-16', rates: { EUR: 1, USD: 1.3, JPY: 150 }, collectedAt: new Date('2026-10-17') },
  ]);
  const { repository } = createCollector(db, vi.fn<typeof fetch>());

  expect(await repository.latestCollection()).toEqual(
    ok(expect.objectContaining({ snapshot: expect.objectContaining({ date: '2026-10-16' }) })),
  );
});

integrationTest(
  'returns invalid stored data as a typed error and a safe API failure',
  async ({ app, db, getLogsForRequestId }) => {
    const user = await createTestUser(app, db);
    await db.insert(exchangeRate).values({ date: '2026-10-16', rates: {} });
    const fetchFeed = vi.fn<typeof fetch>();
    const { repository, service } = createCollector(db, fetchFeed);
    const stored = await repository.latestSnapshot();

    assert(stored.isErr());
    expect(stored.error).toBeInstanceOf(ForexStoredSnapshotInvalid);
    const collection = await service.collectLatest();
    assert(collection.isErr());
    expect(collection.error).toBeInstanceOf(ForexStoredSnapshotInvalid);
    expect(fetchFeed).not.toHaveBeenCalled();
    const latest = await service.latestSnapshot();
    assert(latest.isErr());
    expect(latest.error).toBeInstanceOf(ExchangeRatesReadFailed);
    expect(latest.error.cause).toBeInstanceOf(ForexStoredSnapshotInvalid);

    const response = await app.request(LATEST_SNAPSHOT_ROUTE_PATH, {
      headers: { Cookie: `better-auth.session_token=${user.sessionToken}` },
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong' });
    const requestId = response.headers.get('tcg-request-id');
    expect(requestId).toEqual(expect.any(String));
    expect(getLogsForRequestId(String(requestId)).filter(log => log.event === 'forex.snapshot.loaded')).toHaveLength(0);
  },
);

integrationTest('captures database read and write failures in repository results', async ({ db }) => {
  const { repository, service } = createCollector(db, vi.fn<typeof fetch>());
  // Each integration test owns its database; removing this table exercises real PostgreSQL failures.
  await db.execute(sql`drop table exchange_rate`);
  const read = await repository.latestCollection();
  assert(read.isErr());
  expect(read.error).toBeInstanceOf(ForexReadFailed);
  expect(read.error.cause).toBeInstanceOf(Error);

  const write = await repository.storeSnapshot({
    base: 'EUR',
    date: '2026-10-16',
    rates: { EUR: 1, USD: 1.2, JPY: 140 },
  });

  assert(write.isErr());
  expect(write.error).toBeInstanceOf(ForexWriteFailed);
  const latest = await service.latestSnapshot();
  assert(latest.isErr());
  expect(latest.error).toBeInstanceOf(ExchangeRatesReadFailed);
  expect(latest.error.cause).toBeInstanceOf(ForexReadFailed);
});

function createCollector(db: Database, fetchFeed: typeof fetch) {
  const c = createDatabaseOnlyContext(db);
  const repository = new ForexRepository(c);
  c.set('forexRepository', repository);
  c.set('forexClient', new EcbForexClient({ fetch: fetchFeed }));

  return { repository, service: new ForexService(c) };
}
