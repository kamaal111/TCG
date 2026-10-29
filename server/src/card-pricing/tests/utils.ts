import type { ScrydexClientOptions } from '@tcg/scrydex';

import { RealScrydexClient } from '../scrydex/real-client.ts';

export function createTestScrydexClient(
  fetchImplementation: typeof fetch,
  overrides: Omit<ScrydexClientOptions, 'fetch'> = {},
) {
  return new RealScrydexClient({
    apiKey: 'test-api-key',
    teamId: 'test-team-id',
    baseURL: 'https://api.scrydex.test',
    ...overrides,
    fetch: fetchImplementation,
  });
}
