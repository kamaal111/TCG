import { eq } from 'drizzle-orm';
import { err, ok, type ResultAsync } from 'neverthrow';

import type { Database } from '../../db/index.ts';
import { exchangeRate } from '../../db/schema/forex.ts';
import { FOREX_BASE_CURRENCY } from '../../forex/constants.ts';
import { ForexReadFailed, ForexStoredSnapshotInvalid, ForexWriteFailed, type ForexError } from '../../forex/errors.ts';
import type { ForexRepository } from '../../forex/repository.ts';
import { ForexSnapshotSchema, type ForexSnapshot } from '../../forex/schemas/responses.ts';
import type { ForexCollection } from '../../forex/types.ts';
import { tryCatch } from '../../utils/results.ts';

export class PostgresForexRepository implements ForexRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
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
