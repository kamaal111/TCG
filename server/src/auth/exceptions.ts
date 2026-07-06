import { STATUS_CODES, type StatusCode } from '../constants/http.ts';
import type { HonoContext } from '../context.ts';
import { APIException } from '../exceptions/index.ts';

const CODE_TO_STATUS: Record<string, StatusCode> = {
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: STATUS_CODES.CONFLICT,
  INVALID_EMAIL_OR_PASSWORD: STATUS_CODES.UNAUTHORIZED,
  MISSING_OR_NULL_ORIGIN: STATUS_CODES.UNAUTHORIZED,
};

export class BetterAuthException extends APIException {
  constructor(c: HonoContext, { code, message, headers }: { code: string; message: string; headers: Headers }) {
    super(c, CODE_TO_STATUS[code] ?? STATUS_CODES.INTERNAL_SERVER_ERROR, { message, code, headers });
  }
}
