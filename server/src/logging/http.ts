import { routePath } from 'hono/route';
import type { Logger } from 'pino';

import type { HonoContext } from '../context.ts';
import { childLogger, createRequestLogger, type LogBindings } from './index.ts';
import env from '../env.ts';
import type { ServerMode } from '../constants/common.ts';

export function initializeRequestLogger(c: HonoContext, mode: ServerMode) {
  const logger = createRequestLogger({
    requestId: c.get('requestId'),
    method: c.req.method,
    path: c.req.path,
    url: c.req.url,
    route: getMatchedRoutePath(c),
    mode,
    userAgent: c.req.header('User-Agent'),
  });

  c.set('logger', logger);

  return logger;
}

export function getRequestLogger(c: HonoContext) {
  const existingLogger = c.get('logger') ?? initializeRequestLogger(c, env.MODE);

  return bindAuthenticatedUserIdFromContext(c, existingLogger);
}

export function withRequestLogger(c: HonoContext, bindings: LogBindings) {
  return childLogger(getRequestLogger(c), bindings);
}

export function getRouteForLog(c: HonoContext) {
  return getMatchedRoutePath(c);
}

export function markRequestFailed(c: HonoContext) {
  c.set('requestFailed', true);
}

export function hasRequestFailed(c: HonoContext) {
  return c.get('requestFailed') === true;
}

function getLoggerBindings(logger: Logger): Record<string, unknown> {
  const bindings = logger.bindings();

  return bindings != null && typeof bindings === 'object' ? bindings : {};
}

function bindAuthenticatedUserIdFromContext(c: HonoContext, logger: Logger) {
  const existingUserId = getLoggerBindings(logger).user_id;
  if (typeof existingUserId === 'string' && existingUserId.length > 0) {
    return logger;
  }

  const session = c.get('session');
  const userId = session?.user.id;
  if (!userId) {
    return logger;
  }

  const loggerWithUserId = childLogger(logger, { user_id: userId });
  c.set('logger', loggerWithUserId);

  return loggerWithUserId;
}

function getMatchedRoutePath(c: HonoContext) {
  const matchedRoutePath = routePath(c);

  return matchedRoutePath.length > 0 && !matchedRoutePath.includes('*') ? matchedRoutePath : c.req.path;
}
