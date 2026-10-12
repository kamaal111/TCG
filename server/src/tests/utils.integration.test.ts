import { Client } from 'pg';
import { inject } from 'vitest';

import { createTestDatabase } from './utils.ts';

test('closes every pooled client before removing its temporary database', async () => {
  const { db, connectionString, cleanup } = await createTestDatabase();
  const first = await db.$client.connect();
  const second = await db.$client.connect();
  const ended = vi.fn<() => void>();
  first.once('end', ended);
  second.once('end', ended);
  first.release();
  second.release();

  await cleanup();
  expect(ended).toHaveBeenCalledTimes(2);

  const observer = new Client({ connectionString: inject('databaseUrl') });

  try {
    await observer.connect();

    const result = await observer.query('SELECT datname FROM pg_database WHERE datname = $1', [
      new URL(connectionString).pathname.slice(1),
    ]);

    expect(result.rows).toEqual([]);
  } finally {
    await observer.end();
  }
});
