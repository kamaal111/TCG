import crypto from 'node:crypto';

import { InMemoryObjectStorageClient } from '../memory-client.ts';

describe('InMemoryObjectStorageClient', () => {
  test('round trips and overwrites objects', async () => {
    const client = new InMemoryObjectStorageClient();
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5]);

    expect(
      (await client.put('card', first, 'image/png', crypto.createHash('sha256').update(first).digest('hex'))).isOk(),
    ).toBe(true);
    expect((await client.put('card', second, 'image/jpeg', 'second')).isOk()).toBe(true);
    expect(await client.get('card')).toMatchObject({
      value: { body: second, contentLength: 2, contentType: 'image/jpeg', checksum: 'second' },
    });
    expect(await client.head('card')).toMatchObject({
      value: { contentLength: 2, contentType: 'image/jpeg', checksum: 'second' },
    });
  });

  test('maps missing objects and deletes idempotently', async () => {
    const client = new InMemoryObjectStorageClient();

    expect(await client.get('missing')).toMatchObject({ error: { reason: 'not_found', isRetryable: false } });
    expect((await client.delete('missing')).isOk()).toBe(true);
    expect((await client.delete('missing')).isOk()).toBe(true);
  });
});
