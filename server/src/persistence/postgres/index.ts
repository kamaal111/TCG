import { PostgresUserPreferencesRepository } from './auth.ts';
import { PostgresCardImageRepository } from './card-images.ts';
import { PostgresCardPricingRepository } from './card-pricing.ts';
import { PostgresCardRepository } from './cards.ts';
import { PostgresCollectionRepository } from './collections.ts';
import { PostgresPricingCoordinator } from './coordinator.ts';
import { PostgresForexRepository } from './forex.ts';
import { PostgresOfflineCollectionRepository } from './offline-collection.ts';
import { DEFAULT_COLLECTION_POLICY, type ApplicationConfig } from '../../config.ts';
import type { Database } from '../../db/index.ts';
import type { Persistence } from '../contracts.ts';

export function createPostgresPersistence(db: Database, timeoutMs: number, config?: ApplicationConfig): Persistence {
  const coordinator = new PostgresPricingCoordinator(db, timeoutMs);

  return {
    close: coordinator.close,
    forexRepository: new PostgresForexRepository(db),
    cardImageRepository: new PostgresCardImageRepository(db, config),
    pricingCoordinator: coordinator,
    forRequest: (identity, diagnostics) => {
      const cardRepository = new PostgresCardRepository(db, identity, diagnostics, config);

      return {
        offlineCollectionRepository: new PostgresOfflineCollectionRepository(db, identity),
        cardRepository,
        collectionRepository: new PostgresCollectionRepository({
          db,
          identity,
          diagnostics,
          policy: config ?? DEFAULT_COLLECTION_POLICY,
          cardRepository,
        }),
        cardPricingRepository: new PostgresCardPricingRepository(db, identity),
        userPreferencesRepository: new PostgresUserPreferencesRepository(db, identity),
      };
    },
  };
}
