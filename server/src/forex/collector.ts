import { err, ok, type Result } from 'neverthrow';

import type { ForexClient } from './client.ts';
import { FOREX_COLLECTION_STATUSES } from './constants.ts';
import { ForexInvalidResponse, type ForexError } from './errors.ts';
import type { ForexRepository } from './repository.ts';
import { toISO8601String } from '../utils/strings.ts';

export interface ForexCollectionResult {
  status: (typeof FOREX_COLLECTION_STATUSES)[keyof typeof FOREX_COLLECTION_STATUSES];
  date: string;
}

export class ForexCollector {
  private readonly repository: ForexRepository;
  private readonly client: ForexClient;

  constructor(repository: ForexRepository, client: ForexClient) {
    this.repository = repository;
    this.client = client;
  }

  async collectLatest(now = new Date()): Promise<Result<ForexCollectionResult, ForexError>> {
    const collection = await this.repository.latestCollection();

    if (collection.isErr()) {
      return err(collection.error);
    }

    const latest = collection.value;
    const today = toISO8601String(now).slice(0, 10);

    if (latest != null && toISO8601String(latest.collectedAt).slice(0, 10) >= today) {
      return ok({ status: FOREX_COLLECTION_STATUSES.SKIPPED, date: latest.snapshot.date });
    }

    const result = await this.client.latestSnapshot();

    if (result.isErr()) {
      return err(result.error);
    }

    const snapshot = result.value;

    if (snapshot.date > today) {
      return err(new ForexInvalidResponse('ECB snapshot is in the future'));
    }

    const stored = await this.repository.storeSnapshot(snapshot, now);

    if (stored.isErr()) {
      return err(stored.error);
    }

    return ok({
      status: stored.value ? FOREX_COLLECTION_STATUSES.PERSISTED : FOREX_COLLECTION_STATUSES.SKIPPED,
      date: snapshot.date,
    });
  }
}
