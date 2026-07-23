import { RealScrydexClient } from './real-client.ts';
import { StaticScrydexClient } from './static-client.ts';
import { PRICING_CLIENT_MODES } from '../../constants/common.ts';
import env from '../../env.ts';
import type { PricingClient } from '../client.ts';

export function createPricingClient(): PricingClient {
  return env.SCRYDEX_CLIENT === PRICING_CLIENT_MODES.REAL ? new RealScrydexClient() : new StaticScrydexClient();
}
