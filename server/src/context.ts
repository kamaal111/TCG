import type { AuthVariables } from '@kamaalio/kamaal-auth-hono';
import type { Context } from 'hono';
import type { Input, Next } from 'hono';
import type { RequestIdVariables } from 'hono/request-id';

import type { Auth } from './auth/client.ts';
import { getSession, type ApplicationAuthModule } from './auth/module.ts';
import type { UserPreferencesRepository } from './auth/repository.ts';
import type { CardImageMaterializer } from './card-images/materializer.ts';
import type { CardImageOriginClient } from './card-images/origin-client.ts';
import type { CardImageRepository } from './card-images/repository.ts';
import type { CardImageScheduler } from './card-images/scheduler.ts';
import { CardImageService } from './card-images/service.ts';
import type { PricingClient } from './card-pricing/client.ts';
import type { CardPricingRepository } from './card-pricing/repository.ts';
import { CardPricingService } from './card-pricing/service.ts';
import type { CardImportProgress } from './cards/logging.ts';
import { cardsLogger } from './cards/logging.ts';
import type { CardRepository } from './cards/repository.ts';
import type { ApplicationConfig } from './config.ts';
import type { ForexClient } from './forex/client.ts';
import type { Currency } from './forex/currencies.ts';
import type { ForexRepository } from './forex/repository.ts';
import { ForexService } from './forex/service.ts';
import type { RequestLogger } from './logging/index.ts';
import type { Persistence } from './persistence/contracts.ts';
import type { ObjectStorageClient } from './storage/client.ts';

export interface InjectedContext {
  config: ApplicationConfig;
  forexClient: ForexClient;
  persistence: Persistence;
  auth: Auth;
  pricingClient: PricingClient;
  storageClient: ObjectStorageClient;
  imageOriginClient: CardImageOriginClient;
  cardImageWarmer: CardImageScheduler;
  cardImageMaterializer: CardImageMaterializer;
}

interface RepositoryVariables {
  userPreferencesRepository: UserPreferencesRepository;
  forexRepository: ForexRepository;
  cardPricingRepository: CardPricingRepository;
  cardRepository: CardRepository;
  cardImageRepository: CardImageRepository;
}

interface ServiceVariables {
  forexService: ForexService;
  cardPricingService: CardPricingService;
  cardImageService: CardImageService;
}

interface LoggingVariables {
  logger: RequestLogger;
  cardImportProgress?: CardImportProgress;
}

export type HonoVariables = { authModule: ApplicationAuthModule } & {
  preferredCurrency: Currency;
} & RequestIdVariables &
  InjectedContext &
  RepositoryVariables &
  ServiceVariables &
  LoggingVariables &
  AuthVariables;

export interface HonoEnvironment {
  Variables: HonoVariables;
}

export type HonoContext<P extends string = string, I extends Input = Input> = Context<HonoEnvironment, P, I>;

export function injectRequestContext({
  config,
  forexClient,
  persistence,
  auth,
  pricingClient,
  storageClient,
  imageOriginClient,
  cardImageWarmer,
  cardImageMaterializer,
}: InjectedContext) {
  return async (c: HonoContext, next: Next) => {
    c.set('config', config);
    c.set('persistence', persistence);
    c.set('forexClient', forexClient);
    c.set('auth', auth);
    c.set('pricingClient', pricingClient);
    c.set('storageClient', storageClient);
    c.set('imageOriginClient', imageOriginClient);
    c.set('cardImageWarmer', cardImageWarmer);
    c.set('cardImageMaterializer', cardImageMaterializer);

    const repositories = persistence.forRequest(
      { requireUserId: () => getSession(c).user.id },
      {
        get cardsLogger() {
          return cardsLogger(c);
        },
        setImportProgress: progress => c.set('cardImportProgress', progress),
      },
    );

    c.set('cardPricingRepository', repositories.cardPricingRepository);
    c.set('userPreferencesRepository', repositories.userPreferencesRepository);
    c.set('cardRepository', repositories.cardRepository);
    c.set('forexRepository', persistence.forexRepository);
    c.set('cardImageRepository', persistence.cardImageRepository);
    c.set('forexService', new ForexService(c));
    c.set('cardPricingService', new CardPricingService(c));
    c.set('cardImageService', new CardImageService(c));
    await next();
  };
}
