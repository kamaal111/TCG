import { FOREX_COLLECTION_STATUSES } from './constants.ts';
import type { HonoContext } from '../context.ts';
import type { ForexSnapshot } from './schemas/responses.ts';
import { ServiceUnavailable } from '../exceptions/index.ts';
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

  async latestSnapshot(): Promise<ForexSnapshot> {
    const snapshot = await this.repository.latestSnapshot();

    if (snapshot == null) {
      throw new ServiceUnavailable(this.c, {
        code: 'EXCHANGE_RATES_UNAVAILABLE',
        message: 'No exchange rates available',
      });
    }

    return snapshot;
  }

  async collectLatest(now = new Date()): Promise<ForexCollectionResult> {
    const latest = await this.repository.latestSnapshot();
    const today = toISO8601String(now).slice(0, 10);

    if (latest != null && latest.date >= today) {
      return { status: FOREX_COLLECTION_STATUSES.SKIPPED, date: latest.date };
    }

    const result = await this.c.get('forexClient').latestSnapshot();

    if (result.isErr()) {
      throw result.error;
    }

    const snapshot = result.value;

    if (snapshot.date > today) {
      throw new Error('ECB snapshot is in the future');
    }

    const stored = await this.repository.storeSnapshot(snapshot);

    return {
      status: stored ? FOREX_COLLECTION_STATUSES.PERSISTED : FOREX_COLLECTION_STATUSES.SKIPPED,
      date: snapshot.date,
    };
  }
}
