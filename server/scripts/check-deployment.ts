import crypto from 'node:crypto';

import { sha256Hex } from '@tcg/crypto/sha256';

import { withDeploymentDatabase } from './deployment-database.ts';
import { EnvSchema } from '../src/config.ts';
import type { ObjectStorageClient, ObjectStorageResult } from '../src/storage/client.ts';
import { createConfiguredObjectStorage } from '../src/storage/config.ts';

async function checkStorageOperation<T>(
  operation: 'upload' | 'download' | 'delete',
  run: () => Promise<ObjectStorageResult<T>>,
) {
  try {
    const result = await run();

    if (result.isOk()) {
      return result;
    }

    const { reason, statusCode, isRetryable } = result.error;
    const status = statusCode == null ? '' : `, HTTP ${statusCode}`;
    console.error(`Deployment storage ${operation} failed (reason: ${reason}${status}, retryable: ${isRetryable}).`);
  } catch {
    console.error(`Deployment storage ${operation} failed unexpectedly.`);
  }
}

async function verifyStorage(storage: ObjectStorageClient): Promise<boolean> {
  const key = `.deployment-check/${crypto.randomUUID()}`;
  const body = Buffer.from('TCG deployment storage check');
  const checksum = sha256Hex(body);
  const uploaded = await checkStorageOperation('upload', () => storage.put(key, body, 'text/plain', checksum));

  if (!uploaded) {
    return false;
  }

  const downloaded = await checkStorageOperation('download', () => storage.get(key));
  const removed = await checkStorageOperation('delete', () => storage.delete(key));
  const contentMatches = downloaded != null && Buffer.from(downloaded.value.body).equals(body);

  if (downloaded && !contentMatches) {
    console.error('Deployment storage content verification failed. The downloaded content differs from the upload.');
  }

  return contentMatches && removed != null;
}

// Print only safe diagnostics. Provider errors can contain connection or request details.
let phase = 'configuration';

try {
  const env = EnvSchema.parse(process.env);
  phase = 'database connection';
  await withDeploymentDatabase(env.DATABASE_URL, async client => {
    await client.query('SELECT 1');
  });
  console.log('Database connection verified.');

  phase = 'object storage';
  const storage = createConfiguredObjectStorage(env);

  if (await verifyStorage(storage)) {
    console.log('Storage upload, download, and deletion verified.');
  } else {
    process.exitCode = 1;
  }
} catch {
  console.error(`Deployment dependency check failed during ${phase}.`);
  process.exitCode = 1;
}
