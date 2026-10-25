import { ApplicationConfigSchema } from '../../config.ts';
import env from '../../env.ts';
import App from '../../runtime/node/app.ts';
import { integrationTest as baseIntegrationTest } from '../../tests/fixtures.ts';
import type { CollectionPolicy } from '../types.ts';

export const integrationTest = baseIntegrationTest.extend(
  'limitedApp',
  ({ db, pricingClient, storageClient }) =>
    (policy: Partial<CollectionPolicy>) =>
      new App({
        db,
        pricingClient,
        storageClient,
        config: ApplicationConfigSchema.parse({ ...env, ...policy }),
      }).app,
);
