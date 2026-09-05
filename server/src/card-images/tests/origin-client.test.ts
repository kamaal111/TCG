import { CARD_IMAGE_ORIGIN_ERROR_REASONS, HttpCardImageOriginClient } from '../origin-client.ts';

describe('HttpCardImageOriginClient', () => {
  test('accepts allowlisted image bytes', async () => {
    const client = new HttpCardImageOriginClient({
      fetch: () => Promise.resolve(new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'image/png' } })),
    });

    expect(await client.fetchImage('https://example.com/image')).toMatchObject({
      value: { body: new Uint8Array([1, 2]), contentType: 'image/png' },
    });
  });

  test('rejects unsupported content and oversized bodies', async () => {
    const unsupported = new HttpCardImageOriginClient({
      fetch: () => Promise.resolve(new Response('html', { headers: { 'Content-Type': 'text/html' } })),
    });
    const oversized = new HttpCardImageOriginClient({
      maxBytes: 1,
      fetch: () => Promise.resolve(new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'image/png' } })),
    });

    expect(await unsupported.fetchImage('https://example.com/image')).toMatchObject({
      error: { reason: CARD_IMAGE_ORIGIN_ERROR_REASONS.INVALID_CONTENT_TYPE, isRetryable: false },
    });
    expect(await oversized.fetchImage('https://example.com/image')).toMatchObject({
      error: { reason: CARD_IMAGE_ORIGIN_ERROR_REASONS.INVALID_CONTENT_LENGTH, isRetryable: false },
    });
  });
});
