import { openAPIRouterFactory } from '@tcg/http/open-api';

import type { HonoEnvironment } from '../context.ts';
import getImageRoute from './routes/get-image.ts';

const imagesRoute = openAPIRouterFactory<HonoEnvironment>();

imagesRoute.openapiRoutes([getImageRoute]);

export default imagesRoute;
