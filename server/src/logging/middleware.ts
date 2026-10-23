import { structuredLogger } from '@hono/structured-logger';
import { HTTPException } from 'hono/http-exception';
import { routePath } from 'hono/route';

import { type RequestLogger, createRequestLogger } from './index.ts';
import { type RequestLogFields, requestLogger } from './request.ts';
import { CONTENTFUL_STATUS_CODES } from '../constants/http.ts';
import type { HonoContext, HonoEnvironment } from '../context.ts';
import { APIException, InvalidValidation } from '../exceptions/index.ts';

function loggingMiddleware() {
  return structuredLogger<HonoEnvironment, RequestLogger>({
    createLogger: c =>
      createRequestLogger({
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        url: getUrlForLog(c),
        mode: c.get('config').MODE,
        userAgent: c.req.header('User-Agent'),
      }),
    onResponse: (_logger, c, elapsedMs) => {
      requestLogger(c).info(
        {
          event: 'request.completed',
          import_stage: c.get('cardImportProgress')?.stage,
          import_last_completed_stage: c.get('cardImportProgress')?.lastCompletedStage,
          transaction_status: c.get('cardImportProgress')?.transactionStatus,
          route: getRouteForLog(c),
          status_code: c.res.status,
          duration_ms: roundDurationMs(elapsedMs),
          outcome: c.res.status >= CONTENTFUL_STATUS_CODES.BAD_REQUEST ? 'failure' : 'success',
        },
        'Completed HTTP request.',
      );
    },
    onError: (_logger, error, c, elapsedMs) => {
      const { level, fields, message } = describeError(error);
      requestLogger(c)[level](
        {
          ...fields,
          import_stage: c.get('cardImportProgress')?.stage,
          import_last_completed_stage: c.get('cardImportProgress')?.lastCompletedStage,
          transaction_status: c.get('cardImportProgress')?.transactionStatus,
          route: getRouteForLog(c),
          status_code: c.res.status,
          duration_ms: roundDurationMs(elapsedMs),
          outcome: 'failure',
        },
        message,
      );
    },
  });
}

interface ErrorLogDescription {
  level: 'error' | 'warn';
  fields: Pick<
    RequestLogFields,
    | 'event'
    | 'error_code'
    | 'validation_issue_count'
    | 'validation_issue_paths'
    | 'validation_issue_codes'
    | 'validation_issue_messages'
  > & {
    err?: unknown;
  };
  message: string;
}

function describeError(error: Error): ErrorLogDescription {
  if (error instanceof APIException && error.status === CONTENTFUL_STATUS_CODES.INTERNAL_SERVER_ERROR) {
    return describeInternalFailure(error);
  }

  if (error instanceof InvalidValidation) {
    const validationIssues = error.context?.validations ?? [];

    return {
      level: 'warn',
      fields: {
        event: 'request.validation.failed',
        error_code: error.code,
        validation_issue_count: validationIssues.length,
        validation_issue_codes: validationIssues.map(issue => issue.code),
        validation_issue_messages: validationIssues.map(issue => issue.message),
        validation_issue_paths: validationIssues.map(issue => {
          const path = issue.path.join('.');

          return path.length > 0 ? path : '<root>';
        }),
      },
      message: 'Request validation failed.',
    };
  }

  if (error instanceof APIException) {
    return {
      level: 'warn',
      fields: { event: 'request.error', error_code: error.code },
      message: 'Request failed with an expected application error.',
    };
  }

  if (error instanceof HTTPException) {
    return {
      level: 'warn',
      fields: { event: 'request.error', error_code: 'HTTP_ERROR' },
      message: 'Request failed with an HTTP error.',
    };
  }

  return describeInternalFailure(error);
}

function describeInternalFailure(error: Error): ErrorLogDescription {
  return {
    level: 'error',
    fields: { event: 'request.failed', error_code: 'INTERNAL_SERVER_ERROR', err: error },
    message: 'Request failed with an unexpected server error.',
  };
}

// Falls back to c.req.path because routePath() isn't resolved yet this early in the middleware chain.
function getRouteForLog(c: HonoContext) {
  const matchedRoutePath = routePath(c);

  return matchedRoutePath.length > 0 && !matchedRoutePath.includes('*') ? matchedRoutePath : c.req.path;
}

function roundDurationMs(durationMs: number) {
  return Math.round(durationMs * 100) / 100;
}

function getUrlForLog(c: HonoContext) {
  const url = new URL(c.req.url);
  url.search = '';
  url.hash = '';

  return url.href;
}

export default loggingMiddleware;
