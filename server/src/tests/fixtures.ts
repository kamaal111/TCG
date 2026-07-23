import { createTestRequestId, getLogsForRequestId, withRequestId } from './logs.ts';
import App from '../app.ts';
import { createTestDatabase } from './utils.ts';
import { StaticScrydexClient } from '../card-pricing/scrydex/static-client.ts';

export const integrationTest = test
  .extend('_fixturesSetup', async ({ task: _task }, { onCleanup }) => {
    const setup = await createTestDatabase();
    const pricingClient = new StaticScrydexClient();

    onCleanup(async () => {
      await setup.cleanup();
    });

    const { app } = new App({ db: setup.db, pricingClient });

    return {
      app,
      connectionString: setup.connectionString,
      db: setup.db,
      pricingClient,
      createTestRequestId,
      getLogsForRequestId,
      withRequestId,
    };
  })
  .extend('db', ({ _fixturesSetup }) => _fixturesSetup.db)
  .extend('app', ({ _fixturesSetup }) => _fixturesSetup.app)
  .extend('connectionString', ({ _fixturesSetup }) => _fixturesSetup.connectionString)
  .extend('createTestRequestId', ({ _fixturesSetup }) => _fixturesSetup.createTestRequestId)
  .extend('getLogsForRequestId', ({ _fixturesSetup }) => _fixturesSetup.getLogsForRequestId)
  .extend('withRequestId', ({ _fixturesSetup }) => _fixturesSetup.withRequestId);
