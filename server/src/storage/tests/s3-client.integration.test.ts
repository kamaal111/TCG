import crypto from 'node:crypto';

import { createTestObjectStorage } from '../../tests/storage.ts';

describe('S3ObjectStorageClient with Garage', () => {
  test('round trips metadata and maps a deleted object to not found', async () => {
    const storage = await createTestObjectStorage();
    const body = new Uint8Array([1, 2, 3, 4]);
    const checksum = crypto.createHash('sha256').update(body).digest('hex');

    expect((await storage.put('cards/test.png', body, 'image/png', checksum)).isOk()).toBe(true);
    expect(await storage.head('cards/test.png')).toMatchObject({
      value: { contentLength: body.byteLength, contentType: 'image/png', checksum },
    });
    expect(await storage.get('cards/test.png')).toMatchObject({
      value: { body, contentLength: body.byteLength, contentType: 'image/png', checksum },
    });
    expect((await storage.delete('cards/test.png')).isOk()).toBe(true);
    expect(await storage.get('cards/test.png')).toMatchObject({
      error: { reason: 'not_found', isRetryable: false },
    });
  });

  test('reports a missing object rather than failing', async () => {
    const storage = await createTestObjectStorage();

    expect(await storage.get('cards/never-written.png')).toMatchObject({
      error: { reason: 'not_found', isRetryable: false },
    });
    expect(await storage.head('cards/never-written.png')).toMatchObject({
      error: { reason: 'not_found', isRetryable: false },
    });
  });

  test('overwrites an existing object', async () => {
    const storage = await createTestObjectStorage();
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5]);
    const checksum = crypto.createHash('sha256').update(second).digest('hex');

    await storage.put('cards/overwritten.png', first, 'image/png', 'first-checksum');

    expect((await storage.put('cards/overwritten.png', second, 'image/png', checksum)).isOk()).toBe(true);
    expect(await storage.get('cards/overwritten.png')).toMatchObject({
      value: { body: second, contentLength: second.byteLength, checksum },
    });
  });

  test('treats deleting a missing object as done', async () => {
    const storage = await createTestObjectStorage();

    expect((await storage.delete('cards/never-written.png')).isOk()).toBe(true);
  });
});
