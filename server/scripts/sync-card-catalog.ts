import { CardCatalog, CATALOG_BUILD_STATUS_MAP } from '../src/card-pricing/catalog.ts';
import { createPricingClient } from '../src/card-pricing/scrydex/factory.ts';
import { RealScrydexClient } from '../src/card-pricing/scrydex/real-client.ts';
import { CARD_GAMES } from '../src/cards/types.ts';
import { createDatabase } from '../src/db/index.ts';
import env from '../src/env.ts';
import { PostgresCardCatalog } from '../src/persistence/postgres/card-catalog.ts';
import { initializeNodeLogging } from '../src/runtime/node/logging.ts';

initializeNodeLogging();

const client = createPricingClient(env);
const onlyMissing = process.argv.includes('--if-missing');

if (!(client instanceof RealScrydexClient)) {
  console.error('Card catalog sync requires the real Scrydex client.');
  process.exitCode = 1;
} else {
  const db = createDatabase({ url: env.DATABASE_URL, connectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT_MS });
  const catalog = new CardCatalog(new PostgresCardCatalog(db, client.source), client);

  try {
    for (const game of CARD_GAMES) {
      if (onlyMissing && (await catalog.repository.generation(game, undefined)) != null) {
        continue;
      }

      if ((await catalog.refresh(game, !onlyMissing)) !== CATALOG_BUILD_STATUS_MAP.READY) {
        console.error(`Card catalog sync did not finish for ${game}.`);
        process.exitCode = 1;
      }
    }
  } finally {
    await db.$client.end();
  }
}
