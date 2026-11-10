import { SERVER_MODES } from '@tcg/http/common';
import { openAPIRouterFactory } from '@tcg/http/open-api';

import type { HonoEnvironment } from '../context.ts';
import { allowedModes } from '../modes.ts';
import searchPricingRoute from './routes/search-pricing.ts';

const pricingRoute = openAPIRouterFactory<HonoEnvironment>();

pricingRoute.use(allowedModes(SERVER_MODES.SERVER));

pricingRoute.openapiRoutes([searchPricingRoute]);

export default pricingRoute;
