import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { appRelations } from '../../../db/schema/index.ts';
import { integrationTest } from '../../../tests/fixtures.ts';
import { PostgresPricingCoordinator } from '../coordinator.ts';

integrationTest(
  'pricing locks leave a two-connection application pool available to protected queries',
  async ({ connectionString }) => {
    const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 200 });
    const db = drizzle({ client: pool, relations: appRelations });
    const coordinator = new PostgresPricingCoordinator(db, 1000);

    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          coordinator.runExclusive(
            { game: 'pokemon', key: `pricing:pool:${index}`, keyType: 'card', pricedOn: '2026-11-08' },
            async () => {
              const result = await pool.query<{ value: number }>('select 42 as value');

              return result.rows[0]?.value;
            },
          ),
        ),
      );

      expect(results.map(result => result._unsafeUnwrap())).toEqual([42, 42, 42, 42, 42, 42]);
      expect(pool.waitingCount).toBe(0);
    } finally {
      await coordinator.close();
      await pool.end();
    }
  },
);

integrationTest(
  'expires queued lock acquisitions without running their operations and recovers after release',
  async ({ db }) => {
    const coordinator = new PostgresPricingCoordinator(db, 150);
    const gate = Promise.withResolvers<undefined>();
    const started = Promise.withResolvers<undefined>();
    let active = 0;
    const identity = { game: 'pokemon', key: 'pricing:deadline', keyType: 'card', pricedOn: '2026-11-08' } as const;
    const operation = vi.fn<() => Promise<string>>(async () => 'expired');

    const holders = [0, 1].map(index =>
      coordinator.runExclusive({ ...identity, key: `pricing:holder:${index}` }, async () => {
        active += 1;

        if (active === 2) {
          started.resolve(undefined);
        }

        await gate.promise;

        return 'released';
      }),
    );

    try {
      await started.promise;
      const result = await coordinator.runExclusive(identity, operation);

      expect(result._unsafeUnwrapErr().reason).toBe('timeout');
      expect(operation).not.toHaveBeenCalled();
      gate.resolve(undefined);
      expect((await Promise.all(holders)).map(result => result._unsafeUnwrap())).toEqual(['released', 'released']);
      expect((await coordinator.runExclusive(identity, async () => 'recovered'))._unsafeUnwrap()).toBe('recovered');
    } finally {
      gate.resolve(undefined);
      await Promise.all(holders);
      await coordinator.close();
    }
  },
);

integrationTest('closing the lock pool leaves an injected application database usable', async ({ db }) => {
  const coordinator = new PostgresPricingCoordinator(db, 1000);
  const identity = { game: 'pokemon', key: 'pricing:close', keyType: 'card', pricedOn: '2026-11-08' } as const;

  expect((await coordinator.runExclusive(identity, async () => 'priced'))._unsafeUnwrap()).toBe('priced');
  await coordinator.close();
  const result = await coordinator.runExclusive(identity, async () => 'unexpected');

  expect(result._unsafeUnwrapErr().reason).toBe('unavailable');
  expect((await db.$client.query('select 42 as value')).rows).toEqual([{ value: 42 }]);
});
