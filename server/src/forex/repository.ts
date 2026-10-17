import { desc } from 'drizzle-orm';

import { FOREX_BASE_CURRENCY } from './constants.ts';
import type { HonoContext } from '../context.ts';
import { ForexSnapshotSchema, type ForexSnapshot } from './schemas/responses.ts';
import { exchangeRate } from '../db/schema/forex.ts';

export class ForexRepository {
  private readonly c: HonoContext;

  constructor(c: HonoContext) {
    this.c = c;
  }

  private get db() {
    return this.c.get('db');
  }

  async latestSnapshot(): Promise<ForexSnapshot | undefined> {
    const [row] = await this.db
      .select({ date: exchangeRate.date, rates: exchangeRate.rates })
      .from(exchangeRate)
      .orderBy(desc(exchangeRate.date))
      .limit(1);

    return row != null
      ? ForexSnapshotSchema.parse({ base: FOREX_BASE_CURRENCY, date: row.date, rates: row.rates })
      : undefined;
  }

  async storeSnapshot(snapshot: ForexSnapshot): Promise<boolean> {
    const inserted = await this.db
      .insert(exchangeRate)
      .values({ date: snapshot.date, rates: snapshot.rates })
      .onConflictDoNothing()
      .returning({ date: exchangeRate.date });

    return inserted.length > 0;
  }
}
