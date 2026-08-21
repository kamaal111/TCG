import type { AuthVariables } from '@kamaalio/kamaal-auth-hono';
import type { Context, Input, Next } from 'hono';
import type { RequestIdVariables } from 'hono/request-id';

import type { Auth } from './auth/better-auth.ts';
import type { PricingClient } from './card-pricing/client.ts';
import { CardPricingRepository } from './card-pricing/repository.ts';
import { CardPricingService } from './card-pricing/service.ts';
import { CardRepository } from './cards/repository.ts';
import type { Database } from './db/index.ts';
import type { RequestLogger } from './logging/index.ts';

export interface InjectedContext {
  db: Database;
  auth: Auth;
  pricingClient: PricingClient;
}

interface RepositoryVariables {
  cardPricingRepository: CardPricingRepository;
  cardRepository: CardRepository;
}

interface ServiceVariables {
  cardPricingService: CardPricingService;
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

export function injectRequestContext({ db, auth, pricingClient }: InjectedContext) {
  return async (c: HonoContext, next: Next) => {
    c.set('db', db);
    c.set('auth', auth);
    c.set('pricingClient', pricingClient);
    c.set('cardPricingRepository', new CardPricingRepository(c));
    c.set('cardRepository', new CardRepository(c));
    c.set('cardPricingService', new CardPricingService(c));
    await next();
  };
}
