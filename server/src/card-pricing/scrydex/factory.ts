import { RealScrydexClient } from './real-client.ts';
import { StaticScrydexClient } from './static-client.ts';
import type { ApplicationConfig } from '../../config.ts';
import { PRICING_CLIENT_MODES } from '../../constants/common.ts';
import type { PricingClient } from '../client.ts';

export function createPricingClient(config: ApplicationConfig): PricingClient {
  return config.SCRYDEX_CLIENT === PRICING_CLIENT_MODES.REAL
    ? new RealScrydexClient({
        apiKey: config.SCRYDEX_API_KEY,
        teamId: config.SCRYDEX_TEAM_ID,
        baseURL: config.SCRYDEX_BASE_URL,
        requestTimeoutMs: config.SCRYDEX_REQUEST_TIMEOUT_MS,
      })
    : new StaticScrydexClient();
}
