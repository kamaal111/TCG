import { err, ok, type Result } from 'neverthrow';

import { ForexCollector, type ForexCollectionResult } from './collector.ts';
import type { ForexDisplayContext } from './display.ts';
import type { ForexError } from './errors.ts';
import { ExchangeRatesReadFailed, ExchangeRatesUnavailable, type ForexException } from './exceptions.ts';
import type { HonoContext } from '../context.ts';
import type { ForexSnapshot } from './schemas/responses.ts';

export class ForexService {
  private readonly c: HonoContext;
  private readonly collector: ForexCollector;

  constructor(c: HonoContext) {
    this.c = c;
    this.collector = new ForexCollector(this.repository, c.get('forexClient'));
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

  collectLatest(now = new Date()): Promise<Result<ForexCollectionResult, ForexError>> {
    return this.collector.collectLatest(now);
  }
}
