import type { ResultAsync } from 'neverthrow';

import type { HonoContext } from '../context.ts';
import type { PricingIdentity as PricingLock } from './coordinator.ts';
import {
  CARD_PRICING_EXCEPTION_CODES,
  PricingLockTimeout,
  PricingLockUnavailable,
  PricingProviderUnavailable,
  PricingOperationFailed,
  type PricingLockError,
} from './exceptions.ts';
import { pricingLogger } from './logging.ts';
import { toError } from '../utils/results.ts';

export class PricingOperation {
  private readonly c: HonoContext;

  constructor(c: HonoContext) {
    this.c = c;
  }

  withPricingLock<T>(lock: PricingLock, operation: () => Promise<T>): ResultAsync<T, PricingLockError> {
    const lockStartedAt = performance.now();
    let lockWaitMs = 0;
    let acquired = false;

    return this.c
      .get('persistence')
      .pricingCoordinator.runExclusive(lock, async () => {
        lockWaitMs = Math.round(performance.now() - lockStartedAt);
        acquired = true;

        return operation();
      })
      .map(value => {
        this.logLock({ lock, lockStatus: 'acquired', lockWaitMs, outcome: 'success' });

        return value;
      })
      .mapErr((error): PricingLockError => {
        if (!acquired) {
          lockWaitMs = Math.round(performance.now() - lockStartedAt);
        }

        const cause = toError(error.cause);
        const timedOut = error.reason === 'timeout';

        let failure: PricingLockError;
        let errorCode: string;
        let lockStatus: 'acquired' | 'failed' | 'timeout';

        if (timedOut) {
          failure = new PricingLockTimeout(this.c, cause);
          errorCode = CARD_PRICING_EXCEPTION_CODES.PRICING_LOCK_TIMEOUT;
          lockStatus = 'timeout';
        } else if (!acquired) {
          failure = new PricingLockUnavailable(this.c, cause);
          errorCode = CARD_PRICING_EXCEPTION_CODES.PRICING_PROVIDER_UNAVAILABLE;
          lockStatus = 'failed';
        } else if (cause instanceof PricingProviderUnavailable) {
          failure = cause;
          errorCode = CARD_PRICING_EXCEPTION_CODES.PRICING_PROVIDER_UNAVAILABLE;
          lockStatus = 'acquired';
        } else {
          failure = new PricingOperationFailed(this.c, cause);
          errorCode = 'PRICING_OPERATION_FAILED';
          lockStatus = 'acquired';
        }

        this.logLock({
          lock,
          lockStatus,
          lockWaitMs,
          outcome: 'failure',
          errorCode,
          failure,
        });

        return failure;
      });
  }

  private logLock({
    lock,
    lockStatus,
    lockWaitMs,
    outcome,
    errorCode,
    failure,
  }: {
    lock: PricingLock;
    lockStatus: 'acquired' | 'failed' | 'timeout';
    lockWaitMs: number;
  } & (
    | { outcome: 'success'; errorCode?: never; failure?: never }
    | { outcome: 'failure'; errorCode: string; failure: PricingLockError }
  )) {
    const fields = {
      event: 'pricing.lock.completed',
      game: lock.game,
      lock_key_type: lock.keyType,
      lock_status: lockStatus,
      lock_wait_ms: lockWaitMs,
      priced_on: lock.pricedOn,
    } as const;

    const logger = pricingLogger(this.c);

    if (outcome === 'success') {
      logger.info({ ...fields, outcome }, 'Completed a card pricing lock operation.');

      return;
    }

    if (failure instanceof PricingOperationFailed || failure instanceof PricingLockUnavailable) {
      logger.error(
        { ...fields, outcome, error_code: errorCode, err: failure },
        'Failed a card pricing lock operation unexpectedly.',
      );

      return;
    }

    logger.warn({ ...fields, outcome, error_code: errorCode }, 'Completed a card pricing lock operation.');
  }
}
