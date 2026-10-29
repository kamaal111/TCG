import { sessionHeaders } from './auth.ts';
import { createTestRequestId, getLogsForRequestId, withRequestId } from './logs.ts';
import { createTestObjectStorage } from './storage.ts';
import { createTestDatabase, createTestUser } from './utils.ts';
import { StaticScrydexClient } from '../card-pricing/scrydex/static-client.ts';
import App from '../runtime/node/app.ts';

export const integrationTest = test
  .extend('_fixturesSetup', async ({ task: _task }, { onCleanup }) => {
    const setup = await createTestDatabase('./drizzle');
    const pricingClient = new StaticScrydexClient();
    const applications: App[] = [];

    onCleanup(async () => {
      try {
        await Promise.all(applications.map(application => application.close()));
      } finally {
        await setup.cleanup();
      }
    });

    const storageClient = await createTestObjectStorage();

    const createApp = (overrides: ConstructorParameters<typeof App>[0] = {}) => {
      const application = new App({ db: setup.db, pricingClient, storageClient, ...overrides });
      applications.push(application);

      return application.app;
    };

    const app = createApp();

    return {
      app,
      createApp,
      connectionString: setup.connectionString,
      db: setup.db,
      pricingClient,
      storageClient,
      createTestRequestId,
      getLogsForRequestId,
      withRequestId,
    };
  })
  .extend('db', ({ _fixturesSetup }) => _fixturesSetup.db)
  .extend('app', ({ _fixturesSetup }) => _fixturesSetup.app)
  .extend('createApp', ({ _fixturesSetup }) => _fixturesSetup.createApp)
  .extend(
    'createUser',
    ({ app, db }) =>
      (overrides: Parameters<typeof createTestUser>[2] = {}) =>
        createTestUser(app, db, overrides),
  )
  .extend('user', ({ createUser }) => createUser())
  .extend('authenticatedHeaders', ({ user }) => sessionHeaders(user.sessionToken))
  .extend('connectionString', ({ _fixturesSetup }) => _fixturesSetup.connectionString)
  .extend('storageClient', ({ _fixturesSetup }) => _fixturesSetup.storageClient)
  .extend('pricingClient', ({ _fixturesSetup }) => _fixturesSetup.pricingClient)
  .extend('createTestRequestId', ({ _fixturesSetup }) => _fixturesSetup.createTestRequestId)
  .extend('getLogsForRequestId', ({ _fixturesSetup }) => _fixturesSetup.getLogsForRequestId)
  .extend('withRequestId', ({ _fixturesSetup }) => _fixturesSetup.withRequestId);
