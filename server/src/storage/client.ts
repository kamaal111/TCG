import type { Result } from 'neverthrow';

import type { GetRecordValues } from '../utils/type-utils.ts';

export const OBJECT_STORAGE_ERROR_REASONS = {
  ACCESS_DENIED: 'access_denied',
  INVALID_RESPONSE: 'invalid_response',
  MISSING_CREDENTIALS: 'missing_credentials',
  NETWORK_ERROR: 'network_error',
  NOT_FOUND: 'not_found',
  REQUEST_TIMEOUT: 'request_timeout',
  UNKNOWN: 'unknown',
} as const;

export type ObjectStorageErrorReason = GetRecordValues<typeof OBJECT_STORAGE_ERROR_REASONS>;

export interface ObjectStorageError {
  readonly reason: ObjectStorageErrorReason;
  readonly message: string;
  readonly statusCode?: number;
  readonly isRetryable: boolean;
}

export interface StoredObject {
  body: Uint8Array;
  contentLength: number;
  contentType: string;
  checksum?: string;
}

export interface StoredObjectHead {
  contentLength: number;
  contentType: string;
  checksum?: string;
}

export type ObjectStorageResult<T> = Result<T, ObjectStorageError>;

export interface ObjectStorageClient {
  put(key: string, body: Uint8Array, contentType: string, checksum: string): Promise<ObjectStorageResult<void>>;
  get(key: string): Promise<ObjectStorageResult<StoredObject>>;
  head(key: string): Promise<ObjectStorageResult<StoredObjectHead>>;
  delete(key: string): Promise<ObjectStorageResult<void>>;
}
