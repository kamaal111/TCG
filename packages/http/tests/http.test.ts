import { requestId } from 'hono/request-id';

import { REQUEST_ID_HEADER_NAME } from '../src/common.ts';
import { handleServerError } from '../src/error-handler.ts';
import { Conflict } from '../src/exceptions.ts';
import { loggingMiddleware } from '../src/logging-middleware.ts';
import { configureLogging } from '../src/logging.ts';
import { createNodeLogger } from '../src/node-logging.ts';
import { openAPIRouterFactory } from '../src/open-api.ts';

test('shared middleware serves a standalone Hono app without production services', async () => {
  const root = createNodeLogger({ service: 'http-test', mode: 'TEST', level: 'silent' });
  configureLogging({ root, createRequestLogger: fields => root.child(fields) });
  const app = openAPIRouterFactory();
  app.onError(handleServerError()).use(requestId({ headerName: REQUEST_ID_HEADER_NAME }));
  app.use(async (c, next) => {
    c.set('config', { MODE: 'TEST' });
    await next();
  });
  app.use(loggingMiddleware());
  app.get('/conflict', () => {
    throw new Conflict({ message: 'Refresh required.', code: 'REVIEW_STALE' });
  });
  const response = await app.request('/conflict', { headers: { [REQUEST_ID_HEADER_NAME]: 'shared-http-test' } });
  expect(response.status).toBe(409);
  expect(response.headers.get('Request-Id')).toBe('shared-http-test');
  expect(await response.json()).toEqual({ message: 'Refresh required.', code: 'REVIEW_STALE' });
});
