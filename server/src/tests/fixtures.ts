import App from '../app.ts';
import { createTestRequestId, getLogsForRequestId, withRequestId } from './logs.ts';
import { createTestDatabase } from './utils.ts';
import { StaticTCGGOClient } from '../card-pricing/tcggo/static-client.ts';

export const integrationTest = test
  .extend('_fixturesSetup', async ({ task: _task }, { onCleanup }) => {
    const setup = await createTestDatabase();
    const tcggo = new StaticTCGGOClient();

    onCleanup(async () => {
      await setup.cleanup();
    });

    const { app } = new App({ db: setup.db, tcggo });

    return {
      app,
      connectionString: setup.connectionString,
      db: setup.db,
      tcggo,
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
