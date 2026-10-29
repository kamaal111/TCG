import { ApplicationConfigSchema } from '../../config.ts';
import env from '../../env.ts';
import { integrationTest as baseIntegrationTest } from '../../tests/fixtures.ts';
import type { CollectionPolicy } from '../types.ts';

export const integrationTest = baseIntegrationTest.extend(
  'limitedApp',
  ({ createApp }) =>
    (policy: Partial<CollectionPolicy>) =>
      createApp({
        config: ApplicationConfigSchema.parse({ ...env, ...policy }),
      }),
);
