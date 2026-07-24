import type { Env } from '../../env.ts';
import type { TCGGOClient } from './client.ts';
import { RealTCGGOClient } from './real-client.ts';
import { StaticTCGGOClient } from './static-client.ts';

export function createTCGGOClient(env: Env): TCGGOClient {
  return env.TCGGO_CLIENT === 'real' ? new RealTCGGOClient(env) : new StaticTCGGOClient();
}
