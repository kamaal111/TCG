import { HTTPException } from 'hono/http-exception';
import type z from 'zod';

import type { HonoContext } from '../context.ts';
import { STATUS_CODES, type StatusCode } from '../constants/http.ts';

type ExceptionContext = Pick<HonoContext, 'get'>;

export class APIException<TContext = unknown> extends HTTPException {
  readonly context?: TContext;
  readonly code: string;

  constructor(
    c: ExceptionContext,
    statusCode: StatusCode,
    options: {
      message: string;
      code: string;
      headers?: Headers;
      context?: TContext;
    },
  ) {
    const headers = options.headers ?? new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Request-Id', c.get('requestId'));

    const response = new Response(
      JSON.stringify({
        message: options.message,
        code: options.code,
        context: options.context,
      }),
      { status: statusCode, headers },
    );
    super(statusCode, { res: response, message: options.message });
    this.code = options.code;
    this.context = options.context;
  }
}

export class InvalidPayload<TContext = unknown> extends APIException<TContext> {
  constructor(c: ExceptionContext, options?: { message?: string; context?: TContext }) {
    super(c, STATUS_CODES.BAD_REQUEST, {
      message: options?.message ?? 'Invalid payload',
      code: 'INVALID_PAYLOAD',
      context: options?.context,
    });
  }
}

export class InvalidValidation extends InvalidPayload<{
  validations: z.ZodError['issues'];
}> {
  constructor(c: ExceptionContext, validationError: z.ZodError) {
    super(c, { context: { validations: validationError.issues } });
  }
}

export class Unauthorized extends APIException {
  constructor(c: ExceptionContext, options?: { message?: string }) {
    super(c, STATUS_CODES.UNAUTHORIZED, {
      message: options?.message ?? 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
  }
}

export class NotFound extends APIException {
  constructor(c: ExceptionContext, options?: { message?: string; code?: string }) {
    super(c, STATUS_CODES.NOT_FOUND, {
      message: options?.message ?? 'Not found',
      code: options?.code ?? 'NOT_FOUND',
    });
  }
}
