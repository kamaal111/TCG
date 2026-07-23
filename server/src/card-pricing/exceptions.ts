import { STATUS_CODES } from '../constants/http.ts';
import { APIException, type ExceptionContext } from '../exceptions/index.ts';

export class PricingLockTimeout extends APIException {
  constructor(c: ExceptionContext) {
    const headers = new Headers({ 'Retry-After': '1' });
    super(c, STATUS_CODES.SERVICE_UNAVAILABLE, {
      message: 'Pricing is busy; try again shortly.',
      code: 'PRICING_LOCK_TIMEOUT',
      headers,
    });
  }
}

export class PricingProviderUnavailable extends APIException {
  constructor(c: ExceptionContext) {
    const headers = new Headers({ 'Retry-After': '1' });
    super(c, STATUS_CODES.SERVICE_UNAVAILABLE, {
      message: 'Card pricing data is temporarily unavailable; try again shortly.',
      code: 'PRICING_PROVIDER_UNAVAILABLE',
      headers,
    });
  }
}
