import { sql } from 'drizzle-orm';
import type { ResultAsync } from 'neverthrow';

import {
  PricingCoordinationFailure,
  type PricingCoordinator,
  type PricingIdentity,
} from '../../card-pricing/coordinator.ts';
import { classifyPostgresError } from '../../db/errors.ts';
import type { Database } from '../../db/index.ts';
import { toError, tryCatch } from '../../utils/results.ts';

export class PostgresPricingCoordinator implements PricingCoordinator {
  private readonly db: Database;
  private readonly timeoutMs: number;

  constructor(db: Database, timeoutMs: number) {
    this.db = db;
    this.timeoutMs = timeoutMs;
  }

  runExclusive<T>(identity: PricingIdentity, operation: () => Promise<T>): ResultAsync<T, PricingCoordinationFailure> {
    let acquired = false;

    return tryCatch(() =>
      this.db.transaction(async tx => {
        await tx.execute(sql`select set_config('lock_timeout', ${`${this.timeoutMs}ms`}, true)`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity.key}, 0))`);
        acquired = true;
        await tx.execute(sql`select set_config('lock_timeout', '0', true)`);

        return operation();
      }),
    ).mapErr(cause => {
      if (acquired) {
        return new PricingCoordinationFailure('operation_failed', cause);
      }

      const reason = classifyPostgresError(toError(cause)) === 'lock_not_available' ? 'timeout' : 'unavailable';

      return new PricingCoordinationFailure(reason, cause);
    });
  }
}
