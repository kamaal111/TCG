import crypto from 'node:crypto';

import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { inject } from 'vitest';

import { createConfiguredObjectStorage } from '../storage/config.ts';
import type { S3ObjectStorageClient } from '../storage/s3-client.ts';

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

  return createConfiguredObjectStorage({
    OBJECT_STORAGE_ACCESS_KEY_ID: connection.accessKeyId,
    OBJECT_STORAGE_SECRET_ACCESS_KEY: connection.secretAccessKey,
    OBJECT_STORAGE_BUCKET: bucket,
    OBJECT_STORAGE_ENDPOINT: connection.endpoint,
    OBJECT_STORAGE_FORCE_PATH_STYLE: true,
    OBJECT_STORAGE_REGION: connection.region,
    OBJECT_STORAGE_REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
    OBJECT_STORAGE_MAX_ATTEMPTS: 2,
  });
}
