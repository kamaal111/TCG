import { SERVER_MODES } from '@tcg/http/common';
import { openAPIRouterFactory } from '@tcg/http/open-api';

import type { HonoEnvironment } from '../context.ts';
import { allowedModes } from '../modes.ts';
import latestSnapshotRoute from './routes/latest-snapshot.ts';

const forexRoute = openAPIRouterFactory<HonoEnvironment>();

forexRoute.use(allowedModes(SERVER_MODES.SERVER));

forexRoute.openapiRoutes([latestSnapshotRoute]);

export default forexRoute;
