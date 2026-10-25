import { RETRY_AFTER_SECONDS } from '../constants/time.ts';
import {
  Conflict,
  InvalidValidation,
  NotFound,
  PayloadTooLarge,
  RequestTimeout,
  ServiceUnavailable,
  TooManyRequests,
} from '../exceptions/index.ts';

export class BinderFull extends InvalidValidation {
  constructor() {
    const issue = {
      code: 'binder_full',
      path: ['collection_id'],
      message: 'This binder is full. Choose another collection or increase its page dimensions.',
    };

    super(undefined, [issue]);
  }
}

export class CollectionNotFound extends NotFound {
  constructor() {
    super(undefined, { code: 'COLLECTION_NOT_FOUND', message: 'Collection not found' });
  }
}

export class LayoutConflict extends Conflict {
  constructor(message = 'This collection changed. Refresh it and try again.') {
    super({ code: 'COLLECTION_CONFLICT', message });
  }
}

export class CollectionRequestTooLarge extends PayloadTooLarge {
  constructor() {
    super(undefined, {
      code: 'COLLECTION_REQUEST_TOO_LARGE',
      message: 'The collection request exceeds the server limits.',
    });
  }
}

export class CollectionRequestTimeout extends RequestTimeout {
  constructor() {
    super(undefined, {
      code: 'COLLECTION_REQUEST_TIMEOUT',
      message: 'The collection request took too long to arrive.',
    });
  }
}

export class CollectionAccountBusy extends TooManyRequests {
  constructor() {
    super(undefined, {
      code: 'COLLECTION_BUSY',
      message: 'Another collection operation is in progress.',
      headers: new Headers({ 'Retry-After': String(RETRY_AFTER_SECONDS) }),
    });
  }
}

export class CollectionCapacityBusy extends ServiceUnavailable {
  constructor() {
    super(undefined, {
      code: 'COLLECTION_BUSY',
      message: 'Collection processing is busy. Please try again.',
      headers: new Headers({ 'Retry-After': String(RETRY_AFTER_SECONDS) }),
    });
  }
}

export class CollectionOperationTimeout extends ServiceUnavailable {
  constructor(cause?: Error) {
    super(undefined, {
      code: 'COLLECTION_OPERATION_TIMEOUT',
      message: 'The collection operation took too long. Please try again.',
      cause,
    });
  }
}
