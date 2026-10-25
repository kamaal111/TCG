import type { PoolClient } from 'pg';
import { z } from 'zod';

import { CollectionOperationTimeout } from '../../../collections/exceptions.ts';
import { DEFAULT_COLLECTION_POLICY } from '../../../config.ts';
import { integrationTest } from '../../../tests/fixtures.ts';
import { createTestUser } from '../../../tests/utils.ts';
import { runCollectionOperation } from '../collection-operation.ts';

integrationTest(
  'removes expired connection acquisitions from an exhausted pool and recovers after release',
  async ({ app, db }) => {
    const user = await createTestUser(app, db);
    const identity = { requireUserId: () => user.userId };
    const poolSize = z.number().int().positive().parse(db.$client.options.max);
    const heldConnections: PoolClient[] = [];

    const operation = () =>
      runCollectionOperation({
        db,
        identity,
        policy: DEFAULT_COLLECTION_POLICY,
        action: async () => 'completed',
      });

    try {
      for (let index = 0; index < poolSize; index += 1) {
        heldConnections.push(await db.$client.connect());
      }

      await expect(operation()).rejects.toBeInstanceOf(CollectionOperationTimeout);
      expect(db.$client.waitingCount).toBe(0);
    } finally {
      heldConnections.forEach(client => client.release());
    }

    expect(await operation()).toBe('completed');
  },
);
