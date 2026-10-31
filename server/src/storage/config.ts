import type { Env } from '../config.ts';
import { S3ObjectStorageClient } from './s3-client.ts';

type StorageEnvironment = Pick<
  Env,
  | 'OBJECT_STORAGE_ACCESS_KEY_ID'
  | 'OBJECT_STORAGE_SECRET_ACCESS_KEY'
  | 'OBJECT_STORAGE_BUCKET'
  | 'OBJECT_STORAGE_REGION'
  | 'OBJECT_STORAGE_ENDPOINT'
  | 'OBJECT_STORAGE_FORCE_PATH_STYLE'
  | 'OBJECT_STORAGE_REQUEST_TIMEOUT_MS'
  | 'OBJECT_STORAGE_MAX_ATTEMPTS'
>;

export function createConfiguredObjectStorage(env: StorageEnvironment): S3ObjectStorageClient {
  return new S3ObjectStorageClient({
    accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    bucket: env.OBJECT_STORAGE_BUCKET,
    region: env.OBJECT_STORAGE_REGION,
    endpoint: env.OBJECT_STORAGE_ENDPOINT,
    forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
    requestTimeoutMs: env.OBJECT_STORAGE_REQUEST_TIMEOUT_MS,
    maxAttempts: env.OBJECT_STORAGE_MAX_ATTEMPTS,
  });
}
