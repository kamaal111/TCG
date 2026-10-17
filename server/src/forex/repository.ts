import { eq } from 'drizzle-orm';
import { err, ok, type ResultAsync } from 'neverthrow';

import { FOREX_BASE_CURRENCY } from './constants.ts';
import { ForexReadFailed, ForexStoredSnapshotInvalid, ForexWriteFailed, type ForexError } from './errors.ts';
import type { HonoContext } from '../context.ts';
import { ForexSnapshotSchema, type ForexSnapshot } from './schemas/responses.ts';
import { exchangeRate } from '../db/schema/forex.ts';
import { tryCatch } from '../utils/results.ts';

interface ForexCollection {
  snapshot: ForexSnapshot;
  collectedAt: Date;
}

export class ForexRepository {
  private readonly c: HonoContext;

  constructor(c: HonoContext) {
    this.c = c;
  }

  private get db() {
    return this.c.get('db');
  }

  latestSnapshot(): ResultAsync<ForexSnapshot | undefined, ForexError> {
    return this.latestCollection().map(latest => latest?.snapshot);
  }

  latestCollection(): ResultAsync<ForexCollection | undefined, ForexError> {
    return tryCatch(async () =>
      this.db.query.exchangeRate.findFirst({
        columns: { date: true, rates: true, collectedAt: true },
        orderBy: { date: 'desc' },
      }),
    )
      .mapErr(cause => new ForexReadFailed(cause))
      .andThen(row => {
        if (row == null) {
          return ok(undefined);
        }

        const snapshot = ForexSnapshotSchema.safeParse({ base: FOREX_BASE_CURRENCY, date: row.date, rates: row.rates });

        if (!snapshot.success) {
          return err(new ForexStoredSnapshotInvalid(snapshot.error));
        }

        return ok({ snapshot: snapshot.data, collectedAt: row.collectedAt });
      });
  }

  storeSnapshot(snapshot: ForexSnapshot, collectedAt = new Date()): ResultAsync<boolean, ForexError> {
    return tryCatch(async () => {
      const inserted = await this.db
        .insert(exchangeRate)
        .values({ date: snapshot.date, rates: snapshot.rates, collectedAt })
        .onConflictDoNothing()
        .returning({ date: exchangeRate.date });

      if (inserted.length === 0) {
        await this.db.update(exchangeRate).set({ collectedAt }).where(eq(exchangeRate.date, snapshot.date));
      }

      return inserted.length > 0;
    }).mapErr(cause => new ForexWriteFailed(cause));
  }
}
