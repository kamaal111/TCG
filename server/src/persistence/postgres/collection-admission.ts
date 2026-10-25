import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Transaction } from './collection-transactions.ts';
import {
  CollectionAccountBusy,
  CollectionCapacityBusy,
  CollectionOperationTimeout,
} from '../../collections/exceptions.ts';
import type { CollectionPolicy } from '../../collections/types.ts';
import { classifyPostgresError } from '../../db/errors.ts';
import type { AuthenticatedIdentity } from '../contracts.ts';

const LockResultSchema = z.object({ rows: z.tuple([z.object({ acquired: z.boolean() })]) });

export async function admitCollectionOperation(
  tx: Transaction,
  identity: AuthenticatedIdentity,
  policy: CollectionPolicy,
) {
  await tx.execute(sql`select set_config('statement_timeout', ${String(policy.COLLECTION_STATEMENT_TIMEOUT_MS)}, true),
    set_config('lock_timeout', ${String(policy.COLLECTION_LOCK_TIMEOUT_MS)}, true),
    set_config('transaction_timeout', ${String(policy.COLLECTION_OPERATION_TIMEOUT_MS)}, true)`);

  const account = LockResultSchema.parse(
    await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${'cards.import:' + identity.requireUserId()}, 0)) as acquired`,
    ),
  );

  if (!account.rows[0].acquired) {
    throw new CollectionAccountBusy();
  }

  for (let slot = 0; slot < policy.COLLECTION_CONCURRENCY; slot += 1) {
    const permit = LockResultSchema.parse(
      await tx.execute(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${'collections.capacity:' + slot}, 0)) as acquired`,
      ),
    );

    if (permit.rows[0].acquired) {
      return;
    }
  }

  throw new CollectionCapacityBusy();
}

export function collectionOperationError(error: Error): Error {
  const code = classifyPostgresError(error);

  if (code === 'query_canceled' || code === 'transaction_timeout' || code === 'lock_not_available') {
    return new CollectionOperationTimeout(error);
  }

  return error;
}
