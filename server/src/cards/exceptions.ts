import { Conflict, InvalidValidation, NotFound, type ExceptionContext } from '@tcg/http/exceptions';

export class InvalidCatalogPrinting extends InvalidValidation {
  constructor(paths: readonly (readonly (string | number)[])[], kind: keyof typeof PRINTING_ISSUES) {
    super(
      undefined,
      paths.map(path => ({ ...PRINTING_ISSUES[kind], path })),
    );
  }
}

const PRINTING_ISSUES = {
  create: {
    code: 'invalid_printing',
    message: 'The printing ID could not be found in the catalog. Select the printing again from Search or Wishlist.',
  },
  import: {
    code: 'invalid_printing',
    message: 'The printing ID could not be found in the catalog. Retry the catalog lookup and select a printing.',
  },
  conflict: {
    code: 'printing_conflict',
    message:
      'The selected printing conflicts with the saved card for this ID. Select the printing already in your collection.',
  },
} as const;

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
