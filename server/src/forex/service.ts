import { err, ok, type Result } from 'neverthrow';

import { FOREX_COLLECTION_STATUSES } from './constants.ts';
import type { ForexDisplayContext } from './display.ts';
import { ForexInvalidResponse, type ForexError } from './errors.ts';
import { ExchangeRatesReadFailed, ExchangeRatesUnavailable, type ForexException } from './exceptions.ts';
import type { HonoContext } from '../context.ts';
import type { ForexSnapshot } from './schemas/responses.ts';
import { toISO8601String } from '../utils/strings.ts';
import type { GetRecordValues } from '../utils/type-utils.ts';

interface ForexCollectionResult {
  status: GetRecordValues<typeof FOREX_COLLECTION_STATUSES>;
  date: string;
}

export class ForexService {
  private readonly c: HonoContext;

  constructor(c: HonoContext) {
    this.c = c;
  }

  private get repository() {
    return this.c.get('forexRepository');
  }

  async findLatestSnapshot(): Promise<Result<ForexSnapshot | undefined, ForexException>> {
    return (await this.repository.latestSnapshot()).mapErr(error => new ExchangeRatesReadFailed(this.c, error));
  }

  async displayContext(): Promise<Result<ForexDisplayContext, ForexException>> {
    const currency = this.c.get('preferredCurrency');

    return (await this.findLatestSnapshot()).map(snapshot => ({ currency, snapshot }));
  }

  async latestSnapshot(): Promise<Result<ForexSnapshot, ForexException>> {
    const result = await this.findLatestSnapshot();

    if (result.isErr()) {
      return err(result.error);
    }

    const snapshot = result.value;

    if (snapshot == null) {
      return err(new ExchangeRatesUnavailable(this.c));
    }

    return ok(snapshot);
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

    const result = await this.c.get('forexClient').latestSnapshot();

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
