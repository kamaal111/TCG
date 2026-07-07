import { SERVER_MODES } from '../constants/common.ts';
import { allowedModes } from '../modes.ts';
import { openAPIRouterFactory } from '../open-api.ts';
import { JWKS_PATH } from './constants.ts';
import signInHandler from './handlers/sign-in.ts';
import signUpHandler from './handlers/sign-up.ts';
import signInRoute from './routes/sign-in.ts';
import signUpRoute from './routes/sign-up.ts';

const authRoute = openAPIRouterFactory();

authRoute.use(allowedModes(SERVER_MODES.SERVER));

// GET: /jwks
authRoute.get(JWKS_PATH, c => c.get('auth').handler(c.req.raw));

// POST: /sign-up/email
authRoute.openapi(signUpRoute, signUpHandler);

// POST: /sign-in/email
authRoute.openapi(signInRoute, signInHandler);

export default authRoute;
