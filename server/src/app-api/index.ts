import { AUTH_ROUTE_NAME } from '../auth/constants.ts';
import authRoute from '../auth/route.ts';
import { SERVER_MODES } from '../constants/common.ts';
import { allowedModes } from '../modes.ts';
import { openAPIRouterFactory } from '../open-api.ts';

const appApiRoute = openAPIRouterFactory();

appApiRoute.use(allowedModes(SERVER_MODES.SERVER)).route(AUTH_ROUTE_NAME, authRoute);

export default appApiRoute;
