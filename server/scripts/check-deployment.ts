import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { Client } from 'pg';

import { EnvSchema } from '../src/config.ts';
import { createConfiguredObjectStorage } from '../src/storage/config.ts';

// An operational CLI, deliberately printing no connection strings or captured errors.
try {
  const env = EnvSchema.parse(process.env);
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10000 });

  try {
    await client.connect();
    await client.query('SELECT 1');
    console.log('Database connection verified.');
  } finally {
    await client.end();
  }

  const storage = createConfiguredObjectStorage(env);

  const key = `.deployment-check/${crypto.randomUUID()}`;
  const body = Buffer.from('TCG deployment storage check');
  const checksum = crypto.createHash('sha256').update(body).digest('hex');
  const put = await storage.put(key, body, 'text/plain', checksum);
  assert(put.isOk(), 'Storage upload failed');

  try {
    const get = await storage.get(key);
    assert(get.isOk(), 'Storage download failed');
    assert(Buffer.from(get.value.body).equals(body), 'Storage content differs');
  } finally {
    const removed = await storage.delete(key);
    assert(removed.isOk(), 'Storage check cleanup failed');
  }

  console.log('Storage upload, download, and deletion verified.');
} catch {
  console.error('Deployment dependency check failed. Verify database TLS, storage credentials, and network policy.');
  process.exitCode = 1;
}
