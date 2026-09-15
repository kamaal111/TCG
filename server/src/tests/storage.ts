import crypto from 'node:crypto';

import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { inject } from 'vitest';

import { S3ObjectStorageClient } from '../storage/s3-client.ts';

const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Gives a test its own bucket in the shared Garage container, so tests exercise the same S3 client
 * production uses rather than a second implementation that can drift from it. Buckets are left
 * behind; the container is thrown away when the run ends.
 */
export async function createTestObjectStorage(): Promise<S3ObjectStorageClient> {
  const connection = inject('objectStorage');
  const bucket = `test-card-images-${crypto.randomUUID()}`;

  const client = new S3Client({
    region: connection.region,
    endpoint: connection.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: connection.accessKeyId, secretAccessKey: connection.secretAccessKey },
  });

  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  client.destroy();

  return new S3ObjectStorageClient({
    accessKeyId: connection.accessKeyId,
    secretAccessKey: connection.secretAccessKey,
    bucket,
    endpoint: connection.endpoint,
    forcePathStyle: true,
    region: connection.region,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  });
}
