import type { AuthVariables } from '@kamaalio/kamaal-auth-hono';
import { Context } from 'hono';
import type { Input, Next } from 'hono';
import type { RequestIdVariables } from 'hono/request-id';

import type { Auth } from './auth/better-auth.ts';
import { UserPreferencesRepository } from './auth/repository.ts';
import type { CardImageMaterializer } from './card-images/materializer.ts';
import type { CardImageOriginClient } from './card-images/origin-client.ts';
import { CardImageRepository } from './card-images/repository.ts';
import { CardImageService } from './card-images/service.ts';
import type { CardImageWarmer } from './card-images/warmer.ts';
import type { PricingClient } from './card-pricing/client.ts';
import { CardPricingRepository } from './card-pricing/repository.ts';
import { CardPricingService } from './card-pricing/service.ts';
import type { CardImportProgress } from './cards/logging.ts';
import { CardRepository } from './cards/repository.ts';
import type { Database } from './db/index.ts';
import type { ForexClient } from './forex/client.ts';
import { ForexRepository } from './forex/repository.ts';
import { ForexService } from './forex/service.ts';
import type { RequestLogger } from './logging/index.ts';
import type { ObjectStorageClient } from './storage/client.ts';

export interface InjectedContext {
  forexClient: ForexClient;
  db: Database;
  auth: Auth;
  pricingClient: PricingClient;
  storageClient: ObjectStorageClient;
  imageOriginClient: CardImageOriginClient;
  cardImageWarmer: CardImageWarmer;
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

export type HonoVariables = RequestIdVariables &
  InjectedContext &
  RepositoryVariables &
  ServiceVariables &
  LoggingVariables &
  AuthVariables;

export interface HonoEnvironment {
  Variables: HonoVariables;
}

export type HonoContext<P extends string = string, I extends Input = Input> = Context<HonoEnvironment, P, I>;

export function createDatabaseOnlyContext(db: Database): HonoContext {
  const c = new Context<HonoEnvironment>(new Request('http://localhost'));
  c.set('db', db);

  return c;
}

export function injectRequestContext({
  forexClient,
  db,
  auth,
  pricingClient,
  storageClient,
  imageOriginClient,
  cardImageWarmer,
  cardImageMaterializer,
}: InjectedContext) {
  return async (c: HonoContext, next: Next) => {
    c.set('db', db);
    c.set('forexClient', forexClient);
    c.set('auth', auth);
    c.set('pricingClient', pricingClient);
    c.set('storageClient', storageClient);
    c.set('imageOriginClient', imageOriginClient);
    c.set('cardImageWarmer', cardImageWarmer);
    c.set('cardImageMaterializer', cardImageMaterializer);
    c.set('cardPricingRepository', new CardPricingRepository(c));
    c.set('userPreferencesRepository', new UserPreferencesRepository(c));
    c.set('forexRepository', new ForexRepository(c));
    c.set('cardRepository', new CardRepository(c));
    c.set('cardImageRepository', new CardImageRepository(c));
    c.set('forexService', new ForexService(c));
    c.set('cardPricingService', new CardPricingService(c));
    c.set('cardImageService', new CardImageService(c));
    await next();
  };
}
