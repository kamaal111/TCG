import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { APIException } from './index.ts';
import { STATUS_CODES } from '../constants/http.ts';
import type { HonoContext, HonoEnvironment } from '../context.ts';

// Logging happens in the logging middleware's onError hook, not here — avoid duplicating it.
export function handleServerError() {
  return ((err, ctx: HonoContext) => {
    if (err instanceof APIException || err instanceof HTTPException) {
      return err.getResponse();
    }

    return ctx.json(
      { message: 'Something went wrong', code: 'INTERNAL_SERVER_ERROR' },
      STATUS_CODES.INTERNAL_SERVER_ERROR,
    );
  }) satisfies ErrorHandler<HonoEnvironment>;
}
