import { NotFound, ServiceUnavailable } from '../exceptions/index.ts';
import type { ExceptionContext } from '../exceptions/index.ts';

function retryHeaders() {
  return new Headers({
    // Seconds; the app parses this as a plain delay, not an HTTP-date.
    'Retry-After': '1',
  });
}

export class CardImageNotFound extends NotFound {
  constructor(c: ExceptionContext) {
    super(c, { message: 'Card image not found', code: 'CARD_IMAGE_NOT_FOUND' });
  }
}

export class CardImageStorageUnavailable extends ServiceUnavailable {
  constructor(c: ExceptionContext) {
    super(c, {
      message: 'Card image storage is unavailable',
      code: 'CARD_IMAGE_STORAGE_UNAVAILABLE',
      headers: retryHeaders(),
    });
  }
}
