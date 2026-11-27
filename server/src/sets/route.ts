import { SERVER_MODES } from '@tcg/http/common';
import { openAPIRouterFactory } from '@tcg/http/open-api';

import type { HonoEnvironment } from '../context.ts';
import { allowedModes } from '../modes.ts';
import getSetCardDetailRoute from './routes/get-set-card-detail.ts';
import getSetChecklistRoute from './routes/get-set-checklist.ts';
import listSetsRoute from './routes/list-sets.ts';

const setsRoute = openAPIRouterFactory<HonoEnvironment>();

setsRoute.use(allowedModes(SERVER_MODES.SERVER));

setsRoute.openapiRoutes([listSetsRoute, getSetChecklistRoute, getSetCardDetailRoute]);

export default setsRoute;
