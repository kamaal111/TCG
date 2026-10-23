import type { ForexSnapshot } from './schemas/responses.ts';

export interface ForexCollection {
  snapshot: ForexSnapshot;
  collectedAt: Date;
}
