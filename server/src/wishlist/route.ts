import { SERVER_MODES } from '@tcg/http/common';
import { openAPIRouterFactory } from '@tcg/http/open-api';

import type { HonoEnvironment } from '../context.ts';
import { allowedModes } from '../modes.ts';
import listWishlistRoute from './routes/list-wishlist.ts';
import removeWishlistPrintingRoute from './routes/remove-wishlist-printing.ts';
import saveWishlistPrintingRoute from './routes/save-wishlist-printing.ts';

const wishlistRoute = openAPIRouterFactory<HonoEnvironment>();

wishlistRoute.use(allowedModes(SERVER_MODES.SERVER));

wishlistRoute.openapiRoutes([listWishlistRoute, saveWishlistPrintingRoute, removeWishlistPrintingRoute]);

export default wishlistRoute;
