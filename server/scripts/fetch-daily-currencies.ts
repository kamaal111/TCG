import { createDatabase } from '../src/db/index.ts';
import env from '../src/env.ts';
import { EcbForexClient } from '../src/forex/client.ts';
import { ForexCollector } from '../src/forex/collector.ts';
import { forexProcessLogger } from '../src/forex/logging.ts';
import { PostgresForexRepository } from '../src/persistence/postgres/forex.ts';
import { initializeNodeLogging } from '../src/runtime/node/logging.ts';

initializeNodeLogging();

const db = createDatabase({
  url: env.DATABASE_URL,
  debug: env.DEBUG,
  connectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT_MS,
});

const service = new ForexCollector(new PostgresForexRepository(db), new EcbForexClient());

const logger = forexProcessLogger();

try {
  const result = await service.collectLatest();

  if (result.isErr()) {
    throw result.error;
  }

  logger.info(
    {
      event: 'forex.collect.completed',
      outcome: 'success',
      rate_date: result.value.date,
      collection_status: result.value.status,
    },
    'Daily exchange-rate collection completed.',
  );
} catch (err) {
  logger.error(
    { event: 'forex.collect.failed', outcome: 'failure', error_code: 'FOREX_COLLECTION_FAILED', err },
    'Daily exchange-rate collection failed.',
  );
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
