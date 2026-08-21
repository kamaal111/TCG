import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';

import { cardsLogger } from '../../cards/logging.ts';
import { REQUEST_ID_HEADER_NAME } from '../../constants/common.ts';
import { STATUS_CODES } from '../../constants/http.ts';
import type { HonoEnvironment } from '../../context.ts';
import { handleServerError } from '../../exceptions/handler.ts';
import { InvalidPayload } from '../../exceptions/index.ts';
import { createTestRequestId, getLogsForRequestId } from '../../tests/logs.ts';
import loggingMiddleware from '../middleware.ts';

describe('Request logging middleware', () => {
  test('logs a single completion line for a successful request', async () => {
    const { app, requestId: testRequestId } = createLoggingTestApp();

    const response = await app.request('/ok', { headers: requestHeaders(testRequestId) });

    expect(response.status).toBe(STATUS_CODES.OK);
    expect(getLogsForRequestId(testRequestId)).toEqual([
      expect.objectContaining({
        event: 'request.completed',
        msg: 'Completed HTTP request.',
        outcome: 'success',
        route: '/ok',
        status_code: STATUS_CODES.OK,
        duration_ms: expect.any(Number),
        request_id: testRequestId,
        method: 'GET',
        path: '/ok',
        service: 'tcg-server',
      }),
    ]);
  });

  test('makes a domain logger available to handlers, carrying the request id', async () => {
    const { app, requestId: testRequestId } = createLoggingTestApp();

    await app.request('/handler-log', { headers: requestHeaders(testRequestId) });

    expect(getLogsForRequestId(testRequestId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'cards.list', msg: 'Handler line.', request_id: testRequestId }),
      ]),
    );
  });

  test('logs an expected application error once, and never as a completion', async () => {
    const { app, requestId: testRequestId } = createLoggingTestApp();

    const response = await app.request('/api-exception', { headers: requestHeaders(testRequestId) });

    expect(response.status).toBe(STATUS_CODES.BAD_REQUEST);
    expect(getLogsForRequestId(testRequestId)).toEqual([
      expect.objectContaining({
        event: 'request.error',
        level: WARN_LEVEL,
        outcome: 'failure',
        error_code: 'INVALID_PAYLOAD',
        route: '/api-exception',
        status_code: STATUS_CODES.BAD_REQUEST,
      }),
    ]);
  });

  test('logs a plain HTTP error as an expected failure', async () => {
    const { app, requestId: testRequestId } = createLoggingTestApp();

    const response = await app.request('/http-exception', { headers: requestHeaders(testRequestId) });

    expect(response.status).toBe(STATUS_CODES.NOT_FOUND);
    expect(getLogsForRequestId(testRequestId)).toEqual([
      expect.objectContaining({ event: 'request.error', outcome: 'failure', error_code: 'HTTP_ERROR' }),
    ]);
  });

  test('logs an unexpected error at error level with a serialized cause', async () => {
    const { app, requestId: testRequestId } = createLoggingTestApp();

    const response = await app.request('/boom', { headers: requestHeaders(testRequestId) });

    expect(response.status).toBe(STATUS_CODES.INTERNAL_SERVER_ERROR);
    const [logged, ...rest] = getLogsForRequestId(testRequestId);
    expect(rest).toEqual([]);
    expect(logged).toEqual(
      expect.objectContaining({
        event: 'request.failed',
        level: ERROR_LEVEL,
        outcome: 'failure',
        error_code: 'INTERNAL_SERVER_ERROR',
        status_code: STATUS_CODES.INTERNAL_SERVER_ERROR,
      }),
    );
    expect(logged.err).toEqual(expect.objectContaining({ message: 'Boom', stack: expect.any(String) }));
  });

  test('redacts credential-shaped fields regardless of the field vocabulary', async () => {
    const { app, requestId: testRequestId } = createLoggingTestApp();

    await app.request('/dependency-log', { headers: requestHeaders(testRequestId) });

    const [logged] = getLogsForRequestId(testRequestId);
    expect(logged).toEqual(expect.objectContaining({ email: '[Redacted]', token: '[Redacted]' }));
  });
});

const WARN_LEVEL = 40;
const ERROR_LEVEL = 50;

function requestHeaders(testRequestId: string) {
  return { [REQUEST_ID_HEADER_NAME]: testRequestId };
}

function createLoggingTestApp() {
  const app = new Hono<HonoEnvironment>()
    .onError(handleServerError())
    .use(requestId({ headerName: REQUEST_ID_HEADER_NAME }))
    .use(loggingMiddleware());

  app.get('/ok', c => c.json({ message: 'ok' }));
  app.get('/handler-log', c => {
    cardsLogger(c).info({ event: 'cards.list', outcome: 'success', result_count: 0 }, 'Handler line.');

    return c.json({ message: 'ok' });
  });
  app.get('/dependency-log', c => {
    // Simulates a dependency logging an untyped shape through the same logger instance.
    const untypedLogger = c.get('logger') as unknown as {
      info: (fields: Record<string, unknown>, message: string) => void;
    };
    untypedLogger.info({ email: 'someone@example.com', token: 'a-secret-token' }, 'Dependency line.');

    return c.json({ message: 'ok' });
  });
  app.get('/api-exception', c => {
    throw new InvalidPayload(c);
  });
  app.get('/http-exception', () => {
    throw new HTTPException(STATUS_CODES.NOT_FOUND);
  });
  app.get('/boom', () => {
    throw new Error('Boom');
  });

  return { app, requestId: createTestRequestId() };
}
