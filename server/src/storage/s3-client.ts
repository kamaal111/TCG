import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { err, ok } from 'neverthrow';

import {
  type ObjectStorageClient,
  type ObjectStorageError,
  OBJECT_STORAGE_ERROR_REASONS,
  type ObjectStorageResult,
  type StoredObject,
  type StoredObjectHead,
} from './client.ts';
import env from '../env.ts';

type S3Sender = Pick<S3Client, 'send'>;

interface S3ObjectStorageClientOptions {
  accessKeyId?: string;
  bucket?: string;
  clientFactory?: (configuration: S3ClientConfig) => S3Sender;
  endpoint?: string;
  forcePathStyle?: boolean;
  region?: string;
  requestTimeoutMs?: number;
  secretAccessKey?: string;
}

export class S3ObjectStorageClient implements ObjectStorageClient {
  private readonly accessKeyId: string | undefined;
  private readonly bucket: string;
  private readonly client: S3Sender;
  private readonly requestTimeoutMs: number;
  private readonly secretAccessKey: string | undefined;

  constructor(options: S3ObjectStorageClientOptions = {}) {
    this.accessKeyId = options.accessKeyId ?? env.OBJECT_STORAGE_ACCESS_KEY_ID;
    this.secretAccessKey = options.secretAccessKey ?? env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
    this.bucket = options.bucket ?? env.OBJECT_STORAGE_BUCKET;
    this.requestTimeoutMs = options.requestTimeoutMs ?? env.OBJECT_STORAGE_REQUEST_TIMEOUT_MS;
    const configuration: S3ClientConfig = {
      region: options.region ?? env.OBJECT_STORAGE_REGION,
      endpoint: options.endpoint ?? env.OBJECT_STORAGE_ENDPOINT,
      forcePathStyle: options.forcePathStyle ?? env.OBJECT_STORAGE_FORCE_PATH_STYLE,
      credentials:
        this.accessKeyId == null || this.secretAccessKey == null
          ? undefined
          : { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey },
      // Compatible stores may reject the SDK's otherwise automatic CRC32 headers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: env.OBJECT_STORAGE_MAX_ATTEMPTS,
    };
    this.client = (options.clientFactory ?? (config => new S3Client(config)))(configuration);
  }

  async put(key: string, body: Uint8Array, contentType: string, checksum: string): Promise<ObjectStorageResult<void>> {
    const missing = this.missingCredentials();
    if (missing != null) return err(missing);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentLength: body.byteLength,
          ContentType: contentType,
          Metadata: { checksum },
        }),
        { abortSignal: AbortSignal.timeout(this.requestTimeoutMs) },
      );
      return ok(undefined);
    } catch (error) {
      return err(this.mapError(error, 'put'));
    }
  }

  async get(key: string): Promise<ObjectStorageResult<StoredObject>> {
    const missing = this.missingCredentials();
    if (missing != null) return err(missing);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (response.Body == null || response.ContentType == null)
        return err(this.invalidResponse('S3 get response lacked a body or content type'));
      const body = await response.Body.transformToByteArray();
      return ok({
        body,
        contentLength: response.ContentLength ?? body.byteLength,
        contentType: response.ContentType,
        checksum: response.Metadata?.checksum,
      });
    } catch (error) {
      return err(this.mapError(error, 'get'));
    }
  }

  async head(key: string): Promise<ObjectStorageResult<StoredObjectHead>> {
    const missing = this.missingCredentials();
    if (missing != null) return err(missing);
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (response.ContentLength == null || response.ContentType == null)
        return err(this.invalidResponse('S3 head response lacked content metadata'));
      return ok({
        contentLength: response.ContentLength,
        contentType: response.ContentType,
        checksum: response.Metadata?.checksum,
      });
    } catch (error) {
      return err(this.mapError(error, 'head'));
    }
  }

  async delete(key: string): Promise<ObjectStorageResult<void>> {
    const missing = this.missingCredentials();
    if (missing != null) return err(missing);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      return ok(undefined);
    } catch (error) {
      return err(this.mapError(error, 'delete'));
    }
  }

  private missingCredentials(): ObjectStorageError | undefined {
    if (this.accessKeyId != null && this.secretAccessKey != null) return undefined;
    return {
      reason: OBJECT_STORAGE_ERROR_REASONS.MISSING_CREDENTIALS,
      message: 'Object storage access key and secret are required for the S3 client',
      isRetryable: false,
    };
  }

  private invalidResponse(message: string): ObjectStorageError {
    return { reason: OBJECT_STORAGE_ERROR_REASONS.INVALID_RESPONSE, message, isRetryable: false };
  }

  private mapError(error: unknown, operation: string): ObjectStorageError {
    const value = error instanceof Error ? error : new Error(String(error));
    const record = error != null && typeof error === 'object' ? error : {};
    const statusCode =
      '$metadata' in record ? (record.$metadata as { httpStatusCode?: number }).httpStatusCode : undefined;
    const name = value.name;
    if (statusCode === 404 || name === 'NoSuchKey' || name === 'NotFound') {
      return { reason: OBJECT_STORAGE_ERROR_REASONS.NOT_FOUND, message: value.message, statusCode, isRetryable: false };
    }
    if (statusCode === 401 || statusCode === 403 || name === 'AccessDenied') {
      return {
        reason: OBJECT_STORAGE_ERROR_REASONS.ACCESS_DENIED,
        message: value.message,
        statusCode,
        isRetryable: false,
      };
    }
    if (name === 'AbortError' || name === 'TimeoutError' || name === 'RequestTimeout') {
      return {
        reason: OBJECT_STORAGE_ERROR_REASONS.REQUEST_TIMEOUT,
        message: `Object storage ${operation} timed out`,
        statusCode,
        isRetryable: true,
      };
    }
    if (statusCode != null) {
      return {
        reason: OBJECT_STORAGE_ERROR_REASONS.UNKNOWN,
        message: value.message,
        statusCode,
        isRetryable: statusCode >= 500,
      };
    }
    return {
      reason: OBJECT_STORAGE_ERROR_REASONS.NETWORK_ERROR,
      message: value.message,
      isRetryable: true,
    };
  }
}
