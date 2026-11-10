import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { HttpEnvironment } from './context.ts';
import { InternalServerError } from './exceptions.ts';

// Logging happens in the logging middleware's onError hook, not here — avoid duplicating it.
export function handleServerError<E extends HttpEnvironment = HttpEnvironment>(): ErrorHandler<E> {
  return (err, ctx) => {
    const failure = err instanceof HTTPException ? err : new InternalServerError(ctx, { cause: err });
    const response = failure.getResponse();
    const headers = new Headers(response.headers);
    headers.set('Request-Id', ctx.get('requestId'));

    return ctx.newResponse(response.body, { status: failure.status, headers });
  };
}
