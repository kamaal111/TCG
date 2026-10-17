import { createDatabaseOnlyContext } from '../src/context.ts';
import db from '../src/db/index.ts';
import { EcbForexClient } from '../src/forex/client.ts';
import { forexProcessLogger } from '../src/forex/logging.ts';
import { ForexRepository } from '../src/forex/repository.ts';
import { ForexService } from '../src/forex/service.ts';

const c = createDatabaseOnlyContext(db);

c.set('forexRepository', new ForexRepository(c));

c.set('forexClient', new EcbForexClient());

const service = new ForexService(c);

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
