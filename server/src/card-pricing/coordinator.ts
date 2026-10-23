import type { ResultAsync } from 'neverthrow';

import type { CardGame } from './types.ts';
import { CONTENTFUL_STATUS_CODES } from '../constants/http.ts';
import { RETRY_AFTER_SECONDS } from '../constants/time.ts';
import { APIException } from '../exceptions/index.ts';

export interface PricingIdentity {
  game: CardGame;
  key: string;
  keyType: 'card' | 'search';
  pricedOn: string;
}

export class PricingCoordinationFailure extends APIException {
  readonly reason: 'timeout' | 'unavailable' | 'operation_failed';

  constructor(reason: PricingCoordinationFailure['reason'], cause: unknown) {
    const timedOut = reason === 'timeout';
    super(
      undefined,
      timedOut ? CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE : CONTENTFUL_STATUS_CODES.INTERNAL_SERVER_ERROR,
      {
        message: timedOut ? 'Pricing is busy; try again shortly.' : 'Something went wrong',
        code: timedOut ? 'PRICING_LOCK_TIMEOUT' : 'INTERNAL_SERVER_ERROR',
        headers: timedOut ? new Headers({ 'Retry-After': String(RETRY_AFTER_SECONDS) }) : undefined,
        cause,
      },
    );
    this.reason = reason;
  }
}

/** Exclusive across instances, bounded acquisition, release even when the operation fails. */
export interface PricingCoordinator {
  runExclusive<T>(identity: PricingIdentity, operation: () => Promise<T>): ResultAsync<T, PricingCoordinationFailure>;
}
