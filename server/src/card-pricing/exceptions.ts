import type { HonoContext } from '../context.ts';
import { STATUS_CODES } from '../constants/http.ts';
import { APIException } from '../exceptions/index.ts';

export class PricingLockTimeout extends APIException {
  constructor(c: Pick<HonoContext, 'get'>) {
    const headers = new Headers({ 'Retry-After': '1' });
    super(c, STATUS_CODES.SERVICE_UNAVAILABLE, {
      message: 'Pricing is busy; try again shortly.',
      code: 'PRICING_LOCK_TIMEOUT',
      headers,
    });
  }
}
