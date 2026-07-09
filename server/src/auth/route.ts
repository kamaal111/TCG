import { SERVER_MODES } from '../constants/common.ts';
import { allowedModes } from '../modes.ts';
import { openAPIRouterFactory } from '../open-api.ts';
import { JWKS_PATH } from './constants.ts';
import sessionHandler from './handlers/session.ts';
import signInHandler from './handlers/sign-in.ts';
import signOutHandler from './handlers/sign-out.ts';
import signUpHandler from './handlers/sign-up.ts';
import tokenHandler from './handlers/token.ts';
import sessionRoute from './routes/session.ts';
import signInRoute from './routes/sign-in.ts';
import signOutRoute from './routes/sign-out.ts';
import signUpRoute from './routes/sign-up.ts';
import tokenRoute from './routes/token.ts';

const authRoute = openAPIRouterFactory();

authRoute.use(allowedModes(SERVER_MODES.SERVER));

// GET: /jwks
authRoute.get(JWKS_PATH, c => c.get('auth').handler(c.req.raw));

// POST: /sign-up/email
authRoute.openapi(signUpRoute, signUpHandler);

// POST: /sign-in/email
authRoute.openapi(signInRoute, signInHandler);

// POST: /sign-out
authRoute.openapi(signOutRoute, signOutHandler);

// GET: /session
authRoute.openapi(sessionRoute, sessionHandler);

// GET: /token (JWT token refresh)
authRoute.openapi(tokenRoute, tokenHandler);

// Catch-all for any other better-auth endpoints
authRoute.on(['POST', 'GET'], '**', c => c.get('auth').handler(c.req.raw));

export default authRoute;
