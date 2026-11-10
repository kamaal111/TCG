import type { RequestIdVariables } from 'hono/request-id';

import type { ServerMode } from './common.ts';
import type { RequestLogger } from './logging.ts';
import type { CardImportProgress } from './progress.ts';

/** Minimum shared HTTP infrastructure; no application services or persistence. */
export interface HttpEnvironment {
  Variables: RequestIdVariables & {
    logger: RequestLogger;
    config: { MODE: ServerMode };
    cardImportProgress?: CardImportProgress;
  };
}
