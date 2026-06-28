import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { HonoContext, HonoEnvironment } from '../context.ts';
import { getRequestLogger, getRouteForLog, markRequestFailed } from '../logging/http.ts';
import { APIException, InvalidValidation } from './index.ts';
import { STATUS_CODES } from '../constants/http.ts';
import { logError, logWarn } from '../logging/index.ts';

export function handleServerError() {
  return ((err, ctx: HonoContext) => {
    const logger = getRequestLogger(ctx);

    if (err instanceof InvalidValidation) {
      const validationIssues = err.context?.validations ?? [];
      logWarn(logger, {
        event: 'request.validation.failed',
        route: getRouteForLog(ctx),
        status_code: err.status,
        outcome: 'failure',
        error_code: 'INVALID_PAYLOAD',
        error_name: err.name,
        validation_issue_count: validationIssues.length,
        validation_issue_paths: validationIssues.map(issue => {
          const path = issue.path.map(segment => String(segment)).join('.');
          return path.length > 0 ? path : '<root>';
        }),
      });

      return err.getResponse();
    }

    if (err instanceof APIException) {
      logWarn(logger, {
        event: 'request.error',
        route: getRouteForLog(ctx),
        status_code: err.status,
        outcome: 'failure',
        error_code: err.code,
        error_name: err.name,
      });

      return err.getResponse();
    }

    if (err instanceof HTTPException) {
      logWarn(logger, {
        event: 'request.error',
        route: getRouteForLog(ctx),
        status_code: err.status,
        outcome: 'failure',
        error_name: err.name,
      });

      return err.getResponse();
    }

    markRequestFailed(ctx);
    logError(
      logger,
      {
        event: 'request.failed',
        route: getRouteForLog(ctx),
        status_code: STATUS_CODES.INTERNAL_SERVER_ERROR,
        outcome: 'failure',
        error_code: 'INTERNAL_SERVER_ERROR',
      },
      err,
    );

    return ctx.json(
      { message: 'Something went wrong', code: 'INTERNAL_SERVER_ERROR' },
      STATUS_CODES.INTERNAL_SERVER_ERROR,
    );
  }) satisfies ErrorHandler<HonoEnvironment>;
}
