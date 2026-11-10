import { NotFound, type ExceptionContext } from '@tcg/http/exceptions';

export class CardNotFound extends NotFound {
  constructor(c?: ExceptionContext) {
    super(c, { message: 'Card not found', code: 'CARD_NOT_FOUND' });
  }
}
