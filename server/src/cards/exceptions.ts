import { Conflict, NotFound, type ExceptionContext } from '@tcg/http/exceptions';

export class CardNotFound extends NotFound {
  constructor(c?: ExceptionContext) {
    super(c, { message: 'Card not found', code: 'CARD_NOT_FOUND' });
  }
}

export class OfflineCollectionConflict extends Conflict {
  constructor() {
    super({ code: 'OFFLINE_COLLECTION_CHANGED', message: 'The offline collection changed. Refresh and try again.' });
  }
}
