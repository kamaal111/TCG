import { RETRY_AFTER_SECONDS } from '../constants/time.ts';
import { NotFound, ServiceUnavailable } from '../exceptions/index.ts';
import type { ExceptionContext } from '../exceptions/index.ts';

function retryHeaders() {
  return new Headers({ 'Retry-After': String(RETRY_AFTER_SECONDS) });
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

export class CardImageBusy extends ServiceUnavailable {
  constructor(c: ExceptionContext, message: string) {
    super(c, {
      message,
      code: 'CARD_IMAGE_BUSY',
      headers: retryHeaders(),
    });
  }
}
