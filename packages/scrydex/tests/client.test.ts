import assert from 'node:assert/strict';

import { ScrydexClient, type ScrydexClientOptions, type ScrydexFetch, type ScrydexGame } from '../src/index.ts';

const card = { id: 'sv5m_ja-72', name: 'ダーテング', number: '72', provider_extra: true };

function makeClient(transport: ScrydexFetch, options: ScrydexClientOptions = {}) {
  return new ScrydexClient({ apiKey: 'test-key', teamId: 'test-team', fetch: transport, ...options });
}

const operations = [
  { name: 'search', run: (client: ScrydexClient) => client.searchCards('pokemon', 'name:"Pikachu"') },
  { name: 'card lookup', run: (client: ScrydexClient) => client.getCardById('pokemon', 'card') },
];

afterEach(() => vi.restoreAllMocks());

describe('Scrydex request construction', () => {
  it.each<{ game: ScrydexGame; path: string }>([
    { game: 'pokemon', path: '/pokemon/v1/cards' },
    { game: 'one_piece', path: '/onepiece/v1/cards' },
  ])('authenticates $game searches and sends the provider query unchanged', async ({ game, path }) => {
    const transport = vi.fn<ScrydexFetch>().mockResolvedValue(Response.json({ data: [] }));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const query = '(name:"ダーテング + V") AND (!language_code:JA)';
    const result = await makeClient(transport).searchCards(game, query);
    assert(result.isOk());
    expect(result.value).toEqual({ cards: [], providerResultCount: 0, rejectedCount: 0 });
    const [input, init] = transport.mock.calls[0] ?? [];
    assert(input instanceof URL);
    expect(input.origin).toBe('https://api.scrydex.com');
    expect(input.pathname).toBe(path);
    expect(Object.fromEntries(input.searchParams)).toEqual({ q: query, include: 'prices', page: '1', page_size: '20' });
    expect(new Headers(init?.headers).get('X-Api-Key')).toBe('test-key');
    expect(new Headers(init?.headers).get('X-Team-ID')).toBe('test-team');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(8_000);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(['https://scrydex.test/proxy', 'https://scrydex.test/proxy/'])(
    'joins the configured base URL %s and uses the configured timeout',
    async baseURL => {
      const transport = vi.fn<ScrydexFetch>().mockResolvedValue(Response.json({ data: [] }));
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      const result = await makeClient(transport, { baseURL, requestTimeoutMs: 123 }).searchCards('pokemon', 'query');
      expect(result.isOk()).toBe(true);
      const [input] = transport.mock.calls[0] ?? [];
      assert(input instanceof URL);
      expect(input.pathname).toBe('/proxy/pokemon/v1/cards');
      expect(timeout).toHaveBeenCalledWith(123);
    },
  );

  it.each<{ game: ScrydexGame; path: string }>([
    { game: 'pokemon', path: '/pokemon/v1/cards/set%2Fcard%20%3F%23' },
    { game: 'one_piece', path: '/onepiece/v1/cards/set%2Fcard%20%3F%23' },
  ])('encodes $game lookup IDs as a single path segment', async ({ game, path }) => {
    const transport = vi.fn<ScrydexFetch>().mockResolvedValue(Response.json({ data: card }, { status: 201 }));
    const result = await makeClient(transport).getCardById(game, 'set/card ?#');
    assert(result.isOk());
    expect(result.value).toEqual({ card, statusCode: 201 });
    const [input, init] = transport.mock.calls[0] ?? [];
    assert(input instanceof URL);
    expect(input.pathname).toBe(path);
    expect(Object.fromEntries(input.searchParams)).toEqual({ include: 'prices' });
    expect(new Headers(init?.headers).get('X-Api-Key')).toBe('test-key');
    expect(new Headers(init?.headers).get('X-Team-ID')).toBe('test-team');
  });

  it('aborts a pending transport through the configured timeout signal', async () => {
    const transport: ScrydexFetch = async (_input, init) => {
      const signal = init?.signal;
      assert(signal instanceof AbortSignal);

      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    };

    const result = await makeClient(transport, { requestTimeoutMs: 1 }).searchCards('pokemon', 'query');
    assert(result.isErr());
    expect(result.error).toEqual({
      reason: 'request_timeout',
      message: 'Scrydex request timed out',
      isRetryable: true,
    });
  });

  it('uses the global fetch transport when none is injected', async () => {
    const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [] }));
    const result = await new ScrydexClient({ apiKey: 'key', teamId: 'team' }).searchCards('pokemon', 'query');
    expect(result.isOk()).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('requires explicit credentials when constructed without options', async () => {
    const result = await new ScrydexClient().searchCards('pokemon', 'query');
    assert(result.isErr());
    expect(result.error.reason).toBe('missing_credentials');
  });
});

describe.each(operations)('$name failures', ({ run, name }) => {
  it.each([{ apiKey: undefined }, { teamId: undefined }])(
    'does not request cards when credentials are missing: %j',
    async options => {
      const transport = vi.fn<ScrydexFetch>();
      const result = await run(makeClient(transport, options));
      assert(result.isErr());
      expect(result.error).toEqual({
        reason: 'missing_credentials',
        message: 'SCRYDEX_API_KEY and SCRYDEX_TEAM_ID are required for the real Scrydex client',
        isRetryable: false,
      });
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      error: new DOMException('secret', 'TimeoutError'),
      reason: 'request_timeout',
      message: 'Scrydex request timed out',
    },
    {
      error: new DOMException('secret', 'AbortError'),
      reason: 'request_timeout',
      message: 'Scrydex request timed out',
    },
    {
      error: new Error('secret'),
      reason: 'network_error',
      message: 'Scrydex request failed before a response was received',
    },
    { error: 'secret', reason: 'network_error', message: 'Scrydex request failed before a response was received' },
  ])('maps transport rejection to $reason without exposing details', async ({ error, reason, message }) => {
    const result = await run(makeClient(vi.fn<ScrydexFetch>().mockRejectedValue(error)));
    assert(result.isErr());
    expect(result.error).toEqual({ reason, message, isRetryable: true });
  });

  it.each([
    { status: 401, retryable: false },
    { status: 429, retryable: true },
    { status: 500, retryable: true },
    { status: 503, retryable: true },
  ])('maps HTTP $status with retryable=$retryable without reading its body', async ({ status, retryable }) => {
    const response = Response.json({ secret: 'private provider body' }, { status });
    const decode = vi.spyOn(response, 'json');
    const result = await run(makeClient(async () => response));
    assert(result.isErr());
    expect(result.error).toEqual({
      reason: 'http_error',
      message: `Scrydex ${name} failed with status ${status}`,
      statusCode: status,
      isRetryable: retryable,
    });
    expect(decode).not.toHaveBeenCalled();
  });

  it('reports invalid JSON with the successful HTTP status', async () => {
    const result = await run(makeClient(async () => new Response('{bad', { status: 201 })));
    assert(result.isErr());
    expect(result.error).toEqual({
      reason: 'invalid_response',
      message: `Scrydex ${name} returned invalid JSON`,
      statusCode: 201,
      isRetryable: false,
    });
  });
});

