import type { ObjectStorageClient } from './client.ts';
import { InMemoryObjectStorageClient } from './memory-client.ts';
import { S3ObjectStorageClient } from './s3-client.ts';
import { OBJECT_STORAGE_PROVIDERS } from '../constants/common.ts';
import env from '../env.ts';

export function createObjectStorageClient(): ObjectStorageClient {
  return env.OBJECT_STORAGE_CLIENT === OBJECT_STORAGE_PROVIDERS.S3
    ? new S3ObjectStorageClient()
    : new InMemoryObjectStorageClient();
}
