import { SERVER_MODES } from '../constants/common.ts';
import { allowedModes } from '../modes.ts';
import { openAPIRouterFactory } from '../open-api.ts';
import searchPricingHandler from './handlers/search-pricing.ts';
import searchPricingRoute from './routes/search-pricing.ts';

const pricingRoute = openAPIRouterFactory();

pricingRoute.use(allowedModes(SERVER_MODES.SERVER));

pricingRoute.openapi(searchPricingRoute, searchPricingHandler);

export default pricingRoute;
