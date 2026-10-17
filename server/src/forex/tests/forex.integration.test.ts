import { createDatabaseOnlyContext } from '../../context.ts';
import type { Database } from '../../db/index.ts';
import { exchangeRate } from '../../db/schema/forex.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import { createTestUser } from '../../tests/utils.ts';
import { EcbForexClient } from '../client.ts';
import { ForexRepository } from '../repository.ts';
import { LATEST_SNAPSHOT_ROUTE_PATH } from '../routes/latest-snapshot.ts';
import { ForexService } from '../service.ts';

const xml = `<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time="2026-10-16"><Cube currency="USD" rate="1.25"/><Cube currency="JPY" rate="150"/><Cube currency="GBP" rate="0.8"/></Cube></Cube></gesmes:Envelope>`;

integrationTest('collects one dated snapshot and tolerates concurrent duplicate collection', async ({ db }) => {
  const fetchFeed = vi.fn<typeof fetch>().mockImplementation(async () => new Response(xml));
  const { service, repository } = createCollector(db, fetchFeed);
  const now = new Date('2026-10-17T17:00:00Z');
  await Promise.all([service.collectLatest(now), service.collectLatest(now)]);
  expect(await db.select().from(exchangeRate)).toHaveLength(1);
  expect(await repository.latestSnapshot()).toEqual({
    base: 'EUR',
    date: '2026-10-16',
    rates: { EUR: 1, USD: 1.25, JPY: 150, GBP: 0.8 },
  });
  expect(await service.collectLatest(now)).toEqual({ status: 'skipped', date: '2026-10-16' });
});

integrationTest('skips the provider when today already has a snapshot', async ({ db }) => {
  await db.insert(exchangeRate).values({ date: '2026-10-17', rates: { EUR: 1, USD: 1.2, JPY: 140 } });
  const fetchFeed = vi.fn<typeof fetch>();
  const { service } = createCollector(db, fetchFeed);
  expect(await service.collectLatest(new Date('2026-10-17'))).toEqual({ status: 'skipped', date: '2026-10-17' });
  expect(fetchFeed).not.toHaveBeenCalled();
});

integrationTest('retains stored rates when the provider returns an HTTP failure', async ({ db }) => {
  await db.insert(exchangeRate).values({ date: '2026-10-15', rates: { EUR: 1, USD: 1.2, JPY: 140 } });
  const fetchFeed = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unavailable', { status: 503 }));
  const { service, repository } = createCollector(db, fetchFeed);
  await expect(service.collectLatest(new Date('2026-10-17'))).rejects.toThrow('ECB request failed: HTTP 503');
  expect((await repository.latestSnapshot())?.date).toBe('2026-10-15');
});

for (const [name, invalidXML, message] of [
  ['malformed XML', '<broken>', 'Unclosed tag'],
  ['zero rate', xml.replace('rate="150"', 'rate="0"'), 'Too small'],
  ['non-numeric rate', xml.replace('rate="150"', 'rate="NaN"'), 'Invalid input'],
  ['future date', xml.replace('2026-10-16', '2026-10-18'), 'ECB snapshot is in the future'],
]) {
  integrationTest(`rejects ${name} without replacing stored rates`, async ({ db }) => {
    await db.insert(exchangeRate).values({ date: '2026-10-15', rates: { EUR: 1, USD: 1.2, JPY: 140 } });
    const fetchFeed = vi.fn<typeof fetch>().mockResolvedValue(new Response(invalidXML));
    const { service, repository } = createCollector(db, fetchFeed);
    await expect(service.collectLatest(new Date('2026-10-17'))).rejects.toThrow(message);
    expect((await repository.latestSnapshot())?.date).toBe('2026-10-15');
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

function createCollector(db: Database, fetchFeed: typeof fetch) {
  const c = createDatabaseOnlyContext(db);
  const repository = new ForexRepository(c);
  c.set('forexRepository', repository);
  c.set('forexClient', new EcbForexClient({ fetch: fetchFeed }));

  return { repository, service: new ForexService(c) };
}
