import { AUTH_ROUTE_NAME } from '../auth/constants.ts';
import authRoute from '../auth/route.ts';
import { SERVER_MODES } from '../constants/common.ts';
import { allowedModes } from '../modes.ts';
import { openAPIRouterFactory } from '../open-api.ts';
import { CARDS_ROUTE_NAME } from '../cards/constants.ts';
import cardsRoute from '../cards/route.ts';
import { PRICING_ROUTE_NAME } from '../card-pricing/constants.ts';
import pricingRoute from '../card-pricing/route.ts';

const appApiRoute = openAPIRouterFactory();

appApiRoute
  .use(allowedModes(SERVER_MODES.SERVER))
  .route(AUTH_ROUTE_NAME, authRoute)
  .route(CARDS_ROUTE_NAME, cardsRoute)
  .route(PRICING_ROUTE_NAME, pricingRoute);

export default appApiRoute;
