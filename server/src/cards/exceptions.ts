import { STATUS_CODES } from '../constants/http.ts';
import { APIException } from '../exceptions/index.ts';
import type { HonoContext } from '../context.ts';

export class CardNotFound extends APIException {
  constructor(c: Pick<HonoContext, 'get'>) {
    super(c, STATUS_CODES.NOT_FOUND, {
      message: 'Card not found',
      code: 'CARD_NOT_FOUND',
    });
  }
}
