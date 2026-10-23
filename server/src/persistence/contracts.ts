import type { UserPreferencesRepository } from '../auth/repository.ts';
import type { CardImageRepository } from '../card-images/repository.ts';
import type { PricingCoordinator } from '../card-pricing/coordinator.ts';
import type { CardPricingRepository } from '../card-pricing/repository.ts';
import type { CardImportProgress, CardsLogFields } from '../cards/logging.ts';
import type { CardRepository } from '../cards/repository.ts';
import type { ForexRepository } from '../forex/repository.ts';
import type { DomainLogger } from '../logging/index.ts';

/** Supplied by authentication composition, never populated from request input. */
export interface AuthenticatedIdentity {
  requireUserId(): string;
}

export interface RepositoryDiagnostics {
  cardsLogger: DomainLogger<CardsLogFields>;
  setImportProgress(progress: CardImportProgress): void;
}

export interface RequestRepositories {
  cardRepository: CardRepository;
  cardPricingRepository: CardPricingRepository;
  userPreferencesRepository: UserPreferencesRepository;
}

export interface Persistence {
  forexRepository: ForexRepository;
  cardImageRepository: CardImageRepository;
  forRequest(identity: AuthenticatedIdentity, diagnostics: RepositoryDiagnostics): RequestRepositories;
  pricingCoordinator: PricingCoordinator;
}
