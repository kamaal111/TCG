import type { Result } from 'neverthrow';

import { EcbForexClient } from '../client.ts';
import { ForexError, ForexInvalidResponse, ForexRequestFailed } from '../errors.ts';
import type { ForexSnapshot } from '../schemas/responses.ts';

test('returns a typed request failure with its HTTP status', async () => {
  const fetchFeed = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unavailable', { status: 503 }));
  const result = await new EcbForexClient({ fetch: fetchFeed }).latestSnapshot();

  expectTypeOf(result).toEqualTypeOf<Result<ForexSnapshot, ForexError>>();
  assert(result.isErr());
  expect(result.error).toBeInstanceOf(ForexError);
  expect(result.error).toBeInstanceOf(ForexRequestFailed);
  expect(result.error).toMatchObject({ reason: 'request_failed', statusCode: 503 });
});

test('retains the cause of a network failure inside the domain error', async () => {
  const cause = new TypeError('Connection failed');
  const fetchFeed = vi.fn<typeof fetch>().mockRejectedValue(cause);
  const result = await new EcbForexClient({ fetch: fetchFeed }).latestSnapshot();

  assert(result.isErr());
  expect(result.error).toBeInstanceOf(ForexRequestFailed);
  expect(result.error.cause).toBe(cause);
});

test('distinguishes invalid provider data from a failed request', async () => {
  const fetchFeed = vi.fn<typeof fetch>().mockResolvedValue(new Response('<broken>'));
  const result = await new EcbForexClient({ fetch: fetchFeed }).latestSnapshot();

  assert(result.isErr());
  expect(result.error).toBeInstanceOf(ForexInvalidResponse);
  expect(result.error.reason).toBe('invalid_response');
  expect(result.error.cause).toBeInstanceOf(Error);
});
