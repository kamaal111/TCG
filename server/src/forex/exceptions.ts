import { APIException, type ExceptionContext } from '@tcg/http/exceptions';
import { CONTENTFUL_STATUS_CODES } from '@tcg/http/status';

import type { ForexError } from './errors.ts';

export abstract class ForexException extends APIException {
  abstract readonly reason: string;
}

export class ExchangeRatesUnavailable extends ForexException {
  readonly reason = 'rates_unavailable';

  constructor(c: ExceptionContext) {
    super(c, CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE, {
      code: 'EXCHANGE_RATES_UNAVAILABLE',
      message: 'No exchange rates available',
    });
  }
}

export class ExchangeRatesReadFailed extends ForexException {
  readonly reason = 'rates_read_failed';
  override readonly cause: ForexError;

  constructor(c: ExceptionContext, cause: ForexError) {
    super(c, CONTENTFUL_STATUS_CODES.INTERNAL_SERVER_ERROR, {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong',
    });
    this.cause = cause;
  }
}
