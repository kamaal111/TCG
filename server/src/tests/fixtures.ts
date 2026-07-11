import App from '../app.ts';
import { createTestRequestId, getLogsForRequestId, withRequestId } from './logs.ts';
import { createTestDatabase } from './utils.ts';

export const integrationTest = test
  .extend('_fixturesSetup', async ({ task: _task }, { onCleanup }) => {
    const setup = await createTestDatabase();

    onCleanup(async () => {
      await setup.cleanup();
    });

    const { app } = new App({ db: setup.db });

    return { app, db: setup.db, createTestRequestId, getLogsForRequestId, withRequestId };
  })
  .extend('db', ({ _fixturesSetup }) => _fixturesSetup.db)
  .extend('app', ({ _fixturesSetup }) => _fixturesSetup.app)
  .extend('createTestRequestId', ({ _fixturesSetup }) => _fixturesSetup.createTestRequestId)
  .extend('getLogsForRequestId', ({ _fixturesSetup }) => _fixturesSetup.getLogsForRequestId)
  .extend('withRequestId', ({ _fixturesSetup }) => _fixturesSetup.withRequestId);
