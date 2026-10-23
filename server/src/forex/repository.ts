import type { ResultAsync } from 'neverthrow';

import type { ForexError } from './errors.ts';
import type { ForexSnapshot } from './schemas/responses.ts';
import type { ForexCollection } from './types.ts';

export interface ForexRepository {
  latestSnapshot(): ResultAsync<ForexSnapshot | undefined, ForexError>;
  latestCollection(): ResultAsync<ForexCollection | undefined, ForexError>;
  storeSnapshot(snapshot: ForexSnapshot, collectedAt?: Date): ResultAsync<boolean, ForexError>;
}
