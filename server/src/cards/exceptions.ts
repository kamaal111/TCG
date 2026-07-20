import type { HonoContext } from '../context.ts';
import { NotFound } from '../exceptions/index.ts';

export class CardNotFound extends NotFound {
  constructor(c: HonoContext) {
    super(c, { message: 'Card not found', code: 'CARD_NOT_FOUND' });
  }
}
