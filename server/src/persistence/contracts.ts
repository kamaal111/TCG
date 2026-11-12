import type { DomainLogger } from '@tcg/http/logging';
import type { CardImportProgress } from '@tcg/http/progress';

import type { UserPreferencesRepository } from '../auth/repository.ts';
import type { CardImageRepository } from '../card-images/repository.ts';
import type { PricingCoordinator } from '../card-pricing/coordinator.ts';
import type { CardPricingRepository } from '../card-pricing/repository.ts';
import type { CardsLogFields } from '../cards/logging.ts';
import type { OfflineCollectionRepository } from '../cards/offline-collection-repository.ts';
import type { CardRepository } from '../cards/repository.ts';
import type { CollectionRepository } from '../collections/repository.ts';
import type { ForexRepository } from '../forex/repository.ts';

/** Supplied by authentication composition, never populated from request input. */
export interface AuthenticatedIdentity {
  requireUserId(): string;
}

export interface RepositoryDiagnostics {
  cardsLogger: DomainLogger<CardsLogFields>;
  setImportProgress(progress: CardImportProgress): void;
}

interface RequestRepositories {
  offlineCollectionRepository: OfflineCollectionRepository;
  cardRepository: CardRepository;
  collectionRepository: CollectionRepository;
  cardPricingRepository: CardPricingRepository;
  userPreferencesRepository: UserPreferencesRepository;
}

export interface Persistence {
  close(): Promise<void>;
  forexRepository: ForexRepository;
  cardImageRepository: CardImageRepository;
  forRequest(identity: AuthenticatedIdentity, diagnostics: RepositoryDiagnostics): RequestRepositories;
  pricingCoordinator: PricingCoordinator;
}
