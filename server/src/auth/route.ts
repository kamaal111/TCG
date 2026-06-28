import { allowedModes, SERVER_MODES } from '../modes.ts';
import { openAPIRouterFactory } from '../open-api.ts';
import { JWKS_PATH } from './constants.ts';

const authRoute = openAPIRouterFactory();

authRoute.use(allowedModes(SERVER_MODES.SERVER));

// GET: /jwks
authRoute.get(JWKS_PATH, c => c.get('auth').handler(c.req.raw));

export default authRoute;
