import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';

import { admitCollectionOperation, collectionOperationError } from './collection-admission.ts';
import type { Transaction } from './collection-transactions.ts';
import { CollectionOperationTimeout } from '../../collections/exceptions.ts';
import type { CollectionPolicy } from '../../collections/types.ts';
import type { Database } from '../../db/index.ts';
import { appRelations } from '../../db/schema/index.ts';
import { toError } from '../../utils/results.ts';
import type { AuthenticatedIdentity } from '../contracts.ts';

interface CollectionOperationOptions<T> {
  db: Database;
  identity: AuthenticatedIdentity;
  policy: CollectionPolicy;
  action: (tx: Transaction) => Promise<T>;
}

export async function runCollectionOperation<T>({
  db,
  identity,
  policy,
  action,
}: CollectionOperationOptions<T>): Promise<T> {
  const client = await acquireConnection(db);
  let operationError: Error | undefined;
  let connectionError: Error | undefined;

  const captureConnectionError = (error: Error) => {
    connectionError = error;
  };

  client.on('error', captureConnectionError);

  try {
    const connection = drizzle({ client, relations: appRelations });

    return await connection.transaction(async tx => {
      try {
        await admitCollectionOperation(tx, identity, policy);

        return await action(tx);
      } catch (cause) {
        // A terminated connection can also reject rollback; preserve the operation's SQLSTATE.
        operationError = toError(cause);
        throw operationError;
      }
    });
  } catch (cause) {
    throw collectionOperationError(operationError ?? connectionError ?? toError(cause));
  } finally {
    client.release(connectionError);
    client.removeListener('error', captureConnectionError);
  }
}

async function acquireConnection(db: Database): Promise<PoolClient> {
  try {
    return await db.$client.connect();
  } catch (cause) {
    throw new CollectionOperationTimeout(toError(cause));
  }
}
