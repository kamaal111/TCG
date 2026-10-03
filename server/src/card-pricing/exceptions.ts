import { CONTENTFUL_STATUS_CODES } from '../constants/http.ts';
import { RETRY_AFTER_SECONDS } from '../constants/time.ts';
import { APIException, type ExceptionContext } from '../exceptions/index.ts';

type CardPricingExceptionCode = (typeof CARD_PRICING_EXCEPTION_CODES)[keyof typeof CARD_PRICING_EXCEPTION_CODES];

export const CARD_PRICING_EXCEPTION_CODES = {
  PRICING_LOCK_TIMEOUT: 'PRICING_LOCK_TIMEOUT',
  PRICING_PROVIDER_UNAVAILABLE: 'PRICING_PROVIDER_UNAVAILABLE',
} as const;

const MESSAGE_BY_CODE: Record<CardPricingExceptionCode, string> = {
  PRICING_LOCK_TIMEOUT: 'Pricing is busy; try again shortly.',
  PRICING_PROVIDER_UNAVAILABLE: 'Card pricing data is temporarily unavailable; try again shortly.',
};

class CardPriceException extends APIException {
  override readonly cause: Error | undefined;

  constructor(c: ExceptionContext, options: { code: CardPricingExceptionCode; cause?: Error }) {
    const headers = new Headers({ 'Retry-After': String(RETRY_AFTER_SECONDS) });
    super(c, CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE, {
      message: MESSAGE_BY_CODE[options.code],
      code: options.code,
      headers,
    });
    this.cause = options.cause;
  }
}

export class PricingLockTimeout extends CardPriceException {
  readonly reason = 'lock_timeout';

  constructor(c: ExceptionContext, cause?: Error) {
    super(c, { code: CARD_PRICING_EXCEPTION_CODES.PRICING_LOCK_TIMEOUT, cause });
  }
}

export class PricingProviderUnavailable extends CardPriceException {
  readonly reason = 'provider_unavailable';

  constructor(c: ExceptionContext, cause?: Error) {
    super(c, { code: CARD_PRICING_EXCEPTION_CODES.PRICING_PROVIDER_UNAVAILABLE, cause });
  }
}

class PricingInternalFailure extends APIException {
  override readonly cause: Error;

  constructor(c: ExceptionContext, cause: Error) {
    super(c, CONTENTFUL_STATUS_CODES.INTERNAL_SERVER_ERROR, {
      message: 'Something went wrong',
      code: 'INTERNAL_SERVER_ERROR',
    });
    this.cause = cause;
  }
}

export class PricingLockUnavailable extends PricingInternalFailure {
  readonly reason = 'lock_unavailable';
}

export class PricingOperationFailed extends PricingInternalFailure {
  readonly reason = 'operation_failed';
}

/** API exceptions returned when acquiring a pricing lock or running its protected operation fails. */
export type PricingLockError =
  | PricingLockTimeout
  | PricingLockUnavailable
  | PricingProviderUnavailable
  | PricingOperationFailed;