describe('Scrydex search decoding', () => {
  it.each([
    { counts: { totalCount: 20, total_count: 30 }, expected: 20 },
    { counts: { total_count: 30 }, expected: 30 },
    { counts: {}, expected: 3 },
    { counts: { totalCount: 0 }, expected: 0 },
  ])('preserves provider totals independently of rejected records: $counts', async ({ counts, expected }) => {
    const result = await makeClient(async () =>
      Response.json({ data: [card, null, { variants: 'invalid' }], ...counts }),
    ).searchCards('pokemon', 'query');

    assert(result.isOk());
    expect(result.value).toEqual({ cards: [card], providerResultCount: expected, rejectedCount: 2 });
  });

  it('leaves pricing identity and normalization decisions to the consumer', async () => {
    const result = await makeClient(async () => Response.json({ data: [{}] })).searchCards('pokemon', 'query');
    assert(result.isOk());
    expect(result.value).toEqual({ cards: [{}], providerResultCount: 1, rejectedCount: 0 });
  });

  it.each([{}, { data: null }, { data: 'invalid' }, { data: [], totalCount: -1 }, { data: [], total_count: 1.5 }])(
    'rejects malformed search envelopes: %j',
    async body => {
      const result = await makeClient(async () => Response.json(body)).searchCards('pokemon', 'query');
      assert(result.isErr());
      expect(result.error).toEqual({
        reason: 'invalid_response',
        message: 'Scrydex search returned an invalid response',
        statusCode: 200,
        isRetryable: false,
      });
    },
  );

  it('treats search 404 as an HTTP failure', async () => {
    const result = await makeClient(async () => new Response(null, { status: 404 })).searchCards('pokemon', 'query');
    assert(result.isErr());
    expect(result.error).toMatchObject({ reason: 'http_error', statusCode: 404, isRetryable: false });
  });
});

describe('Scrydex lookup decoding', () => {
  it('returns null for 404 without decoding the body', async () => {
    const response = new Response('not JSON', { status: 404 });
    const decode = vi.spyOn(response, 'json');
    const result = await makeClient(async () => response).getCardById('pokemon', 'missing');
    assert(result.isOk());
    expect(result.value).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([{}, { data: null }, { data: [] }, { data: 'invalid' }, { data: { images: {} } }, card])(
    'rejects malformed lookup envelopes: %j',
    async body => {
      const result = await makeClient(async () => Response.json(body)).getCardById('pokemon', 'card');
      assert(result.isErr());
      expect(result.error).toEqual({
        reason: 'invalid_response',
        message: 'Scrydex card lookup returned an invalid response',
        statusCode: 200,
        isRetryable: false,
      });
    },
  );
});
