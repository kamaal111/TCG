import assert from 'node:assert/strict';

import type { UserPreferencesRepository } from '../auth/repository.ts';
import type { CardImageRepository } from '../card-images/repository.ts';
import type { PricingCoordinator } from '../card-pricing/coordinator.ts';
import type { CardRepository } from '../cards/repository.ts';
import { UpsertCardSchema, ImportCardSchema } from '../cards/schemas/payloads.ts';
import type { ForexRepository } from '../forex/repository.ts';
import type { ObjectStorageClient } from '../storage/client.ts';

export interface PersistenceContractFixture {
  createOwner(): Promise<{ cards: CardRepository; preferences: UserPreferencesRepository }>;
  images: CardImageRepository;
  forex: ForexRepository;
  coordinator: PricingCoordinator;
  storage: ObjectStorageClient;
  cleanup(): Promise<void>;
}

/** Provider implementations register the same behavioral suite using real persistence fixtures. */
export function definePersistenceContracts(name: string, createFixture: () => Promise<PersistenceContractFixture>) {
  const integrationTest = test.extend('contract', async ({ task: _task }, { onCleanup }) => {
    const fixture = await createFixture();
    onCleanup(() => fixture.cleanup());

    return fixture;
  });

  describe(`${name} persistence contracts`, () => {
    integrationTest(
      'isolates card reads, updates, deletes and preferences by authenticated owner',
      async ({ contract }) => {
        const alice = await contract.createOwner();
        const bob = await contract.createOwner();

        const card = await alice.cards.create(
          UpsertCardSchema.parse({
            game: 'pokemon',
            name: 'Pikachu',
            set_name: 'Base',
            card_number: '58',
            purchases: [{ condition: 'near_mint', quantity: 1, purchase_price: '2.50', currency: 'EUR' }],
          }),
        );

        await alice.preferences.updatePreferredCurrency('EUR');
        expect(card.purchaseBatches[0]?.purchasePrice).toBe('2.500000');
        expect(await bob.cards.get(card.id)).toBeUndefined();
        expect(
          await bob.cards.update(
            card.id,
            UpsertCardSchema.parse({
              game: 'pokemon',
              name: 'Pikachu',
              set_name: 'Base',
              card_number: '58',
              purchases: [{ condition: 'near_mint', quantity: 2, purchase_price: null, currency: null }],
            }),
          ),
        ).toBeUndefined();
        expect(await bob.cards.delete([card.id])).toEqual({ deleted_ids: [], not_found_ids: [card.id] });
        expect(await bob.preferences.findPreferredCurrency()).toBeUndefined();
        expect(await alice.preferences.findPreferredCurrency()).toBe('EUR');
        expect((await alice.cards.get(card.id))?.purchaseBatches[0]?.quantity).toBe(1);
      },
    );

    integrationTest('imports the same backup idempotently', async ({ contract }) => {
      const owner = await contract.createOwner();

      const input = ImportCardSchema.parse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        game: 'pokemon',
        name: 'Pikachu',
        set_name: 'Base',
        card_number: '58',
        created_at: '2026-07-20T10:30:00.000Z',
        updated_at: '2026-07-20T10:30:00.000Z',
        purchases: [
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            condition: 'near_mint',
            quantity: 1,
            purchase_price: '2.50',
            currency: 'EUR',
          },
        ],
      });

      expect(await owner.cards.importCards([input])).toEqual({ imported_count: 1, updated_count: 0, skipped_count: 0 });
      expect(await owner.cards.importCards([input])).toEqual({ imported_count: 0, updated_count: 0, skipped_count: 1 });
    });

    integrationTest('claims once and fences completion by lease owner', async ({ contract }) => {
      await contract.images.registerMany([
        { imageKey: 'image-1', originUrl: 'https://example.com/1.png', storageKey: 'cards/1.png' },
      ]);

      const claims = await Promise.all([
        contract.images.claim('image-1', 'worker-a'),
        contract.images.claim('image-1', 'worker-b'),
      ]);

      const claimed = claims.find(row => row != null);
      expect(claims.filter(row => row != null)).toHaveLength(1);
      expect(claimed).toBeDefined();
      assert(claimed != null && claimed.leaseOwner != null);
      const leaseOwner = claimed.leaseOwner;
      expect(
        await contract.images.markReady('image-1', 'obsolete', {
          contentType: 'image/png',
          contentLength: 3,
          checksum: 'abc',
        }),
      ).toBe(false);
      expect(
        await contract.images.markReady('image-1', leaseOwner, {
          contentType: 'image/png',
          contentLength: 3,
          checksum: 'abc',
        }),
      ).toBe(true);
    });

    integrationTest('preserves object bytes and metadata and reports deletion as absent', async ({ contract }) => {
      expect((await contract.storage.put('cards/test.png', new Uint8Array([1, 2, 3]), 'image/png', 'abc')).isOk()).toBe(
        true,
      );
      const loaded = (await contract.storage.get('cards/test.png'))._unsafeUnwrap();
      expect(loaded).toEqual({
        body: new Uint8Array([1, 2, 3]),
        contentLength: 3,
        contentType: 'image/png',
        checksum: 'abc',
      });
      expect((await contract.storage.head('cards/test.png'))._unsafeUnwrap()).toEqual({
        contentLength: 3,
        contentType: 'image/png',
        checksum: 'abc',
      });
      expect((await contract.storage.delete('cards/test.png')).isOk()).toBe(true);
      expect((await contract.storage.get('cards/test.png'))._unsafeUnwrapErr().reason).toBe('not_found');
    });

    integrationTest('serializes identical pricing keys and releases after failure', async ({ contract }) => {
      const identity = { game: 'pokemon', key: 'pricing:contract', keyType: 'card', pricedOn: '2026-10-23' } as const;
      let active = 0;
      let maximum = 0;

      const operation = async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;

        return 'cached';
      };

      const results = await Promise.all([
        contract.coordinator.runExclusive(identity, operation),
        contract.coordinator.runExclusive(identity, operation),
      ]);

      expect(results.map(result => result._unsafeUnwrap())).toEqual(['cached', 'cached']);
      expect(maximum).toBe(1);

      const failed = await contract.coordinator.runExclusive(identity, async () => {
        throw new Error('provider failed');
      });

      expect(failed._unsafeUnwrapErr().reason).toBe('operation_failed');
      expect((await contract.coordinator.runExclusive(identity, operation))._unsafeUnwrap()).toBe('cached');
    });

    integrationTest(
      'persists forex independently of HTTP context without replacing a published snapshot',
      async ({ contract }) => {
        const first = { base: 'EUR', date: '2026-10-16', rates: { EUR: 1, USD: 1.25, JPY: 150 } } as const;
        expect((await contract.forex.latestSnapshot())._unsafeUnwrap()).toBeUndefined();
        expect((await contract.forex.storeSnapshot(first, new Date('2026-10-16T17:00:00Z')))._unsafeUnwrap()).toBe(
          true,
        );
        expect(
          (
            await contract.forex.storeSnapshot(
              { ...first, rates: { EUR: 1, USD: 2, JPY: 150 } },
              new Date('2026-10-17T17:00:00Z'),
            )
          )._unsafeUnwrap(),
        ).toBe(false);
        expect((await contract.forex.latestSnapshot())._unsafeUnwrap()).toEqual(first);
      },
    );
  });
}
