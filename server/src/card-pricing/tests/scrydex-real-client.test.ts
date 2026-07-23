import assert from 'node:assert/strict';

import { RealScrydexClient } from '../scrydex/real-client.ts';

describe('RealScrydexClient', () => {
  it('constructs an authenticated One Piece search and decodes pricing', async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const client = makeClient(async (input, init) => {
      requests.push({ url: TestRequest.urlString(input), headers: new Headers(init?.headers) });
      return jsonResponse({
        status: 'success',
        data: [onePieceCard()],
        page: 1,
        pageSize: 20,
        totalCount: 1,
      });
    });

    const result = await client.searchCards('one_piece', 'OP14-069');
    assert(result.isOk());

    expect(result.value).toMatchObject({ providerResultCount: 1, rejectedCount: 0, missingBaseVariantCount: 0 });
    expect(result.value.records[0]?.card).toMatchObject({
      id: 'OP14-069',
      cardNumber: 'OP14-069',
      pricing: { market: { condition: 'near_mint', currency: 'USD', low: 12.45, market: 14.2 } },
    });
    expect(requests).toHaveLength(1);
    const requestURL = new URL(requests[0]?.url ?? 'invalid:');
    expect(requestURL.pathname).toBe('/onepiece/v1/cards');
    expect(requestURL.searchParams.get('q')).toBe('!id:OP14-069');
    expect(requestURL.searchParams.get('include')).toBe('prices');
    expect(requestURL.searchParams.get('page')).toBe('1');
    expect(requestURL.searchParams.get('page_size')).toBe('20');
    expect(requests[0]?.headers.get('X-Api-Key')).toBe('test-api-key');
    expect(requests[0]?.headers.get('X-Team-ID')).toBe('test-team-id');
  });

  it('treats an empty Scrydex envelope as a successful search', async () => {
    const client = makeClient(async () => jsonResponse({ status: 'success', data: [], totalCount: 0 }));

    const result = await client.searchCards('one_piece', 'OP99-999');
    assert(result.isOk());

    expect(result.value).toEqual({
      records: [],
      providerResultCount: 0,
      rejectedCount: 0,
      missingBaseVariantCount: 0,
    });
  });

  it('uses the English Pokémon endpoint and encoded query', async () => {
    const requestedURLs: string[] = [];
    const client = makeClient(async input => {
      requestedURLs.push(TestRequest.urlString(input));
      return jsonResponse({ data: [], total_count: 0 });
    });

    const result = await client.searchCards('pokemon', 'Charizard ex 199');
    assert(result.isOk());

    const requestURL = new URL(requestedURLs[0] ?? 'invalid:');
    expect(requestURL.pathname).toBe('/pokemon/v1/en/cards');
    expect(requestURL.searchParams.get('q')).toBe('name:"Charizard ex" AND !number:199');
  });

  it('returns null for a missing provider card', async () => {
    const client = makeClient(async () => new Response(null, { status: 404 }));

    const result = await client.getCardById('one_piece', 'OP14-999');
    assert(result.isOk());

    expect(result.value).toBeNull();
  });

  it('reports HTTP failures without exposing response bodies', async () => {
    const client = makeClient(async () => jsonResponse({ secret: 'provider-body' }, 429));

    const result = await client.searchCards('pokemon', 'Charizard');
    assert(result.isErr());

    expect(result.error).toEqual({
      reason: 'http_error',
      message: 'Scrydex search failed with status 429',
      statusCode: 429,
      isRetryable: true,
    });
    expect(result.error.message).not.toContain('provider-body');
  });

  it('reports malformed successful responses', async () => {
    const client = makeClient(async () => jsonResponse({ data: 'not-an-array' }));

    const result = await client.searchCards('pokemon', 'Charizard');
    assert(result.isErr());

    expect(result.error).toMatchObject({ reason: 'invalid_response', isRetryable: false });
  });

  it('requires both Scrydex credentials', async () => {
    const client = new RealScrydexClient({
      apiKey: 'test-api-key',
      baseURL: 'https://api.scrydex.test',
      fetch: async () => jsonResponse({ data: [] }),
      requestTimeoutMs: 100,
    });

    const result = await client.searchCards('pokemon', 'Charizard');
    assert(result.isErr());

    expect(result.error).toMatchObject({ reason: 'missing_credentials', isRetryable: false });
  });
});

function makeClient(fetchImplementation: typeof fetch): RealScrydexClient {
  return new RealScrydexClient({
    apiKey: 'test-api-key',
    teamId: 'test-team-id',
    baseURL: 'https://api.scrydex.test',
    fetch: fetchImplementation,
    requestTimeoutMs: 100,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function onePieceCard() {
  return {
    id: 'OP14-069',
    name: 'One Piece Card',
    number: '069',
    printed_number: 'OP14-069',
    variants: [
      {
        name: 'normal',
        prices: [
          {
            condition: 'NM',
            type: 'raw',
            currency: 'USD',
            low: 12.45,
            market: 14.2,
            trends: {
              days_7: { price_change: 0.7, percent_change: 5.19 },
              days_30: { price_change: -0.3, percent_change: -2.07 },
            },
          },
        ],
      },
    ],
  };
}

class TestRequest {
  static urlString(input: string | URL | Request): string {
    if (typeof input === 'string') return input;
    return input instanceof URL ? input.href : input.url;
  }
}
