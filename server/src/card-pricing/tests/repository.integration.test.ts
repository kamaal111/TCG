import assert from 'node:assert/strict';

import { drizzle } from 'drizzle-orm/node-postgres';
import { ResultAsync } from 'neverthrow';
import { Client, Pool } from 'pg';

import { createDatabaseOnlyContext } from '../../context.ts';
import type { Database } from '../../db/index.ts';
import { appRelations } from '../../db/schema/index.ts';
import { APIException } from '../../exceptions/index.ts';
import { createRequestLogger } from '../../logging/index.ts';
import { integrationTest } from '../../tests/fixtures.ts';
import {
  PricingLockTimeout,
  PricingLockUnavailable,
  PricingProviderUnavailable,
  PricingOperationFailed,
  type PricingLockError,
} from '../exceptions.ts';
import { CardPricingRepository } from '../repository.ts';
import { todayUTC } from '../utils/query.ts';

function createRepository(db: Database, requestId: string) {
  const c = createDatabaseOnlyContext(db);
  c.set('requestId', requestId);
  c.set(
    'logger',
    createRequestLogger({
      requestId,
      method: 'GET',
      path: '/test',
      url: 'http://localhost/test',
      mode: 'TEST',
      userAgent: undefined,
    }),
  );

  return { c, repository: new CardPricingRepository(c) };
}

function pricingLock() {
  return {
    game: 'pokemon',
    key: `test:pricing:${crypto.randomUUID()}`,
    keyType: 'card',
    pricedOn: todayUTC(),
  } as const;
}

describe('Pricing repository lock results', () => {
  integrationTest(
    'returns Ok after the locked operation succeeds',
    async ({ db, createTestRequestId, getLogsForRequestId }) => {
      const requestId = createTestRequestId();
      const { repository } = createRepository(db, requestId);
      const value = { matched: true };
      const pending = repository.withPricingLock(pricingLock(), async () => value);
      expect(pending).toBeInstanceOf(ResultAsync);
      expectTypeOf(pending).toEqualTypeOf<ResultAsync<typeof value, PricingLockError>>();
      expectTypeOf<PricingLockError>().toExtend<APIException>();

      const result = await pending.map(value => ({ original: value }));

      assert(result.isOk());
      expect(result.value.original).toBe(value);
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'pricing.lock.completed', outcome: 'success', lock_status: 'acquired' }),
        ]),
      );
    },
  );

  integrationTest(
    'wraps unexpected failures in an API exception and releases the lock',
    async ({ db, createTestRequestId, getLogsForRequestId }) => {
      const requestId = createTestRequestId();
      const { repository } = createRepository(db, requestId);
      const lock = pricingLock();
      const failure = new Error('Operation failed');

      const result = await repository.withPricingLock(lock, async () => {
        throw failure;
      });

      assert(result.isErr());
      expect(result.error).toBeInstanceOf(APIException);
      expect(result.error.cause).toBe(failure);
      expect(result.error).toBeInstanceOf(PricingOperationFailed);
      expect(result.error.status).toBe(500);
      expect(await result.error.getResponse().json()).toEqual({
        message: 'Something went wrong',
        code: 'INTERNAL_SERVER_ERROR',
      });
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'pricing.lock.completed',
            outcome: 'failure',
            lock_status: 'acquired',
            error_code: 'PRICING_OPERATION_FAILED',
          }),
        ]),
      );

      const retry = await repository.withPricingLock(lock, async () => 'recovered');
      assert(retry.isOk());
      expect(retry.value).toBe('recovered');
    },
  );

  integrationTest(
    'returns a provider failure without replacing its identity',
    async ({ db, createTestRequestId, getLogsForRequestId }) => {
      const requestId = createTestRequestId();
      const { c, repository } = createRepository(db, requestId);
      const failure = new PricingProviderUnavailable(c);

      const result = await repository.withPricingLock(pricingLock(), async () => {
        throw failure;
      });

      assert(result.isErr());
      expect(result.error).toBeInstanceOf(APIException);
      expect(result.error).toBe(failure);
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'pricing.lock.completed',
            outcome: 'failure',
            lock_status: 'acquired',
            error_code: 'PRICING_PROVIDER_UNAVAILABLE',
          }),
        ]),
      );
    },
  );

  integrationTest(
    'returns a typed acquisition failure without running the operation',
    async ({ connectionString, createTestRequestId, getLogsForRequestId }) => {
      const requestId = createTestRequestId();
      const pool = new Pool({ connectionString });
      const db = drizzle<typeof appRelations>({ client: pool, relations: appRelations });
      await pool.end();
      const { repository } = createRepository(db, requestId);
      let ran = false;

      const result = await repository.withPricingLock(pricingLock(), async () => {
        ran = true;

        return 'unexpected';
      });

      assert(result.isErr());
      expect(result.error).toBeInstanceOf(APIException);
      expect(result.error).toBeInstanceOf(PricingLockUnavailable);
      expect(result.error.status).toBe(500);
      expect(result.error.cause).toBeInstanceOf(Error);
      expect(ran).toBe(false);
      expect(getLogsForRequestId(requestId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'pricing.lock.completed',
            lock_status: 'failed',
            error_code: 'PRICING_PROVIDER_UNAVAILABLE',
          }),
        ]),
      );
    },
  );

  integrationTest(
    'returns Err for a lock timeout without running the operation',
    async ({ db, connectionString, createTestRequestId, getLogsForRequestId }) => {
      const requestId = createTestRequestId();
      const { repository } = createRepository(db, requestId);
      const lock = pricingLock();
      const holder = new Client({ connectionString });
      await holder.connect();

      try {
        await holder.query('begin');
        await holder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lock.key]);

        let ran = false;

        const result = await repository.withPricingLock(lock, async () => {
          ran = true;

          return 'unexpected';
        });

        assert(result.isErr());
        expect(result.error).toBeInstanceOf(APIException);
        expect(result.error).toBeInstanceOf(PricingLockTimeout);
        expect(result.error.status).toBe(503);
        expect(result.error.getResponse().headers.get('Retry-After')).toBe('1');
        expect(result.error.cause).toBeInstanceOf(Error);
        expect(ran).toBe(false);
        expect(getLogsForRequestId(requestId)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: 'pricing.lock.completed',
              outcome: 'failure',
              lock_status: 'timeout',
              error_code: 'PRICING_LOCK_TIMEOUT',
            }),
          ]),
        );
      } finally {
        await holder.query('rollback');
        await holder.end();
      }
    },
  );
});
