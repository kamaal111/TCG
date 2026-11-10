import { getProcessLogger } from '@tcg/http/logging';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { ResultAsync } from 'neverthrow';
import { Pool } from 'pg';

import {
  PricingCoordinationFailure,
  type PricingCoordinator,
  type PricingIdentity,
} from '../../card-pricing/coordinator.ts';
import type { PricingLogFields } from '../../card-pricing/logging.ts';
import { classifyPostgresError } from '../../db/errors.ts';
import type { Database } from '../../db/index.ts';
import { appRelations } from '../../db/schema/index.ts';
import { trackPoolShutdown } from '../../utils/pool-shutdown.ts';
import { toError, tryCatch } from '../../utils/results.ts';

export class PostgresPricingCoordinator implements PricingCoordinator {
  private readonly db: Database;
  private readonly timeoutMs: number;
  readonly close: () => Promise<void>;

  constructor(db: Database, timeoutMs: number) {
    const pool = new Pool({
      ...db.$client.options,
      password: db.$client.options.password,
      max: 2,
      connectionTimeoutMillis: timeoutMs,
    });

    pool.on('error', err => {
      getProcessLogger<PricingLogFields>().error(
        { event: 'pricing.lock.pool_error', outcome: 'failure', error_code: 'PRICING_LOCK_UNAVAILABLE', err },
        'Lost an idle pricing lock connection.',
      );
    });
    this.close = trackPoolShutdown(pool);
    this.db = drizzle({ client: pool, relations: appRelations });
    this.timeoutMs = timeoutMs;
  }

  runExclusive<T>(identity: PricingIdentity, operation: () => Promise<T>): ResultAsync<T, PricingCoordinationFailure> {
    const deadline = performance.now() + this.timeoutMs;
    let acquired = false;

    return tryCatch(() => {
      return this.db.transaction(async tx => {
        const remainingMs = Math.ceil(deadline - performance.now());

        if (remainingMs <= 0) {
          throw new PricingCoordinationFailure('timeout', undefined);
        }

        await tx.execute(sql`select set_config('lock_timeout', ${`${remainingMs}ms`}, true)`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity.key}, 0))`);

        if (performance.now() >= deadline) {
          throw new PricingCoordinationFailure('timeout', undefined);
        }

        acquired = true;
        await tx.execute(sql`select set_config('lock_timeout', '0', true)`);

        return operation();
      });
    }).mapErr(cause => {
      if (acquired) {
        return new PricingCoordinationFailure('operation_failed', cause);
      }

      const error = toError(cause);

      const timedOut =
        error.message === 'timeout exceeded when trying to connect' ||
        performance.now() >= deadline ||
        classifyPostgresError(error) === 'lock_not_available';

      return new PricingCoordinationFailure(timedOut ? 'timeout' : 'unavailable', cause);
    });
  }
}
