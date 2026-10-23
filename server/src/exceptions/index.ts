import type { StandardSchemaV1 } from '@standard-schema/spec';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { CONTENTFUL_STATUS_CODES, type ContentfulStatusCode } from '../constants/http.ts';
import type { HonoContext } from '../context.ts';

export type ExceptionContext = Pick<HonoContext, 'get'>;

export class APIException<TContext = unknown> extends HTTPException {
  readonly context?: TContext;
  readonly code: string;

  constructor(
    c: ExceptionContext | undefined,
    statusCode: ContentfulStatusCode,
    options: {
      message: string;
      code: string;
      headers?: Headers;
      context?: TContext;
      cause?: unknown;
      diagnosticMessage?: string;
    },
  ) {
    const headers = options.headers ?? new Headers();
    headers.set('Content-Type', 'application/json');

    if (c != null) {
      headers.set('Request-Id', c.get('requestId'));
    }

    const response = new Response(
      JSON.stringify({
        message: options.message,
        code: options.code,
        context: options.context,
      }),
      { status: statusCode, headers },
    );

    super(statusCode, { res: response, message: options.diagnosticMessage ?? options.message, cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.context = options.context;
  }
}

export class InvalidPayload<TContext = unknown> extends APIException<TContext> {
  constructor(c: ExceptionContext, options?: { message?: string; context?: TContext }) {
    super(c, CONTENTFUL_STATUS_CODES.BAD_REQUEST, {
      message: options?.message ?? 'Invalid payload',
      code: 'INVALID_PAYLOAD',
      context: options?.context,
    });
  }
}

export class InvalidValidation extends InvalidPayload<{
  validations: { code: string; path: string[]; message: string }[];
}> {
  constructor(c: ExceptionContext, validations: readonly StandardSchemaV1.Issue[]) {
    super(c, {
      context: {
        validations: validations.map(issue => ({
          code: z.object({ code: z.string().catch('validation_error') }).parse(issue).code,
          path: (issue.path ?? []).map(segment =>
            String(segment instanceof Object && 'key' in segment ? segment.key : segment),
          ),
          message: issue.message,
        })),
      },
    });
  }
}

export class Unauthorized extends APIException {
  constructor(c: ExceptionContext, options?: { message?: string; code?: string }) {
    super(c, CONTENTFUL_STATUS_CODES.UNAUTHORIZED, {
      message: options?.message ?? 'Unauthorized',
      code: options?.code ?? 'UNAUTHORIZED',
    });
  }
}

export class NotFound extends APIException {
  constructor(c: ExceptionContext | undefined, options?: { message?: string; code?: string }) {
    super(c, CONTENTFUL_STATUS_CODES.NOT_FOUND, {
      message: options?.message ?? 'Not found',
      code: options?.code ?? 'NOT_FOUND',
    });
  }
}

export class ServiceUnavailable extends APIException {
  constructor(c: ExceptionContext, options: { message: string; code: string; headers?: Headers }) {
    super(c, CONTENTFUL_STATUS_CODES.SERVICE_UNAVAILABLE, options);
  }
}

export class InternalServerError extends APIException {
  constructor(c?: ExceptionContext, options?: { cause?: unknown; diagnosticMessage?: string }) {
    super(c, CONTENTFUL_STATUS_CODES.INTERNAL_SERVER_ERROR, {
      message: 'Something went wrong',
      code: 'INTERNAL_SERVER_ERROR',
      cause: options?.cause,
      diagnosticMessage: options?.diagnosticMessage,
    });
  }
}
