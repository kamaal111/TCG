import { Hono } from 'hono';
import { requestId } from 'hono/request-id';

import { PricingCoordinationFailure } from '../../card-pricing/coordinator.ts';
import { CardNotFound } from '../../cards/exceptions.ts';
import type { HonoEnvironment } from '../../context.ts';
import {
  ForexInvalidResponse,
  ForexReadFailed,
  ForexRequestFailed,
  ForexStoredSnapshotInvalid,
  ForexWriteFailed,
  type ForexError,
} from '../../forex/errors.ts';
import { handleServerError } from '../handler.ts';
import { APIException, InternalServerError } from '../index.ts';

const cause = new Error('private provider credentials');

const failures = [
  new InternalServerError(undefined, { cause, diagnosticMessage: 'private configuration details' }),
  new PricingCoordinationFailure('unavailable', cause),
  new PricingCoordinationFailure('operation_failed', cause),
  new ForexRequestFailed('private provider response', { cause }),
  new ForexInvalidResponse('private response body', { cause }),
  new ForexReadFailed(cause),
  new ForexStoredSnapshotInvalid(cause),
  new ForexWriteFailed(cause),
];

test('domain failures belong to the shared API exception hierarchy', () => {
  expectTypeOf<CardNotFound>().toExtend<APIException>();
  expectTypeOf<PricingCoordinationFailure>().toExtend<APIException>();
  expectTypeOf<ForexError>().toExtend<APIException>();
});

test.each(failures)('safely handles $name without domain-specific error mapping', async failure => {
  const response = await requestFailure(failure);

  expect(failure).toBeInstanceOf(APIException);
  expect(failure.cause).toBe(cause);
  expect(response.status).toBe(500);
  expect(response.headers.get('Request-Id')).toBe('exception-hierarchy-test');
  expect(await response.json()).toEqual({ code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong' });
});

test('purchase ownership failures directly preserve the existing not-found response', async () => {
  const response = await requestFailure(new CardNotFound());

  expect(response.status).toBe(404);
  expect(response.headers.get('Request-Id')).toBe('exception-hierarchy-test');
  expect(await response.json()).toEqual({ code: 'CARD_NOT_FOUND', message: 'Card not found' });
});

test('a coordination timeout directly returns the retryable pricing response', async () => {
  const response = await requestFailure(new PricingCoordinationFailure('timeout', cause));

  expect(response.status).toBe(503);
  expect(response.headers.get('Retry-After')).toBe('1');
  expect(await response.json()).toEqual({
    code: 'PRICING_LOCK_TIMEOUT',
    message: 'Pricing is busy; try again shortly.',
  });
});

function requestFailure(failure: APIException): Promise<Response> {
  const app = new Hono<HonoEnvironment>();
  app.use(requestId());
  app.onError(handleServerError());
  app.get('/', () => {
    throw failure;
  });

  return Promise.resolve(app.request('/', { headers: { 'X-Request-Id': 'exception-hierarchy-test' } }));
}
