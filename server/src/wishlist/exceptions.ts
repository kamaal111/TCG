import { NotFound, type ExceptionContext } from '@tcg/http/exceptions';

export class WishlistPricingRecordNotFound extends NotFound {
  constructor(c: ExceptionContext) {
    super(c, { code: 'WISHLIST_PRICING_RECORD_NOT_FOUND', message: 'Pricing record not found' });
  }
}
