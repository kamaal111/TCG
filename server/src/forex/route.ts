import { SERVER_MODES } from '../constants/common.ts';
import { allowedModes } from '../modes.ts';
import { openAPIRouterFactory } from '../open-api.ts';
import latestSnapshotRoute from './routes/latest-snapshot.ts';

const forexRoute = openAPIRouterFactory();

forexRoute.use(allowedModes(SERVER_MODES.SERVER));

forexRoute.openapiRoutes([latestSnapshotRoute]);

export default forexRoute;
