import { err, ok } from 'neverthrow';

import {
  type ObjectStorageClient,
  OBJECT_STORAGE_ERROR_REASONS,
  type ObjectStorageResult,
  type StoredObject,
  type StoredObjectHead,
} from './client.ts';

export class InMemoryObjectStorageClient implements ObjectStorageClient {
  private readonly objects = new Map<string, StoredObject>();

  async put(key: string, body: Uint8Array, contentType: string, checksum: string): Promise<ObjectStorageResult<void>> {
    this.objects.set(key, { body: body.slice(), contentLength: body.byteLength, contentType, checksum });
    return ok(undefined);
  }

  async get(key: string): Promise<ObjectStorageResult<StoredObject>> {
    const object = this.objects.get(key);
    if (object == null) return err(this.notFound(key));
    return ok({ ...object, body: object.body.slice() });
  }

  async head(key: string): Promise<ObjectStorageResult<StoredObjectHead>> {
    const object = this.objects.get(key);
    if (object == null) return err(this.notFound(key));
    return ok({ contentLength: object.contentLength, contentType: object.contentType, checksum: object.checksum });
  }

  async delete(key: string): Promise<ObjectStorageResult<void>> {
    this.objects.delete(key);
    return ok(undefined);
  }

  private notFound(key: string) {
    return {
      reason: OBJECT_STORAGE_ERROR_REASONS.NOT_FOUND,
      message: `Object not found: ${key}`,
      isRetryable: false,
    } as const;
  }
}
