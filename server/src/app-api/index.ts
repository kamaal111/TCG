import { AUTH_ROUTE_NAME } from '../auth/constants.ts';
import type { ApplicationAuthModule } from '../auth/module.ts';
import { IMAGES_ROUTE_NAME } from '../card-images/constants.ts';
import imagesRoute from '../card-images/route.ts';
import { PRICING_ROUTE_NAME } from '../card-pricing/constants.ts';
import pricingRoute from '../card-pricing/route.ts';
import { CARDS_ROUTE_NAME } from '../cards/constants.ts';
import cardsRoute from '../cards/route.ts';
import { COLLECTIONS_ROUTE_NAME } from '../collections/constants.ts';
import { createCollectionsRoute } from '../collections/route.ts';
import type { ApplicationConfig } from '../config.ts';
import { SERVER_MODES } from '../constants/common.ts';
import { FOREX_ROUTE_NAME } from '../forex/constants.ts';
import forexRoute from '../forex/route.ts';
import { allowedModes } from '../modes.ts';
import { openAPIRouterFactory } from '../open-api.ts';

export function createAppApiRoute(authModule: ApplicationAuthModule, config: ApplicationConfig) {
  const appApiRoute = openAPIRouterFactory();

  appApiRoute
    .use(allowedModes(SERVER_MODES.SERVER))
    .route(AUTH_ROUTE_NAME, authModule.router)
    .route(FOREX_ROUTE_NAME, forexRoute)
    .route(IMAGES_ROUTE_NAME, imagesRoute)
    .route(CARDS_ROUTE_NAME, cardsRoute)
    .route(COLLECTIONS_ROUTE_NAME, createCollectionsRoute(config))
    .route(PRICING_ROUTE_NAME, pricingRoute);

  return appApiRoute;
}
