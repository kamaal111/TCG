import type { AuthVariables } from '@kamaalio/kamaal-auth-hono';
import type { Context, Input, Next } from 'hono';
import type { RequestIdVariables } from 'hono/request-id';

import type { Auth } from './auth/better-auth.ts';
import type { CardImageMaterializer } from './card-images/materializer.ts';
import type { CardImageOriginClient } from './card-images/origin-client.ts';
import { CardImageRepository } from './card-images/repository.ts';
import { CardImageService } from './card-images/service.ts';
import type { CardImageWarmer } from './card-images/warmer.ts';
import type { PricingClient } from './card-pricing/client.ts';
import { CardPricingRepository } from './card-pricing/repository.ts';
import { CardPricingService } from './card-pricing/service.ts';
import { CardRepository } from './cards/repository.ts';
import type { Database } from './db/index.ts';
import type { RequestLogger } from './logging/index.ts';
import type { ObjectStorageClient } from './storage/client.ts';

export interface InjectedContext {
  db: Database;
  auth: Auth;
  pricingClient: PricingClient;
  storageClient: ObjectStorageClient;
  imageOriginClient: CardImageOriginClient;
  cardImageWarmer: CardImageWarmer;
  cardImageMaterializer: CardImageMaterializer;
}

interface RepositoryVariables {
  cardPricingRepository: CardPricingRepository;
  cardRepository: CardRepository;
  cardImageRepository: CardImageRepository;
}

interface ServiceVariables {
  cardPricingService: CardPricingService;
  cardImageService: CardImageService;
}

interface LoggingVariables {
  logger: RequestLogger;
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

export type HonoContext<P extends string = string, I extends Input = Record<string, unknown>> = Context<
  HonoEnvironment,
  P,
  I
>;

export function injectRequestContext({
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
    c.set('auth', auth);
    c.set('pricingClient', pricingClient);
    c.set('storageClient', storageClient);
    c.set('imageOriginClient', imageOriginClient);
    c.set('cardImageWarmer', cardImageWarmer);
    c.set('cardImageMaterializer', cardImageMaterializer);
    c.set('cardPricingRepository', new CardPricingRepository(c));
    c.set('cardRepository', new CardRepository(c));
    c.set('cardImageRepository', CardImageRepository.fromContext(c));
    c.set('cardPricingService', new CardPricingService(c));
    c.set('cardImageService', new CardImageService(c));
    await next();
  };
}
