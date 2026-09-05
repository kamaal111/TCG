import crypto from 'node:crypto';

import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio';

import { S3ObjectStorageClient } from '../s3-client.ts';

type Fixture = { container: StartedMinioContainer; storage: S3ObjectStorageClient };

describe('S3ObjectStorageClient with MinIO', () => {
  const bucket = 'card-images-test';
  const password = 'test-storage-password';
  const username = 'test-storage-user';
  let fixture: Fixture | undefined = undefined;

  function requireFixture(): Fixture {
    if (fixture == null) throw new Error('MinIO fixture not initialized');
    return fixture;
  }

  beforeAll(async () => {
    const container = await new MinioContainer('minio/minio:RELEASE.2025-09-07T16-13-09Z')
      .withUsername(username)
      .withPassword(password)
      .start();
    const endpoint = container.getConnectionUrl();
    const client = new S3Client({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: username, secretAccessKey: password },
    });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    client.destroy();
    const storage = new S3ObjectStorageClient({
      accessKeyId: username,
      secretAccessKey: password,
      bucket,
      endpoint,
      forcePathStyle: true,
      region: 'us-east-1',
      requestTimeoutMs: 5_000,
    });
    fixture = { container, storage };
  }, 60_000);

  afterAll(async () => {
    await requireFixture().container.stop();
  });

  test('round trips metadata and maps a deleted object to not found', async () => {
    const { storage } = requireFixture();
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
});
